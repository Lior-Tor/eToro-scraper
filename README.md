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
    sheet = ss.insertSheet(traderName, 1);
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

Because this tool bypasses social noise and extracts pure data, you can choose how to analyze a trader. Create a `Summary & Analysis` tab in your spreadsheet to store these prompts, then paste them into your favorite AI (ChatGPT, Claude 3.5 Sonnet, or Gemini) along with your scraped files.

Choose the analytical lens that best fits your goals:

### 📊 Prompt 1: The Quantitative Analyst (Math, Stats & Risk Focus)
*Use this prompt to evaluate a trader purely on the numbers: risk/reward ratios, drawdowns, win rates, and mathematical concentration.*

> *"Act as a hedge fund-level quantitative financial analyst specializing in asset allocation, behavioral finance, and ETF portfolio construction. You are analyzing data from one or multiple eToro traders/investors. The data is provided in a document where each tab corresponds to a specific trader (named for example `@username`). **If there is only one tab in the document, you will only analyze that unique trader.** Within each tab, you will find four tables placed side-by-side in columns: a **Portfolio Overview** containing current positions with invested percentages and P/L, a **Past Performance** detailing historical monthly and yearly returns, an **Active Trades** containing open positions with their percentage size and entry price, and a **Closed History** containing the history of closed trades with prices, dates, and P/L (attention: this Closed History only goes back 1 year maximum). Your mission is to produce a reliable, data-driven, critical, and highly actionable quantitative analysis.*
> 
> *Before anything else, if certain data is missing or incomplete, you must explicitly point it out and adapt your analysis accordingly. Do not make unjustified speculative assumptions. Calculations can be approximate but must remain consistent. Absolute priority is reliability over exhaustiveness.*
> 
> *Begin by briefly evaluating the current macroeconomic context, identifying the direction of interest rates and their impact, the level and trend of inflation, geopolitical tensions, monetary policy stance, and the market regime (risk-on or risk-off). Conclude in a few lines with concrete implications for asset allocation, staying concise and avoiding generalities.*
> 
> *Next, analyze the portfolio quantitatively by detailing the breakdown by asset class, dominant sector exposure, and implicit geographic exposure. Evaluate the concentration level mathematically. Analyze true diversification by identifying implicit statistical correlations between positions, and detect cases of false diversification. Conclude with a clear diagnosis of the portfolio's coherence regarding the macro context.*
> 
> *Continue with a deep behavioral and performance analysis. The analysis of the **Past Performance** dataset is of absolute importance: you must imperatively dissect all the provided historical years and months to extract the trader's true underlying trend. Use these long-term returns to evaluate gain consistency, identify major drawdowns (how did the trader react during market shocks?), and judge overall resilience. Evaluate position sizing consistency. Roughly calculate the win rate, average win, and average loss via the closed history to deduce an implicit risk/reward ratio. Analyze risk management by identifying the tendency to cut or hold losses, potential bag holding, and signs of poor drawdown control. You must mandatorily identify behavioral patterns by naming each cognitive bias (loss aversion, disposition effect, FOMO, overtrading), providing concrete proof directly from the data, and explaining its impact on performance. Conclude with a clear and synthetic psychological profile.*
> 
> *Then, transform this portfolio into an ETF-based strategy with a primary goal of replicating the trader's exposures, not discretionary reallocation. You must reason by exposure clusters. **For each identified cluster, propose between 1 and 4 ETFs.** These ETFs must be surgically precise: if a cluster (like energy) contains both US and international stocks, you must propose multiple ETFs (e.g., a US ETF like XLE AND a Global ETF like IXC) to accurately reflect this geographic nuance within the same theme. For each proposed ETF, provide its exact ticker, explain exactly which exposure it replicates, any residual differences, and the improvements made. Provide a target percentage allocation for each ETF; explicitly preserve cash allocations if present.*
> 
> *Next, provide a highly critical final diagnosis by identifying the top three major structural errors of the trader based purely on the data, with direct and unfiltered explanations. Then concretely explain what a professional would do differently with precise, immediately applicable actions, without staying theoretical.*
> 
> *Directly leverage the **Past Performance** data to compare the trader's annual returns against a simple benchmark like the S&P 500 or MSCI World. Evaluate true alpha creation: does the outperformance justify the risk taken and time invested compared to passive holding?*
> 
> *Assign an overall score out of 100 based on risk management, coherence, discipline, and portfolio construction, briefly justifying this score.*
> 
> *The response must be structured, concise, analytical, free of fluff, and every conclusion must be directly linked to an observation from the data. **Finally, if (and only if) you analyzed multiple traders in the document, conclude your overall response with a simple summary table listing each trader and all the ETFs you selected to replicate their portfolio.***"

