# eToro Portfolio & Trades Scraper 📈🤖

Stop tracking eToro traders manually. This automated pipeline extracts public portfolios, active trades, and closed histories into a professional Google Sheets dashboard, complete with built-in **Gemini AI** behavioral and financial analysis.

## 🚀 Overview

Tracking copy-traders efficiently requires looking beyond just their current holdings. This tool automates the entire process:
1. **Extraction:** A Node.js script uses Puppeteer to scrape the global portfolio, active trades, and dynamically loads the closed trades history for a specific user.
2. **Transmission:** Data is sent via a secure POST request to a Google Apps Script Webhook.
3. **Storage & UI:** Google Sheets receives the data, auto-formats it with professional styling (Midnight Blue themes, filters, correct date parsing), and splits it into three clear tabs (`Overview`, `Trades History`, `Closed History`).
4. **AI Insights:** A custom Sheets function (`AI_PORTFOLIO_ANALYSIS`) uses Gemini AI to analyze the trader's behavior, win rate, and risk management to suggest ETF transition strategies.

## 📂 Project Structure

```text
.
├── node_modules/       # Installed dependencies
├── .env                # Private credentials (Webhook URL, Target Trader)
├── .env.example        # Template for environment variables
├── .gitignore          # Tells Git to ignore .env and node_modules
├── index.js            # Main Puppeteer scraping logic
├── package-lock.json   # Exact versions of dependencies
├── package.json        # Project metadata and dependencies
└── README.md           # Documentation
```
*(Note: The Google Apps Script code is hosted on Google Servers and is provided in the setup instructions below, not in the local file tree.)*

## 🛠️ Setup Instructions

### 1. Google Sheets Configuration (The Backend)
1. Create a new Google Sheet.
2. Go to **Extensions > Apps Script**.
3. Paste the following code into the editor:

