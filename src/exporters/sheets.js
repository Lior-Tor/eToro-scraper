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
