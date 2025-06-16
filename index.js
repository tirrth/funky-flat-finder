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
let apartmentsChanged = false

function generateApartmentKey(a) {
    return `${a.apartment}__${a.sqFt}__${a.rent}`.toLowerCase().replace(/\s+/g, '')
}

async function fetchApartments() {
    let browser
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        })
        const page = await browser.newPage()
        await page.goto(url, { waitUntil: 'networkidle2' })

        const apartments = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('table.availableUnits tbody > tr'))
            return rows.map(row => {
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
        return []
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

function formatDuration(ms) {
    const totalSeconds = ms / 1000
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = Math.floor(totalSeconds % 60)
    return `${hours} hours, ${minutes} minutes, ${seconds} seconds`
}

async function sendPeriodicReport() {
    const runningTime = Date.now() - processStartTime
    const formattedRunningTime = formatDuration(runningTime)
    const message = `<b>📊 Process Report 📊</b>\n` +
        `Running Time: ${formattedRunningTime}\n` +
        `Checks Performed: ${checksPerformed}\n` +
        `Apartments Availability Changed: ${apartmentsChanged ? 'Yes' : 'No'}\n` +
        `Unique Errors Encountered: ${uniqueErrors.size}`

    await sendTelegramMessage(message)
}

function formatApartmentList(title, apartments) {
    if (apartments.length === 0) return ''

    const maxApartmentLength = Math.max(...apartments.map(a => a.apartment.length), 'Apartment'.length)
    const maxSqFtLength = Math.max(...apartments.map(a => a.sqFt.length), 'Sq.Ft'.length)
    const maxRentLength = Math.max(...apartments.map(a => a.rent.length), 'Rent'.length)

    const header = `<b>${title}</b>\n`
    const tableHeader = `<b>Apartment${' '.repeat(maxApartmentLength - 'Apartment'.length + 2)}| Sq.Ft${' '.repeat(maxSqFtLength - 'Sq.Ft'.length + 2)}| Rent</b>`
    const separator = `${'-'.repeat(maxApartmentLength + maxSqFtLength + maxRentLength + 6)}`
    const rows = apartments.map(a =>
        `${a.apartment}${' '.repeat(maxApartmentLength - a.apartment.length + 2)}| ${a.sqFt}${' '.repeat(maxSqFtLength - a.sqFt.length + 2)}| ${a.rent}`
    ).join(`\n${separator}\n`)

    return `${header}<pre>${tableHeader}\n${separator}\n${rows}</pre>`
}

async function checkAndNotify() {
    checksPerformed++
    apartmentsChanged = false

    try {
        const apartments = await fetchApartments()
        console.log('apartments =', apartments, ' time =', new Date().toISOString())

        const currentKeys = new Set(apartments.map(generateApartmentKey))
        const prevKeys = new Set(prevState)

        const newApartments = apartments.filter(a => !prevKeys.has(generateApartmentKey(a)))
        const removedApartments = prevState
            .filter(k => !currentKeys.has(k))
            .map(key => {
                const [apartment, sqFt, ...rentParts] = key.split('__')
                return { apartment, sqFt, rent: rentParts.join('__') }
            })

        if (newApartments.length > 0 || removedApartments.length > 0) {
            apartmentsChanged = true
            let sections = []

            if (newApartments.length > 0) {
                sections.push(formatApartmentList('🆕 New Apartments:', newApartments))
            }

            if (removedApartments.length > 0) {
                sections.push(formatApartmentList('❌ Removed Apartments:', removedApartments))
            }

            if (apartments.length > 0) {
                sections.push(formatApartmentList('✅ Currently Available:', apartments))
            } else {
                sections.push('<b>🚫 No apartments currently available.</b>')
            }

            const fullMessage = `<b>🚨 Apartment Availability Update! 🚨</b>\n\n${sections.join('\n\n')}`
            await sendTelegramMessage(fullMessage)

            prevState = [...currentKeys]
            previouslyAvailable = apartments.length > 0
        }

        if (apartments.length === 0 && previouslyAvailable) {
            await sendTelegramMessage('Oops, all the apartments vanished! 🏃‍♂️💨 You snooze, you lose, bruh! 😜')
            previouslyAvailable = false
            apartmentsChanged = true
            prevState = []
        }
    } catch (error) {
        console.error('Error during check and notify:', error)
        const errorMessage = `Encountered an error: ${error.message}`
        uniqueErrors.add(errorMessage)
        if (lastErrorMessage !== errorMessage) {
            await sendTelegramMessage(errorMessage)
            lastErrorMessage = errorMessage
        }
    }
}

async function startProcess() {
    const startTime = new Date()
    await sendTelegramMessage(`Process started at ${startTime.toISOString()}`)
    console.log('Process started')

    let lastReportTime = Date.now()

    while (true) {
        await checkAndNotify()

        if (Date.now() - lastReportTime >= 4 * 60 * 60 * 1000) { // 4 hours
            await sendPeriodicReport()
            lastReportTime = Date.now()
        }

        await new Promise(resolve => setTimeout(resolve, 20000)) // 20 sec interval
    }
}

startProcess()
