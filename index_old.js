require('dotenv').config()
const fetch = require('node-fetch')
const cheerio = require('cheerio')

const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN
const chatId = process.env.TELEGRAM_CHAT_ID
const url = 'https://morgan-properties.securecafe.com/onlineleasing/riverside-towers-apartment-homes/availableunits.aspx'

let prevState = []
let previouslyAvailable = false

async function fetchApartments() {
    try {
        const response = await fetch(url)
        const text = await response.text()
        const $ = cheerio.load(text)
        const apartments = []

        $('table.availableUnits').each((index, element) => {
            $(element).find('tbody > tr').each((idx, elem) => {
                const apartment = $(elem).find('td[data-selenium-id="Apt1"]').text().trim()
                const sqFt = $(elem).find('td[data-selenium-id="SqFt1"]').text().trim()
                const rent = $(elem).find('td[data-selenium-id="Rent1"]').text().trim()

                if (apartment && sqFt && rent) {
                    apartments.push({ apartment, sqFt, rent })
                }
            })
        })

        return apartments
    } catch (error) {
        console.error('Failed to fetch or parse apartments:', error)
        return [] // Return an empty array to signify no data could be processed
    }
}

function sendTelegramMessage(message) {
    fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML'
        })
    }).then(response => response.json()).catch(error => console.error('Error sending Telegram message:', error))
}

async function checkAndNotify() {
    try {
        const apartments = await fetchApartments()
        console.log('apartments =', apartments)

        if (apartments.length === 0 && previouslyAvailable) {
            sendTelegramMessage('No apartments are currently available.')
            previouslyAvailable = false
            prevState = []
        } else if (apartments.length > 0) {
            const newState = apartments.map(a => `${a.apartment} ${a.sqFt} ${a.rent}`)
            const newApartments = newState.filter(state => !prevState.includes(state))

            if (newApartments.length > 0) {
                const message = `<b>New Apartments Available!</b>\n<pre>${newApartments.join('\n')}</pre>`
                sendTelegramMessage(message)
                prevState = newState
                previouslyAvailable = true
            }
        }
    } catch (error) {
        console.error('Error during check and notify:', error)
        sendTelegramMessage(`Encountered an error: ${error.message}`)
    }
}

setInterval(checkAndNotify, 20000)
