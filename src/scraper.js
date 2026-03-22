const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
            return data.sort((a, b) => parseInt(b.year) - parseInt(a.year));
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
        console.log(`🕰️  [PHASE 4] Extracting closed history (~${targetHistoryTrades} trades targeted)...`);
        await page.goto(`https://www.etoro.com/people/${trader}/portfolio/history`, { waitUntil: 'networkidle2' });
        await page.waitForSelector('#publicHistoryFlatView', { timeout: 15000 });

        let clickCount = 0;
        while (true) {
            try {
                // Stop if we already have enough trades loaded
                const currentCount = await page.evaluate(() =>
                    document.querySelectorAll('#publicHistoryFlatView .et-table-body-slot').length
                );
                if (currentCount >= targetHistoryTrades) break;

                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                await delay(2000);
                const hasClicked = await page.evaluate(() => {
                    const btn = document.querySelector('et-people-portfolio-history-flat > button');
                    if (btn && btn.offsetParent !== null) { btn.click(); return true; }
                    return false;
                });
                if (!hasClicked) break; // No button = end of history reached
                await delay(3000);
                clickCount++;
                process.stdout.write(`\r   Loading history: batch ${clickCount} done, ~${currentCount} trades visible...`);
            } catch (e) { break; }
        }
        console.log(`\n   Finished expanding list. Extracting table data...`);

        payload.history = await page.evaluate(() => {
            const slots = Array.from(document.querySelectorAll('#publicHistoryFlatView .et-table-body-slot'));
            const results = [];
            slots.forEach(slot => {
                // 1. ACTION — inside the slot under automation-id
                const actionEl = slot.querySelector('[automation-id="cd-public-history-flat-table-item-first-name"]');
                const action = actionEl?.innerText.trim() || "";

                // 2. OPEN (Price & Date)
                const open = slot.querySelector('[automation-id="cd-public-history-flat-table-item-open-rate"]')?.innerText.trim() || "";
                const openDateEl = slot.querySelector('[automation-id="cd-public-history-flat-table-item-open-date"]');
                const openDate = openDateEl?.querySelector('p:nth-child(1)')?.innerText.trim() || "";
                const openTime = openDateEl?.querySelector('p:nth-child(2)')?.innerText.trim() || "";

                // 3. CLOSE (Price & Date)
                const close = slot.querySelector('[automation-id="cd-public-history-flat-table-item-close-rate"]')?.innerText.trim() || "";
                const closeDateEl = slot.querySelector('[automation-id="cd-public-history-flat-table-item-close-date"]');
                const closeDate = closeDateEl?.querySelector('p:nth-child(1)')?.innerText.trim() || "";
                const closeTime = closeDateEl?.querySelector('p:nth-child(2)')?.innerText.trim() || "";

                // 4. P/L
                const plNode = slot.querySelector('[automation-id="cd-public-history-flat-table-item-gain"]');
                const pl = plNode ? plNode.textContent.replace(/\s+/g, '') : "";

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

module.exports = { scrapeTrader };
