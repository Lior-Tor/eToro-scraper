# eToro Portfolio & Trades Scraper 📈🤖

An automated end-to-end solution to extract, track, and analyze eToro copy-trader data. This project uses **Puppeteer** to scrape public portfolio data and **Google Apps Script** to host a custom backend that manages a professional Google Sheets dashboard, complete with **Gemini AI** financial analysis.

## 🚀 Overview

Tracking eToro traders manually is tedious. This tool automates the entire process:
1. **Extraction:** A Node.js script scrapes the global portfolio and deep-dives into every individual trade history for a specific user.
2. **Transmission:** Data is sent via a secure POST request to a Google Apps Script Webhook.
3. **Storage & UI:** Google Sheets receives the data, formats it with professional styling (Midnight Blue themes, centered alignments), and sorts trades chronologically.
4. **AI Insights:** A custom Sheets function (`AI_PORTFOLIO_ANALYSIS`) uses **Gemini AI** to analyze the trader's behavior and suggest transition strategies.

## 📂 Project Structure

```text
.
├── node_modules/       # Installed dependencies
├── .env                # Private credentials (Webhook URL, Ticker)
├── .env.example        # Template for environment variables
├── .gitignore          # Tells Git to ignore .env and node_modules
├── index.js            # Main Puppeteer scraping logic
├── package-lock.json   # Exact versions of dependencies
├── package.json        # Project metadata and dependencies
└── README.md           # Documentation
```
*Note: The `AppScript.gs` code is hosted on Google Servers and is not part of the local file tree.*

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

    let tradesSheet = ss.getSheetByName("Trades History") || ss.insertSheet("Trades History");
    tradesSheet.clear();
    
    payload.trades.sort((a, b) => {
       if (a.ticker !== b.ticker) return a.ticker.localeCompare(b.ticker);
       const parseDate = (d) => {
           if(!d) return 0;
           const p = d.split(/[\s/:]/);
           return new Date(p[2], p[1]-1, p[0], p[3], p[4]).getTime();
       };
       return parseDate(b.date) - parseDate(a.date);
    });

    const tradesRows = [['Action', 'Date', 'Amount', 'Open Price']];
    payload.trades.forEach(trade => {
      let dateObj = trade.date;
      try {
         const p = trade.date.split(/[\s/:]/);
         if(p.length >= 5) dateObj = new Date(p[2], p[1]-1, p[0], p[3], p[4]);
      } catch(err) {}
      tradesRows.push([trade.action, dateObj, trade.amount, trade.openPrice]);
    });
    
    if (tradesRows.length > 1) {
      tradesSheet.getRange(1, 1, tradesRows.length, 4).setValues(tradesRows);
      tradesSheet.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#2c3e50').setFontColor('white');
      tradesSheet.setFrozenRows(1);
      tradesSheet.getRange(2, 2, tradesRows.length - 1, 1).setNumberFormat('dd/MM/yyyy HH:mm');
      tradesSheet.getRange(2, 2, tradesRows.length - 1, 2).setHorizontalAlignment('center').setVerticalAlignment('middle');
      tradesSheet.getDataRange().setBorder(true, true, true, true, true, true, '#e0e0e0', SpreadsheetApp.BorderStyle.SOLID);
      tradesSheet.setRowHeights(1, tradesRows.length, 30);
    }
    return ContentService.createTextOutput("Success").setMimeType(ContentService.MimeType.TEXT);
  }
}

/**
 * AI Function to analyze portfolio data.
 */
function AI_PORTFOLIO_ANALYSIS(promptText, overviewRange, tradesRange) {
  const cache = CacheService.getScriptCache();
  const cacheKey = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, promptText + JSON.stringify(overviewRange)));
  const cachedResponse = cache.get(cacheKey);
  if (cachedResponse != null) return cachedResponse;

  const apiKey = "YOUR_API_KEY_HERE"; 
  const modelId = "gemini-2.0-flash"; 
  const url = "[https://generativelanguage.googleapis.com/v1beta/models/](https://generativelanguage.googleapis.com/v1beta/models/)" + modelId + ":generateContent?key=" + apiKey;
  
  const payload = {
    "contents": [{ "parts": [{ "text": promptText + "\n\nOverview:\n" + JSON.stringify(overviewRange) + "\n\nTrades:\n" + JSON.stringify(tradesRange) }] }]
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
   - Click **Deploy > New Deployment**.
   - Select type: **Web App**.
   - Who has access: **Anyone**.
5. Copy the **Web App URL**.

### 2. Local Environment Setup
1. Clone the repository:
   ```bash
   git clone [https://github.com/Lior-Tor/eToro-scraper.git](https://github.com/Lior-Tor/eToro-scraper.git)
   cd eToro-scraper
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file and add your **Webhook URL** and **TRADER_USERNAME**.

### 3. Usage
Run the scraper:
```bash
node index.js
```

## 🧠 AI Financial Analysis & Insights

You can analyze the gathered data using two different methods depending on your Google subscription and technical preference. I recommend creating a **3rd tab** named `Summary & Analysis` to perform these tasks.

> **💡 Tip: Build a "Prompt Library"**
> Use this 3rd tab to store a list of pre-defined prompts in different cells (e.g., "Risk Analysis," "Weekly Summary," "ETF Transition"). This allows you to quickly copy-paste them into the Gemini sidebar or reference them directly in your formulas without re-typing.

### Option A: Custom Script (Free / Developer Choice)
This method uses the built-in `AI_PORTFOLIO_ANALYSIS` function. It is ideal for creating an automated, self-updating dashboard.

* **Setup:** Ensure your Gemini API Key is pasted in `AppScript.gs`.
* **Formula:** `=AI_PORTFOLIO_ANALYSIS(A1, Overview!A2:C100, 'Trades History'!A2:D500)` (where **A1** is a cell from your **Prompt Library**).
* **Pros:** Totally automated, uses the free API quota, and provides a programmatic report directly in your sheet.

### Option B: Native "Ask Gemini" (Paid / User Friendly)
If you have a paid **Google Gemini** subscription, you can use the native side panel.

* **How to:** Open the Gemini panel (top right ✨ icon) while staying on your `Summary & Analysis` tab.
* **Usage:** Simply copy a prompt from your **Prompt Library** on the sheet and paste it into the chat. Gemini will analyze the active sheets and provide a conversational response.
* **Pros:** No API key required, supports natural follow-up questions, and offers a more interactive experience.

---

### 📝 Example Prompt (Works for both methods)
Copy and paste this prompt to get a high-level quantitative analysis:

> *"Act as a professional quantitative financial analyst. I am providing you with two datasets from an eToro copy trader: a 'Portfolio Overview' (current allocations) and a 'Trades History' (past and current entries). First, summarize the asset allocation strategy. Second, deeply analyze the trader's behavior and psychology based on their trade history (e.g., position sizing, entry timing, averaging down/up, trading frequency). Finally, provide actionable recommendations to transition this portfolio into a simplified, cost-effective ETF-based strategy, suggesting the best globally diversified or sector-specific ETFs that match this risk profile. Explain your reasoning."*

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
- **No Financial Advice:** The AI-generated insights are for informational purposes only and do not constitute financial advice.

## 🛡️ License
ISC License.
