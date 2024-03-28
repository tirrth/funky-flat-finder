require('dotenv').config()
const fetch = require('node-fetch')
const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')

puppeteer.use(StealthPlugin())

const chatId = process.env.TELEGRAM_CHAT_ID
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN
const url = 'https://morgan-properties.securecafe.com/onlineleasing/riverside-towers-apartment-homes/availableunits.aspx'

let prevState = []
let checksPerformed = 0
let lastErrorMessage = ''
let uniqueErrors = new Set()
let previouslyAvailable = false
const processStartTime = Date.now()

async function fetchApartments() {
    let browser
    try {
        browser = await puppeteer.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox'], // Recommended for server environments
        })
        const page = await browser.newPage()
        await page.goto(url, { waitUntil: 'networkidle2' })

        const apartments = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('table.availableUnits tbody > tr'))
            return rows.map(row => {
                // const apartment = row.querySelector('td[data-selenium-id=\'Apt1\']').innerText.trim()
                // const sqFt = row.querySelector('td[data-selenium-id=\'SqFt1\']').innerText.trim()
                // const rent = row.querySelector('td[data-selenium-id=\'Rent1\']').innerText.trim()
                const apartment = row.querySelector('td[data-label=\'Apartment\']').innerText.trim()
                const sqFt = row.querySelector('td[data-label=\'Sq.Ft.\']').innerText.trim()
                const rent = row.querySelector('td[data-label=\'Rent\']').innerText.trim()
                return { apartment, sqFt, rent }
            })
        })

        return apartments
    } catch (error) {
        console.error('Failed to fetch or parse apartments with Puppeteer:', error)
        uniqueErrors.add(error.message)
        return [] // Return an empty array as a fallback
    } finally {
        if (browser) await browser.close()
    }
}

async function sendTelegramMessage(message) {
    try {
        const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: 'HTML'
            })
        })
        const data = await response.json()
        console.log('Message sent:', data)
    } catch (error) {
        console.error('Error sending Telegram message:', error)
    }
}

async function sendPeriodicReport() {
    const runningTime = Math.floor((Date.now() - processStartTime) / (1000 * 60 * 60)) // in hours
    const message = `<b>📊 Process Report 📊</b>\n` +
        `Running Time: ${runningTime} hours\n` +
        `Checks Performed: ${checksPerformed}\n` +
        `Unique Errors Encountered: ${uniqueErrors.size}`

    await sendTelegramMessage(message)
}

async function checkAndNotify() {
    checksPerformed++
    try {
        const apartments = await fetchApartments()
        console.log('Apartments:', apartments)

        if (apartments.length === 0 && previouslyAvailable) {
            await sendTelegramMessage('No apartments are currently available.')
            previouslyAvailable = false
            prevState = []
        } else if (apartments.length > 0) {
            const newApartments = apartments.filter(a => {
                const aptDetails = `${a.apartment} ${a.sqFt} ${a.rent}`
                return !prevState.includes(aptDetails)
            })

            if (newApartments.length > 0) {
                const maxApartmentLength = Math.max(...newApartments.map(a => a.apartment.length), 'Apartment'.length)
                const maxSqFtLength = Math.max(...newApartments.map(a => a.sqFt.length), 'Sq.Ft'.length)
                const maxRentLength = Math.max(...newApartments.map(a => a.rent.length), 'Rent'.length)

                const messageHeader = '<b>🚨 New Apartments Available! 🚨</b>\n'
                const tableHeader = `<b>Apartment${' '.repeat(maxApartmentLength - 'Apartment'.length + 2)}| Sq.Ft${' '.repeat(maxSqFtLength - 'Sq.Ft'.length + 2)}| Rent</b>`
                const horizontalLine = `${'-'.repeat(maxApartmentLength + maxSqFtLength + maxRentLength + 6)}`

                const apartmentsList = newApartments.map(a =>
                    `${a.apartment}${' '.repeat(maxApartmentLength - a.apartment.length + 2)}| ${a.sqFt}${' '.repeat(maxSqFtLength - a.sqFt.length + 2)}| ${a.rent}`
                ).join(`\n${'-'.repeat(maxApartmentLength + maxSqFtLength + maxRentLength + 6)}\n`)

                const message = `${messageHeader}\n<pre>${tableHeader}\n${horizontalLine}\n${apartmentsList}</pre>`

                await sendTelegramMessage(message)
                prevState = newApartments.map(a => `${a.apartment} ${a.sqFt} ${a.rent}`)
                previouslyAvailable = true
            }
        }
    } catch (error) {
        console.error('Error during check and notify:', error)
        const errorMessage = `Encountered an error: ${error.message}`
        uniqueErrors.add(errorMessage) // Add unique errors
        if (lastErrorMessage !== errorMessage) {
            await sendTelegramMessage(errorMessage)
            lastErrorMessage = errorMessage
        }
    }
}

(async () => {
    // setInterval(sendPeriodicReport, 1000 * 60 * 60 * 12) // 12 hours in milliseconds
    setInterval(sendPeriodicReport, 720000) // 12 minutes in milliseconds
    while (true) {
        await checkAndNotify()
        await new Promise(resolve => setTimeout(resolve, 20000)) // Wait for 20 seconds before the next check
    }
})()
