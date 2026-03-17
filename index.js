require('dotenv').config();
const puppeteer = require('puppeteer');

// Disable TLS certificate validation (use with caution)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Helper function to pause execution (polite scraping)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function scrapeEtoro() {
    console.log("🚀 Launching Master Scraper...");
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    
    const trader = process.env.TRADER_USERNAME || "thomaspj";
    const masterPayload = {
        type: "full_portfolio",
        overview: [],
        trades: []
    };

    try {
        // ==========================================
        // PHASE 1: SCRAPE PORTFOLIO OVERVIEW
        // ==========================================
        console.log(`\n🌐 [PHASE 1] Navigating to ${trader}'s main portfolio...`);
        await page.goto(`https://www.etoro.com/people/${trader}/portfolio`, { waitUntil: 'networkidle2' });

        console.log("⏳ Waiting for the main table...");
        await page.waitForSelector('.et-table-body > div', { timeout: 15000 });

        console.log("🔍 Extracting tickers...");
        masterPayload.overview = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('.et-table-body > div'));
            const results = [];
            rows.forEach(row => {
                const tickerEl = row.querySelector('[automation-id="cd-public-portfolio-table-item-title"]');
                const columns = row.querySelectorAll('.et-table-body-slot > div');
                
                if (tickerEl && columns.length >= 3) {
                    const investedText = columns[1].innerText.trim();
                    const plText = columns[2].innerText.trim();
                    const tickerText = tickerEl.innerText.trim();

                    if (tickerText && investedText) {
                        results.push({ ticker: tickerText, invested: investedText, pl: plText });
                    }
                }
            });
            return results;
        });
        
        console.log(`✅ Found ${masterPayload.overview.length} assets!`);

        // ==========================================
        // PHASE 2: LOOP THROUGH TICKERS FOR TRADES
        // ==========================================
        console.log(`\n🔄 [PHASE 2] Starting deep extraction for each asset...`);
        
        for (const asset of masterPayload.overview) {
            const tickerUrl = `https://www.etoro.com/people/${trader}/portfolio/${asset.ticker.toLowerCase()}`;
            console.log(`\n👉 Extracting trades for ${asset.ticker} (${tickerUrl})...`);
            
            try {
                await page.goto(tickerUrl, { waitUntil: 'networkidle2' });
                await page.waitForSelector('.et-table-body > div', { timeout: 10000 }); // 10s timeout
                
                const tickerTrades = await page.evaluate((currentTicker) => {
                    const rows = Array.from(document.querySelectorAll('.et-table-body > div'));
                    const results = [];
                    
                    rows.forEach(row => {
                        const actionEl = row.querySelector('.et-table-first-cell .et-font-xs.et-bold-font');
                        const dateEl = row.querySelector('.et-table-first-cell .et-font-xxs > span');
                        const amountEl = row.querySelector('.et-table-body-slot > div:nth-child(1) span');
                        const openPriceEl = row.querySelector('.et-table-body-slot > div:nth-child(3) span');

                        if (actionEl && dateEl && amountEl && openPriceEl) {
                            results.push({
                                ticker: currentTicker, // We inject the ticker name here
                                action: actionEl.innerText.trim(),
                                date: dateEl.innerText.trim(),
                                amount: amountEl.innerText.trim(),
                                openPrice: openPriceEl.innerText.trim()
                            });
                        }
                    });
                    return results;
                }, asset.ticker); // Pass the ticker name to the evaluate function

                masterPayload.trades.push(...tickerTrades);
                console.log(`   ✔️ Extracted ${tickerTrades.length} trades.`);

            } catch (err) {
                console.log(`   ⚠️ Could not load trades for ${asset.ticker} (maybe no active trades or timeout). Skipping...`);
            }

            // Wait 2 seconds before the next request to avoid being blocked
            await delay(2000); 
        }

        // ==========================================
        // PHASE 3: SEND DATA TO GOOGLE SHEETS
        // ==========================================
        console.log(`\n📤 [PHASE 3] Sending data to Google Sheets (${masterPayload.trades.length} total trades)...`);
        
        const response = await fetch(process.env.WEBHOOK_URL, {
            method: 'POST',
            body: JSON.stringify(masterPayload),
            headers: { 'Content-Type': 'application/json' }
        });

        const result = await response.text();
        console.log("✅ Server response:", result);

    } catch (error) {
        console.error("❌ Fatal Error during execution:", error);
    } finally {
        await browser.close();
        console.log("🛑 Browser closed.");
    }
}

scrapeEtoro();