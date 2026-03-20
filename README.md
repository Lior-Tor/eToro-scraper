# eToro Portfolio & Trades Scraper 📈🤖

This automated Node.js pipeline acts as a professional multi-trader screener. It extracts public portfolios, long-term past performance stats, active trades, and closed histories, routing the data into highly structured Google Sheets or local Excel/CSV files for **Advanced AI Analysis**.

## 🚀 Overview

Tracking copy-traders efficiently requires looking beyond just their current holdings. This tool extracts the hard data needed to bypass the "social noise" on eToro and perform real financial analysis:
1. **Multi-Trader Extraction:** A Node.js script uses Puppeteer to sequentially scrape the global portfolio, historical performance (monthly/yearly), active trades, and closed trades history for one or multiple target users.
2. **7-Option Interactive CLI:** Choose your destination before scraping. Export directly to Google Sheets (via Webhook), local `.xlsx` files, `.csv` files, or any combination of the three.
3. **Storage & UI:** - **Google Sheets:** Receives the data via a secure POST request, auto-formats it with professional styling (Midnight Blue themes), and creates a dedicated tab for each trader (e.g., `@username`) with the four datasets placed side-by-side.
   - **Local Files:** Generates beautiful consolidated Excel files or AI-friendly CSV files directly on your machine.
4. **Three-Dimensional AI Insights:** Because the scraper extracts pure, unbiased data, you can feed it to Large Language Models (LLMs) to perform **Quantitative** (stats & risk), **Qualitative** (themes & moats), or **Hybrid** analysis.

## 📂 Project Structure

```text
.
├── node_modules/       # Installed dependencies
├── .env                # Private credentials (Webhook URL, Trader Usernames)
├── .env.example        # Template for environment variables
├── .gitignore          # Tells Git to ignore .env, node_modules, and local data files
├── index.js            # Main Puppeteer scraping and export logic
├── package-lock.json   # Exact versions of dependencies
├── package.json        # Project metadata and dependencies
└── README.md           # Documentation
```
*(Note: The Google Apps Script code is hosted on Google Servers and is provided in the setup instructions below, not in the local file tree.)*

## 🛠️ Setup Instructions

### 1. Google Sheets Configuration (The Backend)
If you want to use the automated Google Sheets dashboard:
1. Create a new Google Sheet.
2. Go to **Extensions > Apps Script**.
3. Paste the following code into the editor:

