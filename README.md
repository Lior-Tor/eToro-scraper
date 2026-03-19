# eToro Portfolio & Trades Scraper 📈🤖

Stop tracking eToro traders manually. This automated pipeline extracts public portfolios, past performance stats, active trades, and closed histories into a professional Google Sheets dashboard, complete with built-in **AI** behavioral and financial analysis.

## 🚀 Overview

Tracking copy-traders efficiently requires looking beyond just their current holdings. This tool automates the entire process:
1. **Extraction:** A Node.js script uses Puppeteer to scrape the global portfolio, historical performance (monthly/yearly), active trades, and dynamically loads the closed trades history for a specific user.
2. **Transmission:** Data is sent via a secure POST request to a Google Apps Script Webhook.
3. **Storage & UI:** Google Sheets receives the data, auto-formats it with professional styling (Midnight Blue themes, filters, correct date parsing), and splits it into four clear tabs (`Overview`, `Past Performance`, `Trades History`, `Closed History`).
4. **AI Insights:** A custom Sheets function (`AI_PORTFOLIO_ANALYSIS`) or external LLM connector uses the data to analyze the trader's behavior, win rate, and risk management to suggest ETF transition strategies.

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
    
    const parseDate = (dStr) => {
       if(!dStr) return "";
       try {
           const p = dStr.split(/[\s/:]/);
           if(p.length >= 5) return new Date(p[2], p[1]-1, p[0], p[3], p[4]);
       } catch(err) {}
       return dStr;
    };

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
    if (overviewSheet.getFilter()) overviewSheet.getFilter().remove();
    overviewSheet.getDataRange().createFilter();

    // --- 2. PAST PERFORMANCE (STATS) SHEET ---
    if (payload.stats && payload.stats.length > 0) {
      let statsSheet = ss.getSheetByName("Past Performance") || ss.insertSheet("Past Performance");
      statsSheet.clear();
      
      const statsRows = [['Year', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'YTD']];
      payload.stats.forEach(s => {
        statsRows.push([s.year, s.jan, s.feb, s.mar, s.apr, s.may, s.jun, s.jul, s.aug, s.sep, s.oct, s.nov, s.dec, s.ytd]);
      });

      statsSheet.getRange(1, 1, statsRows.length, 14).setValues(statsRows);
      statsSheet.getRange(1, 1, 1, 14).setFontWeight('bold').setBackground('#2c3e50').setFontColor('white');
      statsSheet.setFrozenRows(1);
      statsSheet.getRange(2, 1, statsRows.length - 1, 14).setHorizontalAlignment('center').setVerticalAlignment('middle');
      statsSheet.getDataRange().setBorder(true, true, true, true, true, true, '#e0e0e0', SpreadsheetApp.BorderStyle.SOLID);
      statsSheet.setRowHeights(1, statsRows.length, 30);
    }

    // --- 3. ACTIVE TRADES SHEET ---
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
      if (tradesSheet.getFilter()) tradesSheet.getFilter().remove();
      tradesSheet.getDataRange().createFilter();
    }

    // --- 4. CLOSED HISTORY SHEET ---
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
      if (historySheet.getFilter()) historySheet.getFilter().remove();
      historySheet.getDataRange().createFilter();
    }

    // --- 5. ENFORCE TAB ORDER ---
    const tabOrder = ["Overview", "Past Performance", "Trades History", "Closed History"];
    tabOrder.forEach((sheetName, index) => {
      const sheet = ss.getSheetByName(sheetName);
      if (sheet) {
        ss.setActiveSheet(sheet);
        ss.moveActiveSheet(index + 1);
      }
    });

    return ContentService.createTextOutput("Success: All sheets updated successfully.").setMimeType(ContentService.MimeType.TEXT);
  }
  
  return ContentService.createTextOutput("Error: Invalid Payload.").setMimeType(ContentService.MimeType.TEXT);
}

/**
 * AI Function to analyze portfolio data.
 * Updated to accept 4 ranges (Overview, Stats, Active Trades, Closed History)
 */
function AI_PORTFOLIO_ANALYSIS(promptText, overviewRange, statsRange, tradesRange, historyRange) {
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
                "\n\n[PAST PERFORMANCE (YTD/MONTHLY)]\n" + JSON.stringify(statsRange) + 
                "\n\n[ACTIVE TRADES]\n" + JSON.stringify(tradesRange) +
                "\n\n[CLOSED HISTORY]\n" + JSON.stringify(historyRange)
      }] 
    }]
  };

  const options = { 
      "method": "post", 
      "contentType": "application/json", 
      "payload": JSON.stringify(payload), 
      "muteHttpExceptions": true 
  };

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

You can analyze the gathered data using three different methods depending on your subscriptions and technical preferences. I recommend creating a **5th tab** named `Summary & Analysis` to perform these tasks.

> **💡 Tip: Build a "Prompt Library"**
> Use this tab to store a list of pre-defined prompts in different cells (e.g., "Risk Analysis," "Weekly Summary," "ETF Transition"). This allows you to quickly copy-paste them into your AI of choice or reference them directly in your formulas.

