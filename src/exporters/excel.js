const ExcelJS = require('exceljs');

async function generateExcel(allData, fileName) {
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
                        top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                        left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                        bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                        right: { style: 'thin', color: { argb: 'FFE0E0E0' } }
                    };
                    cell.alignment = { horizontal: 'center', vertical: 'middle' };
                });
            });
        };

        const formattedTrades = data.trades.map(t => ({ action: t.action, date: t.date, amount: t.amount, openPrice: t.openPrice }));

        addStyledTable(1, "OVERVIEW", ['Ticker', 'Invested (%)', 'P/L (%)'], data.overview);
        addStyledTable(5, "PAST PERFORMANCE", ['Year', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'YTD'], data.stats);
        addStyledTable(20, "ACTIVE TRADES", ['Action', 'Date', 'Amount', 'Open Price'], formattedTrades);
        addStyledTable(25, "CLOSED HISTORY", ['Action', 'Open Price', 'Open Date', 'Close Price', 'Close Date', 'P/L (%)'], data.history);

        ws.columns.forEach(col => col.width = 15);
    }

    await workbook.xlsx.writeFile(`${fileName}.xlsx`);
    console.log(`\n📊 Excel file successfully generated: ${fileName}.xlsx`);
}

module.exports = { generateExcel };
