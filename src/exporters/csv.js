/**
 * @file Local .csv exporter. One file per session containing all traders, separated by
 * `=== START/END OF TRADER ===` markers. Each trader block holds LATEST POSTS, OVERVIEW,
 * PAST PERFORMANCE, ACTIVE TRADES, and CLOSED HISTORY sections in that order. Post
 * bodies can contain newlines; those stay inside RFC 4180 quoted fields, which Excel
 * and Sheets handle natively on import.
 */

const fs = require('fs');

/**
 * Write all collected traders into a single .csv file on disk.
 * @param {Array<object>} allData - array of scrapeTrader() payloads
 * @param {string} fileName - filename without extension; `.csv` is appended automatically
 */
function generateCsv(allData, fileName) {
    let csvContent = "";
    // Quote + escape a CSV field per RFC 4180 (wrap in ", double any internal ").
    const s = (val) => `"${String(val).replace(/"/g, '""')}"`;

    allData.forEach(data => {
        csvContent += `=== START OF TRADER: @${data.traderUsername} ===\n\n`;

        csvContent += "--- LATEST POSTS ---\nPost #,Content\n";
        (data.posts || []).forEach((p, i) => csvContent += `${s('#' + (i + 1))},${s(p)}\n`);

        csvContent += "\n--- OVERVIEW ---\nTicker,Invested (%),P/L (%)\n";
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
    console.log(`💾 CSV updated: ${fileName}.csv`);
}

module.exports = { generateCsv };