```javascript
/**
 * Main Webhook to receive data from the Node.js scraper.
 */
function doPost(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const payload = JSON.parse(e.postData.contents);

  if (payload.type === "full_portfolio") {
    
    // --- 1. OVERVIEW SHEET ---
    let overviewSheet = ss.getSheetByName("Overview") || ss.insertSheet("Overview");
    overviewSheet.clear(); 
    
    const overviewRows = [['Ticker', 'Invested (%)', 'P/L (%)']];
    payload.overview.forEach(item => overviewRows.push([item.ticker, item.invested, item.pl]));
    overviewSheet.getRange(1, 1, overviewRows.length, 3).setValues(overviewRows);
    overviewSheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#2c3e50').setFontColor('white');
    overviewSheet.setFrozenRows(1);
    overviewSheet.getRange(2, 2, overviewRows.length - 1, 2).setHorizontalAlignment('center').setVerticalAlignment('middle');
    overviewSheet.getDataRange().setBorder(true, true, true, true, true, true, '#e0e0e0', SpreadsheetApp.BorderStyle.SOLID);
    overviewSheet.setRowHeights(1, overviewRows.length, 32);
    
    // Manage Filters safely
    if (overviewSheet.getFilter()) overviewSheet.getFilter().remove();
    overviewSheet.getDataRange().createFilter();

    const parseDate = (dStr) => {
       if(!dStr) return "";
       try {
           const p = dStr.split(/[\s/:]/);
           if(p.length >= 5) return new Date(p[2], p[1]-1, p[0], p[3], p[4]);
       } catch(err) {}
       return dStr;
    };

    // --- 2. ACTIVE TRADES SHEET ---
    let tradesSheet = ss.getSheetByName("Trades History") || ss.insertSheet("Trades History");
    tradesSheet.clear();
    
    payload.trades.sort((a, b) => {
       if (a.ticker !== b.ticker) return a.ticker.localeCompare(b.ticker);
       const tA = new Date(parseDate(a.date)).getTime() || 0;
       const tB = new Date(parseDate(b.date)).getTime() || 0;
       return tB - tA;
    });

    const tradesRows = [['Action', 'Date', 'Amount', 'Open Price']];
    payload.trades.forEach(trade => tradesRows.push([trade.action, parseDate(trade.date), trade.amount, trade.openPrice]));
    
    if (tradesRows.length > 1) {
      tradesSheet.getRange(1, 1, tradesRows.length, 4).setValues(tradesRows);
      tradesSheet.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#2c3e50').setFontColor('white');
      tradesSheet.setFrozenRows(1);
      tradesSheet.getRange(2, 2, tradesRows.length - 1, 1).setNumberFormat('dd/MM/yyyy HH:mm');
      tradesSheet.getRange(2, 2, tradesRows.length - 1, 2).setHorizontalAlignment('center').setVerticalAlignment('middle');
      tradesSheet.getDataRange().setBorder(true, true, true, true, true, true, '#e0e0e0', SpreadsheetApp.BorderStyle.SOLID);
      tradesSheet.setRowHeights(1, tradesRows.length, 30);
      
      // Manage Filters safely
      if (tradesSheet.getFilter()) tradesSheet.getFilter().remove();
      tradesSheet.getDataRange().createFilter();
    }

    // --- 3. CLOSED HISTORY SHEET ---
    if (payload.history && payload.history.length > 0) {
      let historySheet = ss.getSheetByName("Closed History") || ss.insertSheet("Closed History");
      historySheet.clear();

      const historyRows = [['Action', 'Open Price', 'Open Date', 'Close Price', 'Close Date', 'P/L (%)']];
      payload.history.forEach(trade => {
        historyRows.push([trade.action, trade.open, parseDate(trade.openDate), trade.close, parseDate(trade.closeDate), trade.pl]);
      });

      historySheet.getRange(1, 1, historyRows.length, 6).setValues(historyRows);
      historySheet.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#2c3e50').setFontColor('white');
      historySheet.setFrozenRows(1);
      historySheet.getRange(2, 3, historyRows.length - 1, 1).setNumberFormat('dd/MM/yyyy HH:mm').setHorizontalAlignment('center');
      historySheet.getRange(2, 5, historyRows.length - 1, 1).setNumberFormat('dd/MM/yyyy HH:mm').setHorizontalAlignment('center');
      historySheet.getRange(2, 6, historyRows.length - 1, 1).setHorizontalAlignment('center');
      historySheet.getDataRange().setBorder(true, true, true, true, true, true, '#e0e0e0', SpreadsheetApp.BorderStyle.SOLID);
      historySheet.setRowHeights(1, historyRows.length, 30);
      
      // Manage Filters safely
      if (historySheet.getFilter()) historySheet.getFilter().remove();
      historySheet.getDataRange().createFilter();
    }

    // --- 4. ENFORCE TAB ORDER ---
    const tabOrder = ["Overview", "Trades History", "Closed History"];
    tabOrder.forEach((sheetName, index) => {
      const sheet = ss.getSheetByName(sheetName);
      if (sheet) {
        ss.setActiveSheet(sheet);
        ss.moveActiveSheet(index + 1);
      }
    });

    return ContentService.createTextOutput("Success").setMimeType(ContentService.MimeType.TEXT);
  }
}

/**
 * AI Function to analyze portfolio data.
 */
function AI_PORTFOLIO_ANALYSIS(promptText, overviewRange, tradesRange, historyRange) {
  const cache = CacheService.getScriptCache();
  const cacheKey = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, promptText + JSON.stringify(overviewRange)));
  const cachedResponse = cache.get(cacheKey);
  if (cachedResponse != null) return cachedResponse;

  const apiKey = "YOUR_API_KEY_HERE"; 
  const modelId = "gemini-2.0-flash"; 
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + modelId + ":generateContent?key=" + apiKey;
  
  const payload = {
    "contents": [{ 
      "parts": [{ 
        "text": promptText + 
                "\n\n[PORTFOLIO OVERVIEW]\n" + JSON.stringify(overviewRange) + 
                "\n\n[ACTIVE TRADES]\n" + JSON.stringify(tradesRange) +
                "\n\n[CLOSED HISTORY]\n" + JSON.stringify(historyRange)
      }] 
    }]
  };

  const options = { "method": "post", "contentType": "application/json", "payload": JSON.stringify(payload), "muteHttpExceptions": true };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const res = JSON.parse(response.getContentText());
    if (res.error) return "API Error: " + res.error.message;
    const resultText = res.candidates[0].content.parts[0].text;
    cache.put(cacheKey, resultText, 21600); 
    return resultText;
  } catch (e) { return "Error: " + e.toString(); }
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
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
4. Configure your `.env` file with your targets:
   ```env
   WEBHOOK_URL=https://script.google.com/macros/s/your-webhook-url/exec
   TRADER_USERNAME=example_trader_username
   HISTORY_TRADES_TARGET=number_of_trades_to_scrape
   ```

### 3. Usage
Run the scraper:
```bash
node index.js
```

## 🧠 AI Financial Analysis & Insights

You can analyze the gathered data using two different methods depending on your Google subscription and technical preference. I recommend creating a **4th tab** named `Summary & Analysis` to perform these tasks.

> **💡 Tip: Build a "Prompt Library"**
> Use this tab to store a list of pre-defined prompts in different cells (e.g., "Risk Analysis," "Weekly Summary," "ETF Transition"). This allows you to quickly copy-paste them into the Gemini sidebar or reference them directly in your formulas without re-typing.

### Option A: Custom Script (Free / Developer Choice)
This method uses the built-in `AI_PORTFOLIO_ANALYSIS` function.
* **Setup:** Ensure your [Google AI Studio API Key](https://aistudio.google.com/) is pasted in `AppScript.gs`.
* **Formula:** `=AI_PORTFOLIO_ANALYSIS(A1, Overview!A2:C100, 'Trades History'!A2:D500, 'Closed History'!A2:G1000)` *(where **A1** is your prompt cell)*.

### Option B: Native "Ask Gemini" (Paid / User Friendly)
If you have a paid **Google Gemini** subscription:
* Open the Gemini panel (top right ✨ icon).
* Simply copy a prompt from your **Prompt Library** on the sheet and paste it into the chat. Gemini will analyze the active sheets and provide a conversational response.

---

### 📝 Master Example Prompt (Quantitative Analyst)
Copy and paste this prompt to get a deep quantitative analysis utilizing all three datasets:

> *"Act as a hedge fund-level quantitative financial analyst specializing in portfolio analysis, behavioral finance, and ETF portfolio construction. You are provided with three datasets from an eToro copy trader: a "Portfolio Overview" (current allocations), "Active Trades" (currently open positions), and a "Closed History" (past realized trades with P/L). Your mission is to produce a rigorous, structured, and contextualized analysis.*
> 
> *Before analyzing the data, autonomously evaluate the current macroeconomic context (interest rates, inflation, monetary policy, economic cycle, liquidity conditions, relative asset class performance, and market regime — risk-on / risk-off). Use this context as a framework to interpret the trader's decisions.*
> 
> *First, analyze the portfolio allocation by breaking it down by asset class, sector, and geographic exposure, as well as concentration levels. Formulate a clear diagnosis of the strategy.*
> 
> *Second, deeply analyze the trader's behavior and psychology using both active and closed trades. Evaluate position sizing consistency, scaling patterns, and entry/exit timing quality. Specifically use the "Closed History" to evaluate risk management (drawdown tolerance, tendency to hold losses or cut winners). Identify specific behavioral biases (loss aversion, disposition effect, FOMO) supported by concrete observations.*
> 
> *Third, transition this portfolio into a simplified ETF-based strategy. Define a target percentage allocation that maintains a similar risk profile while optimizing fees (TER), liquidity, and diversification. Propose specific ETFs tailored to the trader's profile and the current macro context.*
> 
> *Finally, provide a critical evaluation identifying the top three structural flaws of the current strategy. Leverage the "Closed History" data to calculate key metrics: average position size, win rate, average win vs. average loss, and realized risk/reward ratio. Every conclusion must be backed by the provided data."*

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