### Option A: Custom Script (Free / Developer Choice)
This method uses the built-in `AI_PORTFOLIO_ANALYSIS` function.
* **Setup:** Ensure your [Google AI Studio API Key](https://aistudio.google.com/) is pasted in `AppScript.gs`.
* **Formula:** `=AI_PORTFOLIO_ANALYSIS(A1, Overview!A2:C100, 'Past Performance'!A1:N20, 'Trades History'!A2:D500, 'Closed History'!A2:G1000)` *(where **A1** is your prompt cell)*.

### Option B: Native "Ask Gemini" (Paid Google Users)
If you have a paid **Google Gemini** subscription:
* Open the Gemini side panel (top right ✨ icon) directly inside Google Sheets.
* Simply copy a prompt from your **Prompt Library** on the sheet and paste it into the chat. Gemini will automatically read your active sheets and provide a conversational response.

### Option C: External AI Connectors (ChatGPT, Claude, Gemini, etc.)
If you prefer using other Large Language Models like ChatGPT, Claude, or Gemini:
* **Native Drive Connectors:** Connect your Google Drive directly to your LLM (e.g., ChatGPT, Claude, or Gemini). Once authorized, simply ask the AI to read your specific Google Sheet and paste your prompt.
* **Manual Upload:** Go to `File > Download > Microsoft Excel (.xlsx)` or `.csv`, and upload the file directly into ChatGPT, Claude, or Gemini along with your prompt.
* **Workspace Add-ons:** Install popular extensions like [GPT for Sheets](https://workspace.google.com/marketplace/app/gpt_for_sheets_and_docs/677318054654), Claude for Sheets, or Gemini add-ons. This allows you to use functions like `=GPT(prompt, range)` natively, mimicking the behavior of Option A but with your preferred AI provider.

---

### 📝 Master Example Prompt (Quantitative Analyst)
Copy and paste this prompt to get a deep quantitative analysis utilizing all **four datasets**:

> *"Act as a hedge fund-level quantitative financial analyst specializing in asset allocation, behavioral finance, and ETF portfolio construction. You are analyzing data from an eToro trader based on **four** datasets: a **Portfolio Overview** containing current positions with invested percentages and P/L, a **Past Performance** detailing historical monthly and yearly returns, an **Active Trades** containing open positions with their percentage size and entry price, and a **Closed History** containing the complete history of closed trades with prices, dates, and P/L. Your mission is to produce a reliable, data-driven, critical, and highly actionable analysis.*
> 
> *Before anything else, if certain data is missing or incomplete, you must explicitly point it out and adapt your analysis accordingly. Do not make unjustified speculative assumptions. Calculations can be approximate but must remain consistent. Absolute priority is reliability over exhaustiveness.*
> 
> *Begin by briefly evaluating the current macroeconomic context, identifying the direction of interest rates and their impact, the level and trend of inflation, geopolitical tensions, monetary policy stance, and the market regime (risk-on or risk-off). Conclude in a few lines with concrete implications for asset allocation, particularly between equities, commodities, and other asset classes, staying concise and avoiding generalities.*
> 
> *Next, analyze the portfolio by detailing the breakdown by asset class, dominant sector exposure, and implicit geographic exposure. Evaluate the concentration level by identifying the main positions and assessing whether concentration is low, moderate, or high. Analyze true diversification by identifying implicit correlations between positions, especially sectoral or geographic clusters, and detect cases of false diversification. Conclude with a clear diagnosis of the portfolio's coherence regarding the macroeconomic context.*
> 
> *Continue with a deep behavioral and performance analysis based on the **Past Performance**, **Closed History**, and **Active Trades**. Specifically use the **Past Performance** to evaluate long-term gain consistency, identify major drawdowns (how did the trader react during market shocks?), and judge overall resilience. Evaluate position sizing by estimating the average position size and its consistency. Roughly calculate the win rate, average win, and average loss via the closed history to deduce an implicit risk/reward ratio. Analyze risk management by identifying the tendency to cut or hold losses, potential bag holding, and signs of poor drawdown control. Mandatorily identify behavioral patterns by naming each bias (loss aversion, disposition effect, FOMO, overtrading), providing concrete proof from the data, and explaining its impact on performance. Also, analyze the trading style (frequency, holding period, type). Conclude with a clear and synthetic psychological profile of the trader.*
> 
> *Then, transform this portfolio into an ETF-based strategy with a primary goal of replicating the trader's exposures, not discretionary reallocation. The objective is to capture the same sectoral, geographic, and factor biases while simplifying the structure via ETFs. You must reason by exposure clusters (e.g., if the trader holds RTX or Lockheed Martin, propose ITA). Propose concrete ETFs with their tickers and suggest similar alternatives when relevant. Each ETF must explicitly correspond to a cluster from the initial portfolio. For each ETF, explain exactly which exposure it replicates, any residual differences, and the improvements made (diversification, costs) without significantly altering the risk profile. Provide a target percentage allocation; if the trader holds cash, this component must be explicitly preserved in the final allocation.*
> 
> *Next, provide a highly critical final diagnosis by identifying the top three major structural errors of the trader based purely on the data, with direct and unfiltered explanations. Then concretely explain what a professional would do differently with specific, immediately applicable actions, without staying theoretical.*
> 
> *Directly leverage the **Past Performance** data to compare the trader's annual returns against a simple benchmark like the S&P 500 or MSCI World. Evaluate true alpha creation: does the outperformance justify the risk taken and time invested compared to passive holding?*
> 
> *Finally, assign an overall score out of 100 based on risk management, coherence, discipline, and portfolio construction, briefly justifying this score.*
> 
> *The response must be structured, concise, analytical, free of fluff, and every conclusion must be directly linked to an observation from the data."*

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