```javascript
/**
 * Main Webhook to receive data from the Node.js scraper.
 * Handles single/multiple traders and manages tab routing dynamically.
 */
function doPost(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const payload = JSON.parse(e.postData.contents);

  // Ping test handler
  if (payload.type !== "full_portfolio") {
    return ContentService.createTextOutput("Ping OK").setMimeType(ContentService.MimeType.TEXT);
  }

  // --- 1. Enforce "Summary & Analysis" exists and is Tab 1 ---
  let summarySheet = ss.getSheetByName("Summary & Analysis");
  if (!summarySheet) {
    summarySheet = ss.insertSheet("Summary & Analysis", 0);
  } else {
    ss.setActiveSheet(summarySheet);
    ss.moveActiveSheet(1); 
  }

  // --- 2. Clean up old trader tabs IF this is the first batch ---
  if (payload.isFirstBatch === true) {
    const allSheets = ss.getSheets();
    allSheets.forEach(sheet => {
      // Delete any sheet that starts with "@" (Trader tabs)
      if (sheet.getName().startsWith('@')) {
        ss.deleteSheet(sheet);
      }
    });
  }

  // --- 3. Create or get the specific sheet for this trader ---
  const traderName = payload.traderUsername ? `@${payload.traderUsername}` : "@unknown_trader";
  let sheet = ss.getSheetByName(traderName);
  if (!sheet) {
    // Insert new trader sheet AFTER "Summary & Analysis"
    sheet = ss.insertSheet(traderName, ss.getSheets().length);
  } else {
    sheet.clear(); 
  }

  // Helper to safely parse eToro dates
  const parseDate = (dStr) => {
     if(!dStr) return "";
     try {
         const p = dStr.split(/[\s/:]/);
         if(p.length >= 5) return new Date(p[2], p[1]-1, p[0], p[3], p[4]);
     } catch(err) {}
     return dStr;
  };

  // Helper to cleanly merge cells and apply Midnight Blue styling
  const createSectionTitle = (colStart, colCount, title) => {
      let titleRange = sheet.getRange(1, colStart, 1, colCount);
      titleRange.clearContent();
      sheet.getRange(1, colStart).setValue(title); 
      titleRange.mergeAcross()
                .setFontWeight('bold').setFontSize(11)
                .setBackground('#ecf0f1').setFontColor('#2c3e50')
                .setHorizontalAlignment('center').setVerticalAlignment('middle');
  };

  // ==========================================
  // SECTION: OVERVIEW (Columns A, B, C)
  // ==========================================
  createSectionTitle(1, 3, "OVERVIEW");
  const overviewRows = [['Ticker', 'Invested (%)', 'P/L (%)']];
  if (payload.overview) payload.overview.forEach(item => overviewRows.push([item.ticker, item.invested, item.pl]));
  
  let overRange = sheet.getRange(2, 1, overviewRows.length, 3);
  overRange.setValues(overviewRows);
  sheet.getRange(2, 1, 1, 3).setFontWeight('bold').setBackground('#2c3e50').setFontColor('white');
  if (overviewRows.length > 1) sheet.getRange(3, 2, overviewRows.length - 1, 2).setHorizontalAlignment('center').setVerticalAlignment('middle');
  overRange.setBorder(true, true, true, true, true, true, '#e0e0e0', SpreadsheetApp.BorderStyle.SOLID);

  // ==========================================
  // SECTION: PAST PERFORMANCE (Columns E to R)
  // ==========================================
  createSectionTitle(5, 14, "PAST PERFORMANCE");
  const statsRows = [['Year', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'YTD']];
  if (payload.stats) {
    payload.stats.forEach(s => statsRows.push([s.year, s.jan, s.feb, s.mar, s.apr, s.may, s.jun, s.jul, s.aug, s.sep, s.oct, s.nov, s.dec, s.ytd]));
  }
  
  let statsRange = sheet.getRange(2, 5, statsRows.length, 14);
  statsRange.setValues(statsRows);
  sheet.getRange(2, 5, 1, 14).setFontWeight('bold').setBackground('#2c3e50').setFontColor('white');
  if (statsRows.length > 1) sheet.getRange(3, 5, statsRows.length - 1, 14).setHorizontalAlignment('center').setVerticalAlignment('middle');
  statsRange.setBorder(true, true, true, true, true, true, '#e0e0e0', SpreadsheetApp.BorderStyle.SOLID);

  // ==========================================
  // SECTION: ACTIVE TRADES (Columns T to W)
  // ==========================================
  createSectionTitle(20, 4, "ACTIVE TRADES");
  const tradesRows = [['Action', 'Date', 'Amount', 'Open Price']];
  if (payload.trades) {
    payload.trades.sort((a, b) => {
       if (a.ticker !== b.ticker) return a.ticker.localeCompare(b.ticker);
       const tA = new Date(parseDate(a.date)).getTime() || 0;
       const tB = new Date(parseDate(b.date)).getTime() || 0;
       return tB - tA;
    });
    payload.trades.forEach(trade => tradesRows.push([trade.action, parseDate(trade.date), trade.amount, trade.openPrice]));
  }
  
  let tradesRange = sheet.getRange(2, 20, tradesRows.length, 4);
  tradesRange.setValues(tradesRows);
  sheet.getRange(2, 20, 1, 4).setFontWeight('bold').setBackground('#2c3e50').setFontColor('white');
  if (tradesRows.length > 1) {
    sheet.getRange(3, 21, tradesRows.length - 1, 1).setNumberFormat('dd/MM/yyyy HH:mm').setHorizontalAlignment('center');
    sheet.getRange(3, 22, tradesRows.length - 1, 2).setHorizontalAlignment('center').setVerticalAlignment('middle');
  }
  tradesRange.setBorder(true, true, true, true, true, true, '#e0e0e0', SpreadsheetApp.BorderStyle.SOLID);

  // ==========================================
  // SECTION: CLOSED HISTORY (Columns Y to AD)
  // ==========================================
  createSectionTitle(25, 6, "CLOSED HISTORY");
  const historyRows = [['Action', 'Open Price', 'Open Date', 'Close Price', 'Close Date', 'P/L (%)']];
  if (payload.history) {
    payload.history.forEach(trade => historyRows.push([trade.action, trade.open, parseDate(trade.openDate), trade.close, parseDate(trade.closeDate), trade.pl]));
  }

  let historyRange = sheet.getRange(2, 25, historyRows.length, 6);
  historyRange.setValues(historyRows);
  sheet.getRange(2, 25, 1, 6).setFontWeight('bold').setBackground('#2c3e50').setFontColor('white');
  if (historyRows.length > 1) {
    sheet.getRange(3, 27, historyRows.length - 1, 1).setNumberFormat('dd/MM/yyyy HH:mm').setHorizontalAlignment('center');
    sheet.getRange(3, 29, historyRows.length - 1, 1).setNumberFormat('dd/MM/yyyy HH:mm').setHorizontalAlignment('center');
    sheet.getRange(3, 26, historyRows.length - 1, 5).setHorizontalAlignment('center').setVerticalAlignment('middle');
  }
  historyRange.setBorder(true, true, true, true, true, true, '#e0e0e0', SpreadsheetApp.BorderStyle.SOLID);

  // ==========================================
  // GLOBAL FORMATTING ADJUSTMENTS
  // ==========================================
  sheet.setFrozenRows(2);
  sheet.setRowHeight(1, 35);
  
  // Auto-fit specific columns
  sheet.autoResizeColumn(1); 
  sheet.autoResizeColumn(20); 
  sheet.autoResizeColumn(25); 
  
  // Create separator columns
  sheet.setColumnWidth(4, 30);
  sheet.setColumnWidth(19, 30);
  sheet.setColumnWidth(24, 30);

  // Focus back to Summary tab
  ss.setActiveSheet(summarySheet);

  return ContentService.createTextOutput(`Success: Sheet ${traderName} updated.`).setMimeType(ContentService.MimeType.TEXT);
}
```