### 📖 Prompt 2: The Qualitative Analyst (Narrative, Moats & Conviction Focus)
*Use this prompt to decode the "story" behind the portfolio. It ignores the heavy math to focus on the trader's investment thesis, thematic choices, and company quality.*

> *"Act as a fundamental equity analyst and thematic portfolio manager. You are analyzing data from one or multiple eToro traders/investors. The data is provided in a document where each tab corresponds to a specific trader (named for example `@username`). **If there is only one tab in the document, you will only analyze that unique trader.** Within each tab, you will find four tables placed side-by-side in columns: a **Portfolio Overview**, **Past Performance**, **Active Trades**, and a **Closed History** (max 1 year history). Your mission is to decode the fundamental investment thesis, thematic convictions, and narrative behind the trader's choices to produce a critical and highly actionable qualitative analysis.*
> 
> *Before anything else, point out any missing data and adapt your analysis without making unjustified speculative assumptions. Absolute priority is reliability.*
> 
> *Begin by briefly evaluating the current macroeconomic themes driving the market (e.g., AI revolution, energy transition, supply chain shifts) and how they fit into current monetary policies and geopolitical tensions. Conclude with concrete implications for asset allocation.*
> 
> *Next, analyze the portfolio qualitatively. Decode the trader's fundamental "Investment Thesis". What is the narrative? Are they betting on technological disruption, classic dividend resilience, or commodity cycles? Evaluate the perceived fundamental quality of the held companies (economic moats, pricing power, competitive advantage) rather than just statistical weight. Detect cases of thematic false diversification. Conclude with a clear diagnosis of the portfolio's thematic coherence.*
> 
> *Continue with a deep behavioral and conviction analysis. The analysis of the **Past Performance** dataset is of absolute importance: you must imperatively dissect all historical years and months to extract the trader's true underlying trend. Use these long-term returns to evaluate conviction during major drawdowns (do they hold through volatility or panic sell?). Review the Active Trades and Closed History to assess if trades are driven by deep research or chasing recent market hype. You must mandatorily identify behavioral patterns (loss aversion, disposition effect, narrative fallacy, FOMO), providing concrete proof directly from the data. Conclude with a clear profile of their investment philosophy.*
> 
> *Transform this portfolio into a thematic ETF-based strategy prioritizing exposure replication. Reason by narrative clusters (e.g., if they hold PLTR and CRWD, form a "Cyber-Defense" cluster). **For each identified cluster, propose between 1 and 4 thematic or fundamental ETFs.** These ETFs must be surgically precise: if a thematic cluster contains both US and international moats, propose multiple ETFs (e.g., XLE AND IXC) to accurately reflect this geographic nuance within the same theme. For each ETF, provide its exact ticker, explain the thematic exposure it replicates, and propose a target percentage allocation. Preserve cash allocations if present.*
> 
> *Next, provide a highly critical final diagnosis identifying the top three fundamental errors of the trader (e.g., buying hype without moats, ignoring valuation), with direct and unfiltered explanations. Then concretely explain what a fundamental professional would do differently with precise, immediately applicable actions, without staying theoretical.*
> 
> *Directly leverage the **Past Performance** data to compare the trader's annual returns against a benchmark like the S&P 500 or MSCI World. Evaluate true alpha creation: does the thematic stock-picking outperformance justify the risk compared to passive holding?*
> 
> *Assign an overall score out of 100 based on conviction, thematic coherence, and fundamental asset quality.*
> 
> *The response must be structured, concise, and free of fluff. **Finally, if (and only if) you analyzed multiple traders in the document, conclude your overall response with a simple summary table listing each trader and all the ETFs you selected to replicate their fundamental themes.***"

### 🎯 Prompt 3: The "Quantamental" Analyst (The Hybrid Approach)
*The ultimate analysis. It blends rigorous statistical risk management with deep fundamental equity analysis to give you a 360-degree view.*

