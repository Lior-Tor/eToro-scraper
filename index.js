/**
 * @file CLI entrypoint. Validates env → asks scraping/export mode → orchestrates
 * the browser → delegates per-trader work to src/scraper → fans out to src/exporters.
 */

require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const readline = require('readline');
const fs = require('fs');

// Crash-recovery checkpoint. Holds the in-progress session (filename + completed
// trader payloads) so an interrupted run can resume and skip what's already done.
// Written after every successful trader; deleted once the whole run completes.
const STATE_FILE = '.scraper-state.json';

// TLS bypass for firewalls/VPNs that perform TLS inspection. Controlled from .env:
// set NODE_TLS_REJECT_UNAUTHORIZED=0 to disable certificate verification for this process.
// dotenv (above) loads it into process.env before any HTTPS request, so no hardcoding is
// needed — leaving it unset keeps normal, secure certificate verification.

const { scrapeTrader } = require('./src/scraper');
const { sendToSheets } = require('./src/exporters/sheets');
const { generateExcel } = require('./src/exporters/excel');
const { generateCsv } = require('./src/exporters/csv');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const askQuestion = (rl, question) => new Promise(resolve => rl.question(question, resolve));

// Inter-trader pacing in multi-trader mode — REQUIRED in .env, validated at startup.
const TRADER_GAP_MIN_MS = parseInt(process.env.TRADER_GAP_MIN_MS, 10);
const TRADER_GAP_MAX_MS = parseInt(process.env.TRADER_GAP_MAX_MS, 10);

/**
 * Build the local output filename — `<trader-or-MultiSession>_<YYYY-MM-DD_HH-MM>`.
 * Called once at session start; the same filename is reused for every incremental
 * write so the timestamp doesn't drift between traders.
 * @param {string[]} tradersToScrape - the planned trader list (locks single-vs-multi naming)
 * @returns {string} filename without extension
 */
function buildFileName(tradersToScrape) {
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
    const baseName = tradersToScrape.length === 1 ? tradersToScrape[0] : "eToro_MultiSession";
    return `${baseName}_${timestamp}`;
}

/**
 * Load the recovery checkpoint, or null if absent/unreadable/corrupt.
 * @returns {{fileName: string, sessionData: Array<object>}|null}
 */
function loadState() {
    try {
        const raw = fs.readFileSync(STATE_FILE, 'utf8');
        const state = JSON.parse(raw);
        if (state && Array.isArray(state.sessionData) && state.fileName) return state;
    } catch (e) { /* missing or corrupt — treat as no checkpoint */ }
    return null;
}

/** Write the recovery checkpoint. Never throws — a failed checkpoint must not stop a run. */
function saveState(fileName, sessionData) {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify({ fileName, sessionData }), 'utf8');
    } catch (e) {
        console.log(`⚠️  Could not write recovery checkpoint: ${e.message}`);
    }
}

/** Delete the recovery checkpoint (called once the full run succeeds). Never throws. */
function clearState() {
    try { fs.unlinkSync(STATE_FILE); } catch (e) { /* already gone — fine */ }
}

/**
 * Write the selected local files (Excel/CSV), tolerating a locked target file.
 * On Windows a file open in Excel throws EBUSY/EPERM; we log a clear hint and carry
 * on so the run isn't lost — the next successful trader rewrites the full dataset.
 * @param {Array<object>} sessionData - all traders gathered so far
 * @param {string} fileName - filename without extension
 * @param {{excel: boolean, csv: boolean}} exportFlags
 * @returns {Promise<boolean>} true if every requested local file was written this call
 *   (also true when no local export was requested); false if any write was skipped
 */
async function persistLocalFiles(sessionData, fileName, exportFlags) {
    let allWritten = true;
    const guard = async (label, ext, write) => {
        try {
            await write();
        } catch (err) {
            allWritten = false;
            if (err.code === 'EBUSY' || err.code === 'EPERM') {
                console.log(`⚠️  ${label} file is locked (is "${fileName}.${ext}" open?). Skipped this write — it will catch up on the next trader.`);
            } else {
                console.log(`⚠️  Failed to write ${label} file: ${err.message}`);
            }
        }
    };
    if (exportFlags.excel) await guard('Excel', 'xlsx', () => generateExcel(sessionData, fileName));
    if (exportFlags.csv) await guard('CSV', 'csv', () => generateCsv(sessionData, fileName));
    return allWritten;
}

