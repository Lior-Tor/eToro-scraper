require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const readline = require('readline');
const fs = require('fs');

// Disable TLS certificate validation (Fixes fetch errors behind certain firewalls/VPNs)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Helper utilities
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const askQuestion = (rl, question) => new Promise(resolve => rl.question(question, resolve));

// ==========================================
// LOCAL FILE GENERATION UTILITIES
// ==========================================

async function generateLocalFiles(allData, exportFlags) {
    // --- Create a readable, Windows-compatible timestamp (YYYY-MM-DD_HH-MM) ---
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
    
    // --- Dynamic filename: Trader name (if single) or "MultiSession" (if multiple) ---
    const baseName = allData.length === 1 ? allData[0].traderUsername : "eToro_MultiSession";
    const fileName = `${baseName}_${timestamp}`;

    if (exportFlags.excel) {
        let ExcelJS;
        try {
            ExcelJS = require('exceljs');
        } catch (e) {
            console.error("⚠️  ExcelJS is not installed. Run 'npm install exceljs' to generate .xlsx files.");
            return;
        }

        const workbook = new ExcelJS.Workbook();
        
        for (const data of allData) {
            const ws = workbook.addWorksheet(`@${data.traderUsername}`);
            
            // Helper to add a styled table with a title
            const addStyledTable = (startCol, title, headers, rows) => {
                const titleCell = ws.getCell(1, startCol);
                titleCell.value = title;
                ws.mergeCells(1, startCol, 1, startCol + headers.length - 1);
                titleCell.font = { bold: true, size: 11, color: { argb: 'FF2C3E50' } };
                titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECF0F1' } };
                titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

                const headerRow = ws.getRow(2);
                headers.forEach((h, i) => {
                    const cell = headerRow.getCell(startCol + i);
                    cell.value = h;
                    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2C3E50' } };
                    cell.alignment = { horizontal: 'center', vertical: 'middle' };
                });

                rows.forEach((r, rowIndex) => {
                    const row = ws.getRow(3 + rowIndex);
                    headers.forEach((_, i) => {
                        const cell = row.getCell(startCol + i);
                        cell.value = Object.values(r)[i];
                        cell.border = {
                            top: {style:'thin', color: {argb:'FFE0E0E0'}},
                            left: {style:'thin', color: {argb:'FFE0E0E0'}},
                            bottom: {style:'thin', color: {argb:'FFE0E0E0'}},
                            right: {style:'thin', color: {argb:'FFE0E0E0'}}
                        };
                        cell.alignment = { horizontal: 'center', vertical: 'middle' };
                    });
                });
            };

            addStyledTable(1, "OVERVIEW", ['Ticker', 'Invested (%)', 'P/L (%)'], data.overview);
            addStyledTable(5, "PAST PERFORMANCE", ['Year','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','YTD'], data.stats);
            const formattedTrades = data.trades.map(t => ({ action: t.action, date: t.date, amount: t.amount, openPrice: t.openPrice }));
            addStyledTable(20, "ACTIVE TRADES", ['Action', 'Date', 'Amount', 'Open Price'], formattedTrades);
            addStyledTable(25, "CLOSED HISTORY", ['Action', 'Open Price', 'Open Date', 'Close Price', 'Close Date', 'P/L (%)'], data.history);
            
            ws.columns.forEach(col => col.width = 15);
        }

        await workbook.xlsx.writeFile(`${fileName}.xlsx`);
        console.log(`\n📊 Excel file successfully generated: ${fileName}.xlsx`);
    }

    if (exportFlags.csv) {
        let csvContent = "";
        const s = (val) => `"${String(val).replace(/"/g, '""')}"`;

        allData.forEach(data => {
            csvContent += `=== START OF TRADER: @${data.traderUsername} ===\n\n`;
            
            csvContent += "--- OVERVIEW ---\nTicker,Invested (%),P/L (%)\n";
            data.overview.forEach(r => csvContent += `${s(r.ticker)},${s(r.invested)},${s(r.pl)}\n`);
            
            csvContent += "\n--- PAST PERFORMANCE ---\nYear,Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec,YTD\n";
            data.stats.forEach(r => csvContent += `${s(r.year)},${s(r.jan)},${s(r.feb)},${s(r.mar)},${s(r.apr)},${s(r.may)},${s(r.jun)},${s(r.jul)},${s(r.aug)},${s(r.sep)},${s(r.oct)},${s(r.nov)},${s(r.dec)},${s(r.ytd)}\n`);
            
            csvContent += "\n--- ACTIVE TRADES ---\nAction,Date,Amount,Open Price\n";
            data.trades.forEach(r => csvContent += `${s(r.action)},${s(r.date)},${s(r.amount)},${s(r.openPrice)}\n`);
            
            csvContent += "\n--- CLOSED HISTORY ---\nAction,Open Price,Open Date,Close Price,Close Date,P/L (%)\n";
            data.history.forEach(r => csvContent += `${s(r.action)},${s(r.open)},${s(r.openDate)},${s(r.close)},${s(r.closeDate)},${s(r.pl)}\n`);
            
            csvContent += `\n=== END OF TRADER: @${data.traderUsername} ===\n\n\n`;
        });

        fs.writeFileSync(`${fileName}.csv`, csvContent, 'utf8');
        console.log(`💾 CSV file successfully generated: ${fileName}.csv`);
    }
}

