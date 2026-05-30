/**
 * @file Google Sheets exporter — POSTs a per-trader payload to a Google Apps Script
 * Web App that writes it into the spreadsheet.
 */

/**
 * POST a single trader's payload to the Sheets webhook. Logs the response or any
 * network error — never throws, so a Sheets failure doesn't abort the broader run.
 * @param {object} payload - the scrapeTrader() result for one trader
 * @param {string} webhookUrl - the Apps Script Web App /exec URL
 * @returns {Promise<void>}
 */
async function sendToSheets(payload, webhookUrl) {
    console.log(`\n📤 Sending @${payload.traderUsername}'s data to Google Sheets...`);
    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'application/json' }
        });
        console.log(`☁️  Sheets Response: ${await response.text()}`);
    } catch (err) {
        console.log(`❌ Failed to send data to Google Sheets: ${err.message}`);
    }
}

module.exports = { sendToSheets };