4. **Deploy the Script:**
   - Click **Deploy > New Deployment** (Make sure to deploy as a *New version*, not just save).
   - Select type: **Web App**.
   - Who has access: **Anyone**.
5. Copy the **Web App URL**.

### 2. Local Environment Setup
1. Clone the repository:
   ```bash
   git clone https://github.com/Lior-Tor/eToro-scraper.git
   cd eToro-scraper
   ```
2. Install dependencies (including `exceljs` for local Excel exports and `puppeteer-extra` for anti-bot bypassing):
   ```bash
   npm install puppeteer puppeteer-extra puppeteer-extra-plugin-stealth dotenv exceljs
   ```
3. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
4. Configure your `.env` file with your targets:
   ```env
   # Leave WEBHOOK_URL empty if you only plan to export to local Excel/CSV
   WEBHOOK_URL=https://script.google.com/macros/s/your-webhook-url/exec
   
   TRADER_USERNAME=example_username
   MULTIPLE_TRADER_USERNAMES=trader1,trader2,trader3
   HISTORY_TRADES_TARGET=500
   ```

### 3. Usage
Run the interactive CLI scraper:
```bash
node index.js
```
You will be prompted to select **Single** or **Multiple** trader mode, followed by your preferred export destination (Sheets, Excel, CSV).

---

## 🧠 AI Financial Analysis & Insights

You can analyze the gathered data using modern AI tools. I recommend creating a tab named `Summary & Analysis` in your spreadsheet to store a "Prompt Library" for quick copy-pasting.

### Option A: External AI Connectors (Recommended)
With the latest updates to AI platforms, analyzing large datasets is easier than ever:
* **Upload Local Files:** Use the scraper's CLI option `[2]` or `[3]` to generate a local `.xlsx` or `.csv` file. Drag and drop this file directly into Claude, ChatGPT, or Gemini along with your prompt library.
* **Native Drive Connectors:** Connect your Google Drive directly to your LLM. Ask the AI to read your specific Google Sheet.

### Option B: Native "Ask Gemini" (Google Workspace)
If you have a paid Google Gemini subscription, open the Gemini side panel (top right ✨ icon) directly inside Google Sheets. Paste your prompt, and Gemini will automatically read the context of your active sheet.

### Option C: API Automation (For Developers)
If you wish to fully automate the analysis within Google Sheets without manual drag-and-drop:
1. Generate an API Key from Google AI Studio, OpenAI, or Claude.
2. Write a custom Google Apps Script function using `UrlFetchApp` to send the `JSON.stringify(sheetData)` directly to the API endpoint.
3. Parse the response and write it back into your `Summary & Analysis` tab. 

---

## 🧠 Master Prompt Library (AI Financial Analysis)

Because this tool bypasses social noise and extracts pure data, you can choose how to analyze a trader. Create a `Summary & Analysis` tab in your spreadsheet to store these prompts, then paste them into your favorite AI (ChatGPT, Claude, or Gemini) along with your scraped files.

Choose the analytical lens that best fits your goals:

