/**
 * @file Local .xlsx exporter (ExcelJS). One workbook per session; one worksheet
 * per trader, tab name = `@<username>`. Layout per tab:
 *   - Rows 1-4: LATEST POSTS band (title row 1, posts #1/#2/#3 on rows 2-4)
 *   - Row 5:    gap
 *   - Row 6+:   OVERVIEW (cols A-C), PAST PERFORMANCE (E-R),
 *              ACTIVE TRADES (T-W), CLOSED HISTORY (Y-AD)
 */

const ExcelJS = require('exceljs');

/**
 * Write all collected traders into a single .xlsx workbook on disk.
 * @param {Array<object>} allData - array of scrapeTrader() payloads
 * @param {string} fileName - filename without extension; `.xlsx` is appended automatically
 * @returns {Promise<void>}
 */
async function generateExcel(allData, fileName) {
    const workbook = new ExcelJS.Workbook();

    // The posts band occupies rows 1 (title) + 2-4 (the 3 posts); the tables start below it.
    const TABLES_START_ROW = 6;

    for (const data of allData) {
        const ws = workbook.addWorksheet(`@${data.traderUsername}`);

        // Render a styled table at (startRow, startCol): merged title across the header
        // columns at startRow, column headers at startRow+1, data rows from startRow+2.
        const addStyledTable = (startCol, title, headers, rows, startRow) => {
            const titleCell = ws.getCell(startRow, startCol);
            titleCell.value = title;
            ws.mergeCells(startRow, startCol, startRow, startCol + headers.length - 1);
            titleCell.font = { bold: true, size: 11, color: { argb: 'FF2C3E50' } };
            titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECF0F1' } };
            titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

            const headerRow = ws.getRow(startRow + 1);
            headers.forEach((h, i) => {
                const cell = headerRow.getCell(startCol + i);
                cell.value = h;
                cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2C3E50' } };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
            });

            rows.forEach((r, rowIndex) => {
                const row = ws.getRow(startRow + 2 + rowIndex);
                headers.forEach((_, i) => {
                    const cell = row.getCell(startCol + i);
                    cell.value = Object.values(r)[i];
                    cell.border = {
                        top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                        left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                        bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                        right: { style: 'thin', color: { argb: 'FFE0E0E0' } }
                    };
                    cell.alignment = { horizontal: 'center', vertical: 'middle' };
                });
            });
        };

        // --- LATEST POSTS band (top, full width) ---
        const postsTitle = ws.getCell(1, 1);
        postsTitle.value = "LATEST POSTS";
        ws.mergeCells(1, 1, 1, 18);
        postsTitle.font = { bold: true, size: 11, color: { argb: 'FF2C3E50' } };
        postsTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECF0F1' } };
        postsTitle.alignment = { horizontal: 'center', vertical: 'middle' };

        const posts = data.posts || [];
        for (let i = 0; i < 3; i++) {
            const rowNum = 2 + i;
            const labelCell = ws.getCell(rowNum, 1);
            labelCell.value = `#${i + 1}`;
            labelCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2C3E50' } };
            labelCell.alignment = { horizontal: 'center', vertical: 'middle' };

            const textCell = ws.getCell(rowNum, 2);
            textCell.value = posts[i] || "";
            ws.mergeCells(rowNum, 2, rowNum, 18);
            textCell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
            ws.getRow(rowNum).height = 60;
        }

        const formattedTrades = data.trades.map(t => ({ action: t.action, date: t.date, amount: t.amount, openPrice: t.openPrice }));

        addStyledTable(1, "OVERVIEW", ['Ticker', 'Invested (%)', 'P/L (%)'], data.overview, TABLES_START_ROW);
        addStyledTable(5, "PAST PERFORMANCE", ['Year', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'YTD'], data.stats, TABLES_START_ROW);
        addStyledTable(20, "ACTIVE TRADES", ['Action', 'Date', 'Amount', 'Open Price'], formattedTrades, TABLES_START_ROW);
        addStyledTable(25, "CLOSED HISTORY", ['Action', 'Open Price', 'Open Date', 'Close Price', 'Close Date', 'P/L (%)'], data.history, TABLES_START_ROW);

        ws.columns.forEach(col => col.width = 15);
    }

    await workbook.xlsx.writeFile(`${fileName}.xlsx`);
    console.log(`\n📊 Excel file successfully generated: ${fileName}.xlsx`);
}

module.exports = { generateExcel };
