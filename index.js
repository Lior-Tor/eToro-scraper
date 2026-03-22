require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const readline = require('readline');

// Disable TLS certificate validation (Fixes fetch errors behind certain firewalls/VPNs)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { scrapeTrader } = require('./src/scraper');
const { sendToSheets } = require('./src/exporters/sheets');
const { generateExcel } = require('./src/exporters/excel');
const { generateCsv } = require('./src/exporters/csv');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const askQuestion = (rl, question) => new Promise(resolve => rl.question(question, resolve));

function buildFileName(allData) {
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
    const baseName = allData.length === 1 ? allData[0].traderUsername : "eToro_MultiSession";
    return `${baseName}_${timestamp}`;
}

// ==========================================
// MAIN EXECUTION
// ==========================================

async function start() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    console.log("\n========================================================");
    console.log("   ETORO MULTI-TRADER SCRAPER & ANALYSIS PIPELINE");
    console.log("========================================================\n");

    // --- STEP 1: TRADER SELECTION ---
    console.log("STEP 1: Choose a scraping mode:");
    console.log("  [1] Single Trader (Uses TRADER_USERNAME from .env)");
    console.log("  [2] Multiple Traders (Uses MULTIPLE_TRADER_USERNAMES from .env)");

    let mode = "";
    while (mode !== "1" && mode !== "2") {
        mode = (await askQuestion(rl, "\nEnter 1 or 2: ")).trim();
    }

    let tradersToScrape = [];
    if (mode === "1") {
        const singleTrader = process.env.TRADER_USERNAME;
        if (!singleTrader || singleTrader.trim() === "") {
            console.log("\n❌ ERROR: 'TRADER_USERNAME' is missing or empty in your .env file.");
            rl.close(); return;
        }
        tradersToScrape = [singleTrader.trim()];
    } else {
        const rawMultiple = process.env.MULTIPLE_TRADER_USERNAMES || "";
        tradersToScrape = rawMultiple.split(',').map(t => t.trim()).filter(t => t.length > 0);
        if (tradersToScrape.length === 0) {
            console.log("\n❌ ERROR: 'MULTIPLE_TRADER_USERNAMES' is missing or empty in your .env file.");
            rl.close(); return;
        }
    }

    // --- STEP 2: EXPORT SELECTION ---
    console.log("\nSTEP 2: Where do you want to send the data?");
    console.log("  [1] Google Sheets Only (Requires Webhook)");
    console.log("  [2] Local Excel File (.xlsx) Only");
    console.log("  [3] Local CSV File (.csv) Only");
    console.log("  [4] Google Sheets + Excel");
    console.log("  [5] Google Sheets + CSV");
    console.log("  [6] Excel + CSV");
    console.log("  [7] ALL of the above");

    let destMode = "";
    while (!["1", "2", "3", "4", "5", "6", "7"].includes(destMode)) {
        destMode = (await askQuestion(rl, "\nEnter a number between 1 and 7: ")).trim();
    }
    rl.close();

    const exportFlags = {
        sheets: ["1", "4", "5", "7"].includes(destMode),
        excel:  ["2", "4", "6", "7"].includes(destMode),
        csv:    ["3", "5", "6", "7"].includes(destMode)
    };

    // --- SAFETY CHECK FOR GOOGLE SHEETS WEBHOOK ---
    if (exportFlags.sheets) {
        const webhookUrl = process.env.WEBHOOK_URL;
        if (!webhookUrl || !webhookUrl.startsWith("https://script.google.com/macros/s/")) {
            console.log("\n❌ FATAL ERROR: You selected Google Sheets export, but 'WEBHOOK_URL' is missing or invalid in your .env file.");
            console.log("   -> Ensure it looks like: https://script.google.com/macros/s/.../exec");
            return;
        }

        console.log("\n🔌 Verifying Google Sheets Webhook connection...");
        try {
            const testResponse = await fetch(webhookUrl, {
                method: 'POST',
                body: JSON.stringify({ type: "ping_test" }),
                headers: { 'Content-Type': 'application/json' }
            });
            const testText = await testResponse.text();

            if (testText.toLowerCase().includes("<!doctype html>") || testText.includes("<html")) {
                console.log("\n❌ FATAL ERROR: The WEBHOOK_URL seems to be broken or unpublished.");
                console.log("   -> Did you paste the correct link? It should end with '/exec'");
                console.log("   -> Did you deploy it as a 'Web App' and set access to 'Anyone'?");
                console.log("   -> Aborting execution to save your time.");
                return;
            }
            console.log("✅ Webhook connection successful!");
        } catch (err) {
            console.log(`\n❌ FATAL ERROR: Could not reach the Webhook URL. (${err.message})`);
            return;
        }
    }

    // --- INITIATE SCRAPING ---
    const targetHistoryTrades = parseInt(process.env.HISTORY_TRADES_TARGET, 10) || 500;

    // Note: If you encounter IP blocks (scraping has errors), use the next browser variable. Remember to switch back for faster scraping once done.
    const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1920, height: 1080 } });

    // In case of blocked IP or aggressive anti-scraping, use to open browser window and pass CAPTCHA or other verification.
    // const browser = await puppeteer.launch({ headless: false, defaultViewport: null });

    const sessionData = [];

    for (let i = 0; i < tradersToScrape.length; i++) {
        const isFirstBatch = (i === 0);
        const payload = await scrapeTrader(browser, tradersToScrape[i], targetHistoryTrades, isFirstBatch);

        if (payload) {
            sessionData.push(payload);

            // If Google Sheets is selected, stream data immediately to avoid holding everything in memory
            if (exportFlags.sheets) {
                await sendToSheets(payload, process.env.WEBHOOK_URL);
            }
        }

        console.log("⏳ Waiting before next scrape to avoid rate limiting...");
        await delay(5000 + Math.floor(Math.random() * 3000));
    }

    await browser.close();

    // --- LOCAL FILE GENERATION ---
    if (sessionData.length > 0 && (exportFlags.excel || exportFlags.csv)) {
        console.log(`\n📦 Generating local export files...`);
        const fileName = buildFileName(sessionData);
        if (exportFlags.excel) await generateExcel(sessionData, fileName);
        if (exportFlags.csv) generateCsv(sessionData, fileName);
    }

    console.log("\n🎉 ALL SCRAPING TASKS COMPLETED SUCCESSFULLY!");
}

start();