### 📊 Prompt 1: The Quantitative Analyst (Math, Stats & Risk Focus)
*Use this prompt to evaluate a trader purely on the numbers: risk/reward ratios, drawdowns, win rates, and mathematical concentration.*

> *"Act as a quantitative hedge fund analyst specializing in asset allocation, behavioral analysis, and ETF portfolio construction. You are analyzing data from one or multiple traders or investors originating from a structured document. Each tab corresponds to a specific trader, identified by a name like `@username`. If there is only one tab, focus your analysis solely on this trader. Within each tab, the data is organized into four distinct tables arranged in columns: a **Portfolio Overview** containing current positions with invested percentages and P/L, a **Past Performance** detailing historical monthly and yearly returns, an **Active Trades** containing open positions with their percentage size and entry price, and a **Closed History** containing the history of closed trades with prices, dates, and P/L, keeping in mind that this history is limited to a maximum period of one year.
>
> Your mission is to produce a rigorous, data-driven, critical, and directly actionable quantitative analysis. Before any analysis, you must verify data integrity. If certain information is missing, incomplete, or inconsistent, you must explicitly point it out and adapt your analysis accordingly. You must not formulate any unjustified speculative assumptions. Calculations can be approximate but must remain consistent and logically defensible. The absolute priority is mathematical reliability and analytical consistency.
>
> You must also take into account any potential formulas present in the document if they exist, as they may reflect the calculation logic used for certain metrics. If these formulas influence the displayed results, you must analyze them, verify their consistency, and point out any error or bias they might introduce into the data interpretation.
>
> Begin with a concise evaluation of the current macroeconomic context by identifying the direction of interest rates and their implications, inflation dynamics, major geopolitical tensions, central bank posture, and the dominant market regime (risk-on or risk-off). Briefly conclude on the direct implications for asset allocation.
>
> Next, analyze the portfolio quantitatively by detailing the breakdown by asset class, dominant sector exposures, and implicit geographic exposures. Evaluate the concentration level using simple but consistent metrics. Analyze true diversification by identifying implicit correlations between positions and detecting any false diversification. End this section with a clear diagnosis of the portfolio's coherence regarding the macroeconomic context.
>
> Continue with a deep behavioral and performance analysis. The analysis of the **Past Performance** table is central and must be exhaustive. You must analyze all available monthly and yearly returns to identify the underlying trend, performance consistency, significant drawdowns, and how the trader reacts to market stress phases. You must estimate the win rate, average win, and average loss from the Closed History to deduce an implicit risk/reward ratio. Analyze risk management by identifying behaviors of cutting losses or conversely, excessive holding, as well as any signs of bag holding. You must imperatively identify behavioral biases by naming them explicitly, providing concrete numerical proof from the data, and explaining their impact on performance. Conclude this section with a synthetic psychological profile of the trader.
>
> Then, transform this portfolio into an ETF strategy with a primary goal of faithfully replicating existing exposures. You must group positions into exposure clusters and propose between one and four relevant ETFs for each cluster. ETFs must be chosen precisely to faithfully reflect sector and geographic exposures. For each ETF, you must provide the exact ticker, explain the covered exposure, any residual differences, and the improvements made. You must propose a target percentage allocation consistent with the initial exposures, explicitly preserving any cash portion if it exists.
>
> Next, provide a critical final diagnosis identifying the trader's top three major structural or quantitative errors, based solely on the analyzed data. You must concretely explain what a professional would do differently with precise, immediately applicable actions, without staying theoretical.
>
> Based on the **Past Performance** data, compare the trader's annual returns to a simple benchmark like the S&P 500 or MSCI World to evaluate true alpha creation. Analyze whether any potential outperformance justifies the level of risk taken and the efforts deployed compared to a passive strategy.
>
> Finally, assign an overall score out of 100 based on risk management, discipline, coherence, and portfolio construction, briefly justifying this score.
>
> The response must be structured, concise, analytical, and free of fluff. Each conclusion must be directly linked to an observation from the data. If and only if multiple traders are analyzed, end with a summary table listing each trader and the ETFs selected to replicate their portfolio."*

### 📖 Prompt 2: The Qualitative Analyst (Narrative, Moats & Conviction Focus)
*Use this prompt to decode the "story" behind the portfolio. It ignores the heavy math to focus on the trader's investment thesis, thematic choices, and company quality.*