// ==========================================
// MAIN EXECUTION
// ==========================================

/**
 * Interactive CLI flow: validate env → pick trader mode → pick export mode →
 * ping the webhook (if Sheets selected) → for each trader scrape + optionally
 * stream to Sheets → finally write local Excel/CSV if requested.
 * Fails fast on missing config; per-trader failures are non-fatal (next trader continues).
 * @returns {Promise<void>}
 */
async function start() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    console.log("\n========================================================");
    console.log("   ETORO MULTI-TRADER SCRAPER & ANALYSIS PIPELINE");
    console.log("========================================================\n");

    // --- VALIDATE RATE-LIMITING CONFIG (fail fast before any prompts or browser launch) ---
    const pacingVars = ['ASSET_GAP_MIN_MS', 'ASSET_GAP_MAX_MS', 'TRADER_GAP_MIN_MS', 'TRADER_GAP_MAX_MS', 'HISTORY_BATCH_DELAY_MIN_MS', 'HISTORY_BATCH_DELAY_MAX_MS'];
    const missing = pacingVars.filter(v => !process.env[v]);
    if (missing.length) {
        console.log(`❌ FATAL ERROR: Required rate-limiting variables missing from .env: ${missing.join(', ')}`);
        console.log("   -> See .env.example for the recommended values and copy them in.");
        rl.close();
        return;
    }
    const parsed = Object.fromEntries(pacingVars.map(v => [v, parseInt(process.env[v], 10)]));
    const invalid = pacingVars.filter(v => !Number.isInteger(parsed[v]) || parsed[v] <= 0);
    if (invalid.length) {
        console.log(`❌ FATAL ERROR: Rate-limiting variables must be positive integers: ${invalid.join(', ')}`);
        rl.close();
        return;
    }
    if (parsed.ASSET_GAP_MIN_MS > parsed.ASSET_GAP_MAX_MS) {
        console.log(`❌ FATAL ERROR: ASSET_GAP_MIN_MS (${parsed.ASSET_GAP_MIN_MS}) must be <= ASSET_GAP_MAX_MS (${parsed.ASSET_GAP_MAX_MS}).`);
        rl.close();
        return;
    }
    if (parsed.TRADER_GAP_MIN_MS > parsed.TRADER_GAP_MAX_MS) {
        console.log(`❌ FATAL ERROR: TRADER_GAP_MIN_MS (${parsed.TRADER_GAP_MIN_MS}) must be <= TRADER_GAP_MAX_MS (${parsed.TRADER_GAP_MAX_MS}).`);
        rl.close();
        return;
    }
    if (parsed.HISTORY_BATCH_DELAY_MIN_MS > parsed.HISTORY_BATCH_DELAY_MAX_MS) {
        console.log(`❌ FATAL ERROR: HISTORY_BATCH_DELAY_MIN_MS (${parsed.HISTORY_BATCH_DELAY_MIN_MS}) must be <= HISTORY_BATCH_DELAY_MAX_MS (${parsed.HISTORY_BATCH_DELAY_MAX_MS}).`);
        rl.close();
        return;
    }

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

    // --- RECOVERY: offer to resume an interrupted session ---
    // If a checkpoint exists and overlaps the planned list, the user can skip the
    // traders already gathered and scrape only the ones still missing.
    let resumeSessionData = [];
    let resumeFileName = null;
    const prior = loadState();
    if (prior) {
        const doneSet = new Set(prior.sessionData.map(p => p.traderUsername.toLowerCase()));
        const remaining = tradersToScrape.filter(t => !doneSet.has(t.toLowerCase()));
        if (remaining.length < tradersToScrape.length) {
            const doneCount = tradersToScrape.length - remaining.length;
            console.log(`\n🔄 A previous session was found: ${doneCount}/${tradersToScrape.length} of your planned traders already scraped.`);
            console.log(`   Already done: ${prior.sessionData.map(p => '@' + p.traderUsername).join(', ')}`);
            if (remaining.length === 0) {
                console.log("   All planned traders are already in the checkpoint — nothing left to scrape.");
            } else {
                console.log(`   Still missing: ${remaining.map(t => '@' + t).join(', ')}`);
            }
            const answer = (await askQuestion(rl, "\nResume and scrape only the missing ones? (y/n): ")).trim().toLowerCase();
            if (answer === 'y' || answer === 'yes') {
                resumeSessionData = prior.sessionData;
                resumeFileName = prior.fileName;
                tradersToScrape = remaining;
                console.log(`✅ Resuming — will scrape ${remaining.length} trader(s) and merge with the previous ${doneCount}.`);
            } else {
                console.log("↩️  Starting fresh — the previous checkpoint will be overwritten.");
            }
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

    // Lock the filename now so every incremental write (and the checkpoint) shares it.
    // On resume we keep the original session's name so the same output file is updated.
    const fileName = resumeFileName || buildFileName(tradersToScrape);

    // Seed with any traders recovered from the checkpoint; the loop appends the rest.
    const sessionData = [...resumeSessionData];
    const resuming = resumeSessionData.length > 0;
    const expectedTotal = resumeSessionData.length + tradersToScrape.length;

    // 1920×1080 viewport is critical: eToro's history table virtualizes columns past the
    // viewport, so a smaller viewport silently drops the P/L column from the extracted DOM.
    const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1920, height: 1080 } });

    // Escape hatch for IP blocks or captchas: comment the line above and uncomment below to
    // run a visible browser where you can manually solve a challenge.
    // const browser = await puppeteer.launch({ headless: false, defaultViewport: null });

    for (let i = 0; i < tradersToScrape.length; i++) {
        // isFirstBatch tells the Sheets webhook to clear stale @-tabs. Only the very first
        // trader of a fresh run qualifies — on resume the original run already did this.
        const isFirstBatch = (i === 0) && !resuming;
        const payload = await scrapeTrader(browser, tradersToScrape[i], targetHistoryTrades, isFirstBatch);

        if (payload) {
            sessionData.push(payload);

            // Persist to every selected destination after each successful trader, so a
            // later failure or Ctrl+C never discards data that's already been gathered.
            // Local writes are guarded: a locked file (e.g. open in Excel on Windows)
            // must not crash the run — the next trader's write recovers everything.
            if (exportFlags.sheets) await sendToSheets(payload, process.env.WEBHOOK_URL);
            await persistLocalFiles(sessionData, fileName, exportFlags);
            saveState(fileName, sessionData);
        }

        console.log("⏳ Waiting before next scrape to avoid rate limiting...");
        await delay(TRADER_GAP_MIN_MS + Math.floor(Math.random() * Math.max(1, TRADER_GAP_MAX_MS - TRADER_GAP_MIN_MS)));
    }

    await browser.close();

    // Final flush — if the LAST trader's write was skipped because the file was locked,
    // there's no following trader to recover it, so write one more time here. Track
    // whether it actually landed so we don't discard the checkpoint over a lost file.
    const filesWritten = sessionData.length > 0
        ? await persistLocalFiles(sessionData, fileName, exportFlags)
        : true;

    // Clear the checkpoint only when the run is fully done AND the data is safely on disk:
    // every planned trader succeeded, and the local files were actually written (a CSV/Excel
    // locked for the whole run would otherwise leave neither output nor a checkpoint).
    const allTradersDone = sessionData.length >= expectedTotal;
    if (allTradersDone && filesWritten) {
        clearState();
        console.log("\n🎉 ALL SCRAPING TASKS COMPLETED SUCCESSFULLY!");
    } else if (!allTradersDone) {
        const missing = expectedTotal - sessionData.length;
        console.log(`\n⚠️  Done, but ${missing} trader(s) failed or were blocked. Re-run and choose resume to retry only those.`);
    } else {
        console.log(`\n⚠️  All traders scraped, but the local file is still locked. Close "${fileName}.csv"/".xlsx" and re-run — choosing resume will write it from the checkpoint without re-scraping.`);
    }
}

start();
