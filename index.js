require('dotenv').config();
const puppeteer = require('puppeteer');

// Disable TLS certificate validation (Fixes the Phase 3 fetch error behind certain firewalls/VPNs)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Helper function to pause execution (polite scraping)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function scrapeEtoro() {
    console.log("🚀 Launching Master Scraper...");
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    
    const trader = process.env.TRADER_USERNAME || "thomaspj";
    const targetHistoryTrades = parseInt(process.env.HISTORY_TRADES_TARGET, 10) || 500;
    
    const masterPayload = {
        type: "full_portfolio",
        overview: [],
        trades: [],
        history: []
    };

    try {
        // ==========================================
        // PHASE 1: SCRAPE PORTFOLIO OVERVIEW
        // ==========================================
        console.log(`\n🌐 [PHASE 1] Navigating to ${trader}'s main portfolio...`);
        await page.goto(`https://www.etoro.com/people/${trader}/portfolio`, { waitUntil: 'networkidle2' });

        console.log("⏳ Waiting for the main table...");
        try {
            // Reduce timeout to 10s. If it fails, the profile doesn't exist or is private.
            await page.waitForSelector('.et-table-body > div', { timeout: 10000 });
        } catch (e) {
            console.error(`\n❌ ERROR: Could not find portfolio data for user '${trader}'.`);
            console.error("   -> Please check if the TRADER_USERNAME in your .env is correct.");
            console.error("   -> Ensure the user's profile is public.\n");
            await browser.close();
            return; // Stop script execution gracefully
        }

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
        // PHASE 2: LOOP THROUGH TICKERS FOR OPEN TRADES
        // ==========================================
        console.log(`\n🔄 [PHASE 2] Starting deep extraction for active trades...`);
        
        for (const asset of masterPayload.overview) {
            const tickerUrl = `https://www.etoro.com/people/${trader}/portfolio/${asset.ticker.toLowerCase()}`;
            console.log(`👉 Extracting active trades for ${asset.ticker}...`);
            
            try {
                await page.goto(tickerUrl, { waitUntil: 'networkidle2' });
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
                            results.push({
                                ticker: currentTicker,
                                action: actionEl.innerText.trim(),
                                date: dateEl.innerText.trim(),
                                amount: amountEl.innerText.trim(),
                                openPrice: openPriceEl.innerText.trim()
                            });
                        }
                    });
                    return results;
                }, asset.ticker);

                masterPayload.trades.push(...tickerTrades);
                console.log(`   ✔️ Extracted ${tickerTrades.length} trades.`);

            } catch (err) {
                console.log(`   ⚠️ Could not load active trades for ${asset.ticker}. Skipping...`);
            }
            await delay(1500); 
        }

        // ==========================================
        // PHASE 3: SCRAPE CLOSED TRADES HISTORY
        // ==========================================
        // Calculate required clicks (approx 30 trades per click, minus the initial 30)
        const maxClicks = Math.ceil(Math.max(0, targetHistoryTrades - 30) / 30);
        
        console.log(`\n🕰️ [PHASE 3] Extracting closed history (Targeting ~${targetHistoryTrades} trades)...`);
        const historyUrl = `https://www.etoro.com/people/${trader}/portfolio/history`;
        await page.goto(historyUrl, { waitUntil: 'networkidle2' });
        
        await page.waitForSelector('#publicHistoryFlatView', { timeout: 15000 });

        let clickCount = 0;
        console.log(`🖱️ Clicking 'Show More' up to ${maxClicks} times...`);
        
        while (clickCount < maxClicks) {
            try {
                // 1. Force scroll to the bottom to ensure the area is loaded
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                await delay(1000); // Pause to allow scrolling

                // 2. Force click via DOM (bypasses overlays like cookie banners)
                const hasClicked = await page.evaluate(() => {
                    // Target the exact child to avoid clicking the wrong button
                    const btn = document.querySelector('et-people-portfolio-history-flat > button');
                    
                    // Check if button exists AND is visible
                    if (btn && btn.offsetParent !== null) { 
                        btn.click();
                        return true;
                    }
                    return false;
                });
                
                if (!hasClicked) {
                    // If false is returned, there's no button left (end of history reached)
                    break;
                }
                
                await delay(2500); // Allow eToro servers time to load new rows
                clickCount++;
                process.stdout.write(`.`); 
            } catch (e) {
                console.log("\n   Button click interrupted or ended.");
                break;
            }
        }
        console.log(`\n   Finished expanding list. Total clicks: ${clickCount}`);

        console.log("\n🔍 Extracting history table data...");
        masterPayload.history = await page.evaluate(() => {
            const slots = Array.from(document.querySelectorAll('#publicHistoryFlatView .et-table-body-slot'));
            const results = [];

            slots.forEach(slot => {
                // Navigate to the parent element to grab the Action (e.g., "BUY SLV")
                const row = slot.closest('.et-table-body > *, et-people-portfolio-history-item') || slot.parentElement;
                
                let action = row.querySelector('.et-table-first-cell')?.innerText.trim();
                if (!action) {
                    action = row.innerText.split('\n')[0].trim(); 
                }

                const open = slot.children[1]?.innerText.trim() || "";
                
                const openTimeContainer = slot.children[2];
                const openDate = openTimeContainer?.querySelector('p:nth-child(1)')?.innerText.trim() || openTimeContainer?.innerText.trim().split('\n')[0] || "";
                const openTime = openTimeContainer?.querySelector('p:nth-child(2)')?.innerText.trim() || openTimeContainer?.innerText.trim().split('\n')[1] || "";
                
                const close = slot.children[3]?.innerText.trim() || "";
                
                const closeTimeContainer = slot.children[4];
                const closeDate = closeTimeContainer?.querySelector('p:nth-child(1)')?.innerText.trim() || closeTimeContainer?.innerText.trim().split('\n')[0] || "";
                const closeTime = closeTimeContainer?.querySelector('p:nth-child(2)')?.innerText.trim() || closeTimeContainer?.innerText.trim().split('\n')[1] || "";
                
                const pl = slot.children[5]?.innerText.trim() || "";

                if (open || close || pl) {
                    results.push({
                        action: action,
                        open: open,
                        openDate: `${openDate} ${openTime}`.trim(),
                        close: close,
                        closeDate: `${closeDate} ${closeTime}`.trim(),
                        pl: pl
                    });
                }
            });
            return results;
        });
        
        console.log(`✅ Extracted ${masterPayload.history.length} historical trades.`);

        // ==========================================
        // PHASE 4: SEND DATA TO GOOGLE SHEETS
        // ==========================================
        console.log(`\n📤 [PHASE 4] Sending payload to Google Sheets...`);
        
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