> *"Act as a 'Quantamental' Hedge Fund Portfolio Manager, combining rigorous statistical risk management (Quant) with deep fundamental equity analysis (Qual). You are analyzing the profile and data of one or multiple eToro traders/investors. The data is provided in a document where each tab corresponds to a specific trader (named for example `@username`). **If there is only one tab in the document, you will only analyze that unique trader.** Within each tab, you will find four tables placed side-by-side in columns: a **Portfolio Overview** containing current positions with invested percentages and P/L, a **Past Performance** detailing historical monthly and yearly returns, an **Active Trades** containing open positions with their percentage size and entry price, and a **Closed History** containing the history of closed trades with prices, dates, and P/L (attention: this Closed History only goes back 1 year maximum). Your mission is to produce a holistic, reliable, critical, and highly actionable 'quantamental' analysis that perfectly bridges the gap between numbers and narratives.*
> 
> *Before anything else, if certain data is missing or incomplete, you must explicitly point it out and adapt your analysis accordingly. Do not make unjustified speculative assumptions. Calculations can be approximate but must remain consistent. Absolute priority is reliability over exhaustiveness.*
> 
> *Begin by briefly evaluating the current macroeconomic context: combine the mathematical assessment of the interest rate and inflation environment (quantitative approach) with the analysis of dominant market narratives and geopolitical tensions (qualitative approach). Conclude in a few lines with concrete implications for asset allocation, particularly between equities, commodities, and others, staying concise and avoiding generalities.*
> 
> *Next, analyze the portfolio holistically. Quantitatively evaluate the breakdown by asset class, the mathematical concentration by identifying the weight of the main positions, and the implicit statistical correlations between them. Qualitatively evaluate the economic 'moats' (competitive advantages) and the fundamental relevance of the chosen thematic clusters. Explicitly answer this: does the statistical risk taken (concentration, volatility) align with a coherent fundamental thesis, or is it simply random stock-picking masking false diversification?*
> 
> *Continue with a deep behavioral and performance analysis. The analysis of the **Past Performance** dataset is of absolute importance: you must imperatively dissect all the provided historical years and months. Use this data to evaluate mathematical resilience during major drawdowns (Quant) and assess via the Active Trades and Closed History whether holding periods reflect true fundamental conviction or stubborn 'bag-holding' in the face of losses (Qual). Roughly calculate the win rate, average win, and average loss via the closed history to deduce an implicit risk/reward ratio. You must mandatorily identify behavioral patterns by naming each bias (loss aversion, disposition effect, FOMO, overtrading), providing concrete numerical proof directly from the data, and explaining its impact. Conclude with a clear and synthetic psychological profile of the trader.*
> 
> *Then, transform this portfolio into a Smart-Beta/Thematic ETF strategy with a primary goal of replicating the exposures, not discretionary reallocation. You must reason by exposure clusters, combining both approaches: blend factor/smart-beta ETFs (for quantitative risk control, e.g., Minimum Volatility, Quality) with purely thematic ETFs (to capture qualitative conviction). **For each identified cluster, propose between 1 and 4 ETFs.** These ETFs must be surgically precise: if a cluster (like energy) contains both US and international stocks, you must propose multiple ETFs (e.g., a US ETF like XLE AND a Global ETF like IXC) to accurately reflect this geographic nuance. For each proposed ETF, provide its exact ticker, explain precisely the exposure it replicates, and propose a target percentage allocation. Cash must be explicitly preserved in the final allocation if present.*
> 
> *Next, provide a highly critical final diagnosis by identifying the top three major structural errors of the trader with direct and unfiltered explanations. You must mix fundamental flaws (such as ignoring valuations or moats) with mathematical flaws (such as over-concentration or poor risk/reward). Then concretely explain what a professional would do differently with precise, immediately applicable actions, without staying theoretical.*
> 
> *Directly leverage the **Past Performance** data to compare the trader's annual returns against a simple benchmark like the S&P 500 or MSCI World. Evaluate the creation of true Alpha over the long term: does the outperformance justify the quantitative risk taken compared to passive holding?*
> 
> *Finally, assign an overall 'Quantamental' score out of 100, weighting mathematical/statistical discipline and fundamental thematic vision equally, briefly justifying this score.*
> 
> *The response must be highly structured, concise, analytical, free of fluff, and every conclusion must be directly linked to an observation from the data. **Finally, if (and only if) you analyzed multiple traders/investors in the document, conclude your overall response with a simple summary table listing each trader/investor and all the ETFs you selected to replicate their portfolio.***

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