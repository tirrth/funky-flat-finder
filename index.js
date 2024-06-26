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
let apartmentsChanged = false // Variable to track if apartments availability changed

async function fetchApartments() {
    let browser
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'] // Recommended for server environments
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

// async function checkAndNotify() {
//     checksPerformed++
//     apartmentsChanged = false // Reset the flag at the start of each check
//     try {
//         const apartments = await fetchApartments()
//         console.log('apartments =', apartments, ' time =', (new Date()).toISOString())

//         if (apartments.length === 0 && previouslyAvailable) {
//             await sendTelegramMessage('Oops, all the apartments vanished! 🏃‍♂️💨 You snooze, you lose, bruh! 😜')
//             previouslyAvailable = false
//             apartmentsChanged = true // Indicate change
//             prevState = []
//         } else if (apartments.length > 0) {
//             const newApartments = apartments.filter(a => {
//                 const aptDetails = `${a.apartment} ${a.sqFt} ${a.rent}`
//                 return !prevState.includes(aptDetails)
//             })

//             if (newApartments.length > 0 || prevState.length !== apartments.length) {
//                 apartmentsChanged = true // Indicate change if there are new apartments or the list length has changed
//             }

//             if (newApartments.length > 0) {
//                 // Similar message construction as before, sending new apartments list...
//                 const maxApartmentLength = Math.max(...newApartments.map(a => a.apartment.length), 'Apartment'.length)
//                 const maxSqFtLength = Math.max(...newApartments.map(a => a.sqFt.length), 'Sq.Ft'.length)
//                 const maxRentLength = Math.max(...newApartments.map(a => a.rent.length), 'Rent'.length)

//                 const messageHeader = '<b>🚨 New Apartments Available! 🚨</b>\n'
//                 const tableHeader = `<b>Apartment${' '.repeat(maxApartmentLength - 'Apartment'.length + 2)}| Sq.Ft${' '.repeat(maxSqFtLength - 'Sq.Ft'.length + 2)}| Rent</b>`
//                 const horizontalLine = `${'-'.repeat(maxApartmentLength + maxSqFtLength + maxRentLength + 6)}`

//                 const apartmentsList = newApartments.map(a =>
//                     `${a.apartment}${' '.repeat(maxApartmentLength - a.apartment.length + 2)}| ${a.sqFt}${' '.repeat(maxSqFtLength - a.sqFt.length + 2)}| ${a.rent}`
//                 ).join(`\n${'-'.repeat(maxApartmentLength + maxSqFtLength + maxRentLength + 6)}\n`)

//                 const message = `${messageHeader}\n<pre>${tableHeader}\n${horizontalLine}\n${apartmentsList}</pre>`

//                 await sendTelegramMessage(message)

//                 prevState = apartments.map(a => `${a.apartment} ${a.sqFt} ${a.rent}`)
//                 previouslyAvailable = true
//             }
//         }
//     } catch (error) {
//         console.error('Error during check and notify:', error)
//         const errorMessage = `Encountered an error: ${error.message}`
//         uniqueErrors.add(errorMessage) // Add unique errors
//         if (lastErrorMessage !== errorMessage) {
//             await sendTelegramMessage(errorMessage)
//             lastErrorMessage = errorMessage
//         }
//     }
// }

async function checkAndNotify() {
    checksPerformed++
    apartmentsChanged = false // Reset the flag at the start of each check
    try {
        const apartments = await fetchApartments()
        console.log('apartments =', apartments, ' time =', (new Date()).toISOString())

        const currentApartmentDetails = apartments.map(a => `${a.apartment} ${a.sqFt} ${a.rent}`)
        const newApartments = apartments.filter(a => !prevState.includes(`${a.apartment} ${a.sqFt} ${a.rent}`))
        const removedApartments = prevState.filter(apt => !currentApartmentDetails.includes(apt))

        if (newApartments.length > 0 || removedApartments.length > 0) {
            apartmentsChanged = true // Indicate any change
            let message = '<b>🚨 Apartment Availability Update! 🚨</b>'

            if (newApartments.length > 0) {
                message += formatApartmentList('\n\nNew Apartments Available:', newApartments)
            }

            if (removedApartments.length > 0) {
                // Extract apartment details from the previous state for formatting
                const formattedRemoved = removedApartments.map(apt => {
                    let parts = apt.split(' ')
                    return { apartment: parts[0], sqFt: parts[1], rent: parts.slice(2).join(' ') }
                })
                message += formatApartmentList('\n\nRemoved Apartments:', formattedRemoved)
            }

            await sendTelegramMessage(message)
            prevState = currentApartmentDetails
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
        uniqueErrors.add(errorMessage) // Add unique errors
        if (lastErrorMessage !== errorMessage) {
            await sendTelegramMessage(errorMessage)
            lastErrorMessage = errorMessage
        }
    }
}

function formatApartmentList(header, apartments) {
    const maxApartmentLength = Math.max(...apartments.map(a => a.apartment.length), 'Apartment'.length)
    const maxSqFtLength = Math.max(...apartments.map(a => a.sqFt.length), 'Sq.Ft'.length)
    const maxRentLength = Math.max(...apartments.map(a => a.rent.length), 'Rent'.length)

    const messageHeader = `<b>${header}</b>\n`
    const tableHeader = `<b>Apartment${' '.repeat(maxApartmentLength - 'Apartment'.length + 2)}| Sq.Ft${' '.repeat(maxSqFtLength - 'Sq.Ft'.length + 2)}| Rent</b>`
    const horizontalLine = `${'-'.repeat(maxApartmentLength + maxSqFtLength + maxRentLength + 6)}`

    const apartmentsList = apartments.map(a =>
        `${a.apartment}${' '.repeat(maxApartmentLength - a.apartment.length + 2)}| ${a.sqFt}${' '.repeat(maxSqFtLength - a.sqFt.length + 2)}| ${a.rent}`
    ).join(`\n${horizontalLine}\n`)

    return messageHeader + `<pre>${tableHeader}\n${horizontalLine}\n${apartmentsList}</pre>`
}


async function startProcess() {
    const startTime = new Date()
    await sendTelegramMessage(`Process started at ${startTime.toISOString()}`)
    console.log('Process started')

    let lastReportTime = Date.now() // Initialize last report time to now

    // Main loop for checking apartments and sending periodic reports
    while (true) {
        await checkAndNotify()

        // Check if 4 hours has passed since the last report
        if (Date.now() - lastReportTime >= 14400000) { // 3600000ms = 1 hour
            await sendPeriodicReport()
            lastReportTime = Date.now() // Reset last report time
        }

        // Wait for 20 seconds before the next check
        await new Promise(resolve => setTimeout(resolve, 20000))
    }

    // // If you ever decide to stop the process programmatically, add a stop condition and log the end
    // console.log('Process stopped')
    // const endTime = new Date()
    // await sendTelegramMessage(`Process stopped at ${endTime.toISOString()}`)
}

startProcess() // Call to start the entire process