// ==========================================
// CORE SCRAPER FUNCTION
// ==========================================

async function scrapeTrader(browser, trader, targetHistoryTrades, isFirstBatch) {
    console.log(`\n========================================================`);
    console.log(`🚀 SCRAPING IN PROGRESS FOR TRADER: @${trader.toUpperCase()}`);
    console.log(`========================================================`);
    
    let page;
    try {
        page = await browser.newPage();
    } catch (e) {
        console.error("❌ ERROR: Could not open a new browser page.");
        return null;
    }
    
    const payload = { type: "full_portfolio", traderUsername: trader, isFirstBatch, overview: [], stats: [], trades: [], history: [] };

    try {
        // --- PHASE 1: OVERVIEW ---
        console.log(`🌐 [PHASE 1] Navigating to ${trader}'s portfolio...`);
        await page.goto(`https://www.etoro.com/people/${trader}/portfolio`, { waitUntil: 'networkidle2' });

        try { 
            await page.waitForSelector('.et-table-body > div', { timeout: 10000 }); 
        } catch (e) { 
            console.error(`❌ ERROR: Could not find portfolio for '${trader}'. The user might not exist or profile is private. Skipping...`); 
            return null; 
        }

        payload.overview = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('.et-table-body > div'));
            const results = [];
            rows.forEach(row => {
                const tickerEl = row.querySelector('[automation-id="cd-public-portfolio-table-item-title"]');
                const columns = row.querySelectorAll('.et-table-body-slot > div');
                if (tickerEl && columns.length >= 3) results.push({ ticker: tickerEl.innerText.trim(), invested: columns[1].innerText.trim(), pl: columns[2].innerText.trim() });
            });
            return results;
        });
        console.log(`✅ Found ${payload.overview.length} assets.`);

        // --- PHASE 2: PAST PERFORMANCE STATS ---
        console.log(`📊 [PHASE 2] Extracting Past Performance...`);
        await page.goto(`https://www.etoro.com/people/${trader}/stats`, { waitUntil: 'networkidle2' });
        await page.waitForSelector('et-user-performance-chart-new', { timeout: 15000 });

        try {
            // Force click "Show More" to load older years
            const hasClicked = await page.evaluate(() => {
                const btn = document.querySelector('.performance-chart-extend, .performance-chart-extend span');
                if (btn && btn.offsetParent !== null) { btn.click(); return true; }
                return false;
            });
            if (hasClicked) await delay(3000);
        } catch (e) {}

        payload.stats = await page.evaluate(() => {
            const rows = document.querySelectorAll('.performance-chart-info');
            const data = [];
            rows.forEach(row => {
                // eToro HTML is rendered Right-To-Left. We dynamically find the year column.
                const cols = Array.from(row.children).map(c => c.innerText.trim());
                const yearIndex = cols.findIndex(c => /^20\d{2}$/.test(c));
                if (yearIndex !== -1 && cols.length >= 14) {
                    data.push({ year: cols[yearIndex], jan: cols[yearIndex - 1] || "", feb: cols[yearIndex - 2] || "", mar: cols[yearIndex - 3] || "", apr: cols[yearIndex - 4] || "", may: cols[yearIndex - 5] || "", jun: cols[yearIndex - 6] || "", jul: cols[yearIndex - 7] || "", aug: cols[yearIndex - 8] || "", sep: cols[yearIndex - 9] || "", oct: cols[yearIndex - 10] || "", nov: cols[yearIndex - 11] || "", dec: cols[yearIndex - 12] || "", ytd: cols[yearIndex - 13] || "" });
                }
            });
            return data.sort((a, b) => parseInt(b.year) - parseInt(a.year)); // Sort descending
        });
        console.log(`✅ Extracted ${payload.stats.length} years of stats.`);

        // --- PHASE 3: ACTIVE TRADES ---
        console.log(`🔄 [PHASE 3] Extracting active trades...`);
        for (const asset of payload.overview) {
            try {
                await page.goto(`https://www.etoro.com/people/${trader}/portfolio/${asset.ticker.toLowerCase()}`, { waitUntil: 'networkidle2' });
                await page.waitForSelector('.et-table-body > div', { timeout: 10000 }); 
                const tickerTrades = await page.evaluate((currentTicker) => {
                    const rows = Array.from(document.querySelectorAll('.et-table-body > div'));
                    const results = [];
                    rows.forEach(row => {
                        const actionEl = row.querySelector('.et-table-first-cell .et-font-xs.et-bold-font');
                        const dateEl = row.querySelector('.et-table-first-cell .et-font-xxs > span');
                        const amountEl = row.querySelector('.et-table-body-slot > div:nth-child(1) span');
                        const openPriceEl = row.querySelector('.et-table-body-slot > div:nth-child(3) span');
                        if (actionEl && dateEl && amountEl && openPriceEl) {
                            results.push({ ticker: currentTicker, action: actionEl.innerText.trim(), date: dateEl.innerText.trim(), amount: amountEl.innerText.trim(), openPrice: openPriceEl.innerText.trim() });
                        }
                    });
                    return results;
                }, asset.ticker);
                payload.trades.push(...tickerTrades);
            } catch (err) {}
            await delay(3000 + Math.floor(Math.random() * 2000)); 
        }
        console.log(`✅ Extracted ${payload.trades.length} active trades.`);

        // --- PHASE 4: CLOSED HISTORY ---
        const maxClicks = Math.ceil(Math.max(0, targetHistoryTrades - 30) / 30);
        console.log(`🕰️  [PHASE 4] Extracting closed history (~${targetHistoryTrades} trades targeted)...`);
        await page.goto(`https://www.etoro.com/people/${trader}/portfolio/history`, { waitUntil: 'networkidle2' });
        await page.waitForSelector('#publicHistoryFlatView', { timeout: 15000 });

        let clickCount = 0;
        while (clickCount < maxClicks) {
            try {
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                await delay(2000); 
                const hasClicked = await page.evaluate(() => {
                    const btn = document.querySelector('et-people-portfolio-history-flat > button');
                    if (btn && btn.offsetParent !== null) { btn.click(); return true; }
                    return false;
                });
                if (!hasClicked) break; // End of history reached
                await delay(3000); 
                clickCount++;
                process.stdout.write(`.`); 
            } catch (e) { break; }
        }
        console.log(`\n   Finished expanding list. Extracting table data...`);

        payload.history = await page.evaluate(() => {
            const slots = Array.from(document.querySelectorAll('#publicHistoryFlatView .et-table-body-slot'));
            const results = [];
            slots.forEach(slot => {
                const row = slot.closest('.et-table-body > *, et-people-portfolio-history-item') || slot.parentElement;
                
                // 1. ACTION (ex: "Buy AAPL")
                let action = row.querySelector('.et-table-first-cell')?.innerText.trim() || row.innerText.split('\n')[0].trim(); 
                
                // 2. OPEN (Price & Dates)
                const open = slot.children[1]?.innerText.trim() || "";
                const openTimeContainer = slot.children[2];
                const openDate = openTimeContainer?.querySelector('p:nth-child(1)')?.innerText.trim() || openTimeContainer?.innerText.trim().split('\n')[0] || "";
                const openTime = openTimeContainer?.querySelector('p:nth-child(2)')?.innerText.trim() || openTimeContainer?.innerText.trim().split('\n')[1] || "";
                
                // 3. CLOSE (Price & Dates)
                const close = slot.children[3]?.innerText.trim() || "";
                const closeTimeContainer = slot.children[4];
                const closeDate = closeTimeContainer?.querySelector('p:nth-child(1)')?.innerText.trim() || closeTimeContainer?.innerText.trim().split('\n')[0] || "";
                const closeTime = closeTimeContainer?.querySelector('p:nth-child(2)')?.innerText.trim() || closeTimeContainer?.innerText.trim().split('\n')[1] || "";
                
                const plNode = row.querySelector('[automation-id="cd-public-history-flat-table-item-gain"]');
                let pl = "";
                
                if (plNode) {
                    pl = plNode.textContent.replace(/\s+/g, '');
                } else {
                    // Fallback
                    const fallbackNode = row.querySelector('.positive, .negative');
                    if (fallbackNode && fallbackNode.textContent.includes('%')) {
                        pl = fallbackNode.textContent.replace(/\s+/g, '');
                    }
                }

                if (open || close || pl) {
                    results.push({ action, open, openDate: `${openDate} ${openTime}`.trim(), close, closeDate: `${closeDate} ${closeTime}`.trim(), pl });
                }
            });
            return results;
        });
        console.log(`✅ Extracted ${payload.history.length} historical trades.`);

        return payload;

    } catch (error) {
        console.error(`❌ Fatal Error for trader ${trader}:`, error);
        return null;
    } finally {
        if (page && !page.isClosed()) {
            await page.close();
        }
    }
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
    const browser = await puppeteer.launch({ headless: true });

    // In case of blocked IP or aggressive anti-scraping, use to open browser window and pass CAPTCHA or other verification.
    // const browser = await puppeteer.launch({ headless: false, defaultViewport: null });

    const sessionData = []; // Array to hold payloads for all traders
    
    for (let i = 0; i < tradersToScrape.length; i++) {
        const isFirstBatch = (i === 0);
        const payload = await scrapeTrader(browser, tradersToScrape[i], targetHistoryTrades, isFirstBatch);
        
        if (payload) {
            sessionData.push(payload);
            
            // If Google Sheets is selected, stream data immediately to avoid holding everything in memory
            if (exportFlags.sheets) {
                console.log(`\n📤 Sending @${payload.traderUsername}'s data to Google Sheets...`);
                try {
                    const response = await fetch(process.env.WEBHOOK_URL, {
                        method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' }
                    });
                    console.log(`☁️  Sheets Response: ${await response.text()}`);
                } catch (err) {
                    console.log(`❌ Failed to send data to Google Sheets: ${err.message}`);
                }
            }
        }

        console.log("⏳ Waiting before next scrape to avoid rate limiting...");
        await delay(5000 + Math.floor(Math.random() * 3000));
    }

    await browser.close();

    // --- LOCAL FILE GENERATION ---
    if (sessionData.length > 0 && (exportFlags.excel || exportFlags.csv)) {
        console.log(`\n📦 Generating local export files...`);
        await generateLocalFiles(sessionData, exportFlags);
    }

    console.log("\n🎉 ALL SCRAPING TASKS COMPLETED SUCCESSFULLY!");
}

start();