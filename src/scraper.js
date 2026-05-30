/**
 * @file Per-trader scraper. Visits the trader's public eToro pages in five phases:
 *   1. Overview            (current portfolio positions)
 *   2. Past performance    (monthly/yearly stats)
 *   3. Active trades       (per-asset detail, paced adaptively)
 *   4. Closed history      (paginated "Load More" loop, polled on row growth)
 *   5. Latest posts        (3 most recent posts — runs last on purpose)
 * Returns a structured payload, or null if the trader is unreachable.
 */

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Phase 3 inter-asset pacing — REQUIRED in .env, validated at startup.
// Adaptive: the target gap is measured from cycle start, so a slow page load consumes
// the budget and we don't wait extra.
const ASSET_GAP_MIN_MS = parseInt(process.env.ASSET_GAP_MIN_MS, 10);
const ASSET_GAP_MAX_MS = parseInt(process.env.ASSET_GAP_MAX_MS, 10);

/**
 * Scrape a single trader's public profile into a structured payload.
 * Each phase is wrapped so a recoverable failure (no overview rows, slow history)
 * skips that trader cleanly without crashing the broader run.
 * @param {import('puppeteer').Browser} browser - shared Puppeteer browser instance
 * @param {string} trader - eToro username (without the leading @)
 * @param {number} targetHistoryTrades - upper bound on history rows to load in Phase 4
 * @param {boolean} isFirstBatch - true for the first trader of the session
 * @returns {Promise<object|null>} payload `{ type, traderUsername, isFirstBatch,
 *   posts, overview, stats, trades, history }`, or null if the trader was skipped
 */
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

    // Block heavy resources to speed up every page load (no functional impact on scraping):
    // - images/fonts/media: visual-only, save bandwidth and render time
    // - known 3rd-party analytics/trackers: slow + irrelevant to data extraction
    // We intentionally keep stylesheets (needed for offsetParent visibility checks),
    // scripts (Angular bundles), XHR/fetch (the actual data APIs), and the document itself.
    try {
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const type = req.resourceType();
            const url = req.url();
            if (type === 'image' || type === 'font' || type === 'media') {
                req.abort().catch(() => {});
            } else if (/google-analytics|googletagmanager|doubleclick|facebook\.net|hotjar|segment\.io|mixpanel|amplitude|sentry\.io|fullstory|optimizely/.test(url)) {
                req.abort().catch(() => {});
            } else {
                req.continue().catch(() => {});
            }
        });
    } catch (e) {
        // Interception unavailable — proceed without it (slower, but still functional).
    }

    const payload = { type: "full_portfolio", traderUsername: trader, isFirstBatch, posts: [], overview: [], stats: [], trades: [], history: [] };

    try {
        // --- PHASE 1: OVERVIEW ---
        console.log(`🌐 [PHASE 1] Navigating to ${trader}'s portfolio...`);
        await page.goto(`https://www.etoro.com/people/${trader}/portfolio`, { waitUntil: 'domcontentloaded' });

        try {
            await page.waitForSelector('.et-table-body > div', { timeout: 30000 });
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
        await page.goto(`https://www.etoro.com/people/${trader}/stats`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('et-user-performance-chart-new', { timeout: 30000 });

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
        const gapSpan = Math.max(1, ASSET_GAP_MAX_MS - ASSET_GAP_MIN_MS);
        for (const asset of payload.overview) {
            const cycleStart = Date.now();
            try {
                await page.goto(`https://www.etoro.com/people/${trader}/portfolio/${asset.ticker.toLowerCase()}`, { waitUntil: 'domcontentloaded' });
                await page.waitForSelector('.et-table-body > div', { timeout: 30000 });
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

            // Adaptive pacing: target a randomized inter-cycle gap of ASSET_GAP_MIN..MAX ms,
            // measured from the start of the cycle. If the scrape itself already consumed the
            // budget, only enforce a 500ms floor so very fast cycles still leave a beat.
            const targetGap = ASSET_GAP_MIN_MS + Math.floor(Math.random() * gapSpan);
            const elapsed = Date.now() - cycleStart;
            await delay(Math.max(500, targetGap - elapsed));
        }
        console.log(`✅ Extracted ${payload.trades.length} active trades.`);

        // --- PHASE 4: CLOSED HISTORY ---
        console.log(`🕰️  [PHASE 4] Extracting closed history (~${targetHistoryTrades} trades targeted)...`);
        await page.goto(`https://www.etoro.com/people/${trader}/portfolio/history`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#publicHistoryFlatView', { timeout: 30000 });

        // Wait for the initial batch to actually render — either the first rows appear
        // OR the Load More button becomes visible. Without this, the loop below would
        // run before Angular finishes rendering and exit immediately with zero rows.
        try {
            await page.waitForFunction(
                () => document.querySelectorAll('#publicHistoryFlatView .et-table-body-slot').length > 0 ||
                      !!document.querySelector('et-people-portfolio-history-flat > button')?.offsetParent,
                { timeout: 10000 }
            );
        } catch (e) {
            // Neither rows nor button appeared — trader genuinely has no closed history
        }

        // Dynamic batch loop: instead of fixed 2s+3s waits per batch, poll until the row
        // count actually grows after the click. Resolves the instant new rows render
        // (typically <500ms) and breaks immediately when no new rows arrive (end of history).
        let clickCount = 0;
        while (true) {
            try {
                const previousCount = await page.evaluate(() =>
                    document.querySelectorAll('#publicHistoryFlatView .et-table-body-slot').length
                );
                if (previousCount >= targetHistoryTrades) break;

                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                const hasClicked = await page.evaluate(() => {
                    const btn = document.querySelector('et-people-portfolio-history-flat > button');
                    if (btn && btn.offsetParent !== null) { btn.click(); return true; }
                    return false;
                });
                if (!hasClicked) break; // No button = end of history reached

                // Wait until the row count actually grows past previousCount (max 8s safety net).
                try {
                    await page.waitForFunction(
                        (prev) => document.querySelectorAll('#publicHistoryFlatView .et-table-body-slot').length > prev,
                        { timeout: 8000 },
                        previousCount
                    );
                } catch (e) {
                    break; // No new rows arrived — treat as end of history
                }

                clickCount++;
                const newCount = await page.evaluate(() =>
                    document.querySelectorAll('#publicHistoryFlatView .et-table-body-slot').length
                );
                process.stdout.write(`\r   Loading history: batch ${clickCount} done, ~${newCount} trades visible...`);
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

        // --- PHASE 5: LATEST POSTS (scraped last on purpose) ---
        // The feed is a live page that lazy-loads posts only on scroll, making it the slowest and
        // most fragile extraction. It runs last so a posts failure can never discard or delay the
        // core portfolio/stats/history data already gathered; the whole phase is non-fatal.
        // (Output order is set by the exporters, so posts still appear first in the files.)
        console.log(`📝 [PHASE 5] Extracting latest posts...`);
        try {
            await page.goto(`https://www.etoro.com/people/${trader}`, { waitUntil: 'domcontentloaded' });

            // The feed lazy-loads on scroll — nudge the page down until posts render.
            for (let i = 0; i < 5; i++) {
                if (await page.$('[automation-id="show-hide-post-main-body"]')) break;
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                await delay(2000);
            }
            await page.waitForSelector('[automation-id="show-hide-post-main-body"]', { timeout: 10000 });

            // Expand any truncated posts so we capture the full text
            await page.evaluate(() => {
                const bodies = Array.from(document.querySelectorAll('[automation-id="show-hide-post-main-body"]')).slice(0, 3);
                bodies.forEach(body => {
                    const container = body.closest('et-showhide') || body.parentElement;
                    const btn = container?.querySelector('[automation-id="bio-info-toggle-show-button"]');
                    if (btn) btn.click();
                });
            });
            await delay(1500);

            payload.posts = await page.evaluate(() => {
                const bodies = Array.from(document.querySelectorAll('[automation-id="show-hide-post-main-body"]')).slice(0, 3);
                return bodies.map(b => b.innerText.trim()).filter(t => t.length > 0);
            });
        } catch (e) {
            // Feed slow/absent or trader has no posts — non-fatal, keep the core data.
        }
        console.log(`✅ Extracted ${payload.posts.length} posts.`);

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