> *"Act as a fundamental equity analyst and thematic portfolio manager, specializing in the qualitative analysis of companies, market narratives, and investment convictions. You are analyzing data from one or multiple traders or investors originating from a structured document. Each tab corresponds to a specific trader, identified by a name like `@username`. If there is only one tab, focus your analysis solely on this trader. Within each tab, the data is organized into four distinct tables arranged in columns: a **Portfolio Overview** containing current positions, a **Past Performance** detailing monthly and yearly returns, an **Active Trades** containing open positions with their characteristics, and a **Closed History** containing the history of closed trades with their results, keeping in mind that this history is limited to a maximum period of one year.
>
> Your mission is to decode the fundamental investment thesis, thematic convictions, and implicit narrative behind the trader's choices to produce a critical, coherent, and directly actionable qualitative analysis. Before any analysis, you must verify data integrity. If certain information is missing, incomplete, or inconsistent, you must explicitly point it out and adapt your analysis accordingly. You must not formulate any unjustified speculative assumptions. If formulas are present in the document, you must also analyze them as they may reflect the trader's calculation or tracking logic; you must verify their consistency and point out any anomaly or bias they might introduce.
>
> Begin by briefly evaluating the current major macroeconomic themes structuring the markets, integrating dynamics related to innovation, monetary policies, inflation, interest rates, and geopolitical tensions. Conclude with the concrete implications of these dynamics on asset allocation and investment styles.
>
> Next, analyze the portfolio qualitatively, seeking to reconstruct the trader's investment thesis. You must identify the dominant narrative, determine whether it relies on a logic of technological disruption, economic cycles, yield, or specific opportunities. Evaluate the perceived fundamental quality of the held companies by analyzing elements like competitive advantages, economic moats, pricing power, and overall strategic coherence. Identify cases of thematic false diversification, where multiple positions give an illusion of diversification while relying on the same narrative engine. Conclude this section with a clear diagnosis of the portfolio's coherence and solidity from a fundamental and thematic standpoint.
>
> Continue with a deep behavioral and conviction analysis. The analysis of the **Past Performance** table is central and must be exhaustive. You must analyze all monthly and yearly returns to extract the trader's underlying trend, evaluate their consistency, and understand their behavior during drawdown phases. You must determine if they maintain their convictions through volatility or if they react emotionally. Also using data from the Active Trades and Closed History, you must evaluate whether decisions stem from fundamental reflection or opportunistic trend-chasing. You must imperatively identify behavioral biases by naming them explicitly, providing concrete proof from the data, and explaining their impact on performance. Conclude this section with a clear profile of the trader's investment philosophy.
>
> Then, transform this portfolio into a strategy based on thematic ETFs, prioritizing the faithful replication of existing exposures. You must reason by narrative clusters, grouping positions according to their fundamental themes. For each identified cluster, propose between one and four relevant ETFs. The ETFs must be precisely selected to faithfully reflect the sector and geographic dimensions of the identified themes. For each ETF, you must provide the exact ticker, explain the covered thematic exposure, and propose a target percentage allocation consistent with the initial portfolio. Any cash portion must be explicitly preserved if it exists.
>
> Next, provide a critical final diagnosis identifying the trader's top three major fundamental errors, based solely on the data and qualitative analysis. You must concretely explain what a professional fundamental investor would do differently with precise and immediately applicable actions.
>
> Based on the **Past Performance** data, compare the trader's annual returns to a benchmark like the S&P 500 or MSCI World to evaluate true alpha creation. Analyze whether any potential outperformance justifies the stock-picking choices and the level of risk taken compared to a passive strategy.
>
> Finally, assign an overall score out of 100 based on conviction, thematic coherence, and the fundamental quality of the chosen assets, briefly justifying this score.
>
> The response must be structured, concise, analytical, and free of fluff. Each conclusion must be directly linked to an observation from the data. If and only if multiple traders are analyzed, end with a summary table listing each trader and the ETFs selected to replicate their fundamental themes."*

### 🎯 Prompt 3: The "Quantamental" Analyst (The Hybrid Approach)
*The ultimate analysis. It blends rigorous statistical risk management with deep fundamental equity analysis to give you a 360-degree view.*

> *"Act as a quantamental hedge fund portfolio manager, combining rigorous risk management based on statistical principles with deep fundamental analysis of companies and investment theses. You are analyzing data from one or multiple traders or investors originating from a structured document. Each tab corresponds to a specific trader, identified by a name like `@username`. If there is only one tab, focus your analysis solely on this trader. Within each tab, the data is organized into four distinct tables arranged in columns: a **Portfolio Overview** containing current positions with invested percentages and P/L, a **Past Performance** detailing historical monthly and yearly returns, an **Active Trades** containing open positions with their percentage size and entry price, and a **Closed History** containing the history of closed trades with prices, dates, and P/L, keeping in mind that this history is limited to a maximum period of one year.
>
> Your mission is to produce a holistic, reliable, critical, and directly actionable quantamental analysis bridging quantitative data and fundamental narratives. Before any analysis, you must verify data integrity. If certain information is missing, incomplete, or inconsistent, you must explicitly point it out and adapt your analysis accordingly. You must not formulate any unjustified speculative assumptions. Calculations can be approximate but must remain consistent and rigorous. The absolute priority is analytical reliability. If formulas are present in the document, you must also analyze them as they may reflect the calculation logic used by the trader; you must verify their consistency and point out any error or bias they might introduce.
>
> Begin with a concise evaluation of the current macroeconomic context by combining a quantitative reading of the interest rate and inflation environment with a qualitative analysis of dominant market narratives and geopolitical tensions. Conclude with concrete implications for asset allocation, particularly between equities, commodities, and other asset classes, without generalities.
>
> Next, analyze the portfolio holistically. Quantitatively evaluate the breakdown by asset class, the concentration level by identifying the weight of the main positions, and the implicit correlations between assets. In parallel, evaluate the fundamental quality of the positions by analyzing competitive advantages, the relevance of investment theses, and the coherence of thematic clusters. You must explicitly answer the following question: does the statistical risk taken, particularly in terms of concentration and volatility, align with a coherent fundamental thesis, or is it disorganized stock-picking masking false diversification?
>
> Continue with a deep behavioral and performance analysis. The analysis of the **Past Performance** table is central and must be exhaustive. You must analyze all monthly and yearly returns to evaluate performance consistency, resilience to drawdowns, and the overall robustness of the trader. Also using data from the Active Trades and Closed History, you must evaluate whether holding periods reflect a fundamental conviction or an excessive loss-holding behavior. You must estimate the win rate, average win, and average loss to deduce an implicit risk/reward ratio. You must imperatively identify behavioral biases by naming them explicitly, providing numerical proof from the data, and explaining their impact. Conclude this section with a clear and synthetic psychological profile of the trader.
>
> Then, transform this portfolio into an ETF-based strategy, prioritizing the faithful replication of existing exposures. You must reason by exposure clusters combining a quantitative and qualitative approach, integrating both factor or smart beta ETFs for risk control and thematic ETFs to reflect fundamental convictions. For each identified cluster, propose between one and four relevant ETFs. The ETFs must be selected precisely to faithfully reflect sector and geographic dimensions. For each ETF, you must provide the exact ticker, precisely explain the covered exposure, and propose a target percentage allocation consistent with the initial portfolio. Any cash portion must be explicitly preserved if it exists.
>
> Next, provide a critical final diagnosis identifying the trader's top three major structural errors by combining fundamental flaws and quantitative flaws. You must concretely explain what a professional would do differently with precise and immediately applicable actions.
>
> Based on the **Past Performance** data, compare the trader's annual returns to a benchmark like the S&P 500 or MSCI World to evaluate the creation of true alpha. Analyze whether any potential outperformance justifies the level of risk taken compared to a passive strategy.
>
> Finally, assign an overall quantamental score out of 100, weighting quantitative discipline and fundamental coherence equally, briefly justifying this score.
>
> The response must be structured, concise, analytical, and free of fluff. Each conclusion must be directly linked to an observation from the data. If and only if multiple traders are analyzed, end with a summary table listing each trader and the ETFs selected to replicate their portfolio."*

---

## ⚠️ Important Disclaimer on Selectors

This project relies on specific **CSS Selectors** and **DOM structures** provided by eToro. 
- **Dynamic Site:** Web platforms like eToro update their UI frequently.
- **Breaking Changes:** If eToro modifies their HTML tags or class names, the scraper **will stop working**.
- **Maintenance:** You may need to inspect the eToro portfolio page (F12) and update the selectors in `index.js` manually.

## ⚖️ Legal Disclaimer

This tool is for **educational and personal use only**. 
- **Terms of Service:** Scraping may violate eToro's Terms of Service. Use it responsibly and at your own risk.
- **Privacy:** Only public profiles should be targeted. This tool does not bypass any security measures or access private data.

## 🛡️ License
This project is licensed under the **ISC License**, a permissive free software license. You may freely use, modify, and distribute this code, provided the original copyright notice is included.