# ⚙ AutoFlow Dashboard

A live automotive engineering workflow dashboard that reads data directly from a Google Sheet.
The data owner just edits the sheet — the dashboard updates automatically every 60 seconds.

---

## 📋 Google Sheet Setup (do this first)

### Step 1 — Create the sheet

Create a Google Sheet with these **exact column headers in Row 1**:

| partNo | partName | engineer | commodity | activity | priority | status | target | actual |
|--------|----------|----------|-----------|----------|----------|--------|--------|--------|

**Column rules:**
- `engineer` → one of: Jeeva, Bala, Anjali, Vikranth
- `commodity` → one of: Rubber, Plastic, Wheel Assy, Wheel Assy Child Parts, Washer / Clamps
- `activity` → one of: ECN/DR Changes, Capacity Increase, VAVE, Replace Mould, Localization
- `priority` → one of: Critical, High, Medium, Low
- `status` → one of: Pending, In Progress, Implemented, On Hold
- `target` / `actual` → date format YYYY-MM-DD (e.g. 2025-06-15)

### Step 2 — Publish the sheet as CSV

1. In Google Sheets → **File → Share → Publish to web**
2. Select the correct tab/sheet
3. Change format from "Web page" to **"Comma-separated values (.csv)"**
4. Click **Publish** → confirm
5. Copy the URL (looks like: `https://docs.google.com/spreadsheets/d/ABC.../pub?gid=0&single=true&output=csv`)

---

## 🚀 Local Development

```bash
# 1. Install dependencies
npm install

# 2. Create your .env file
cp .env.example .env
# Edit .env and paste your Google Sheet CSV URL

# 3. Run locally
npm run dev
# Open http://localhost:5173
```

---

## 🌐 Deploy to Vercel

### Option A — Vercel CLI
```bash
npm install -g vercel
vercel
# Follow prompts → when asked for environment variables, add VITE_SHEET_CSV_URL
```

### Option B — Vercel Dashboard (recommended)
1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → New Project → Import your repo
3. Before deploying, go to **Settings → Environment Variables**
4. Add: `VITE_SHEET_CSV_URL` = your CSV URL from Step 2
5. Click **Deploy**

> ⚠️ The `.env` file is git-ignored for security. Always set the variable in Vercel's dashboard.

---

## 🔄 How live updates work

- The dashboard **auto-refreshes every 60 seconds** from the Google Sheet
- The data owner just edits the Google Sheet — no login to the app needed
- A manual **⟳ Refresh** button is available in the header
- Last fetch time is shown next to the Refresh button

---

## 📁 Project Structure

```
autoflow-dashboard/
├── src/
│   ├── App.jsx        ← Main dashboard (all logic + UI)
│   └── main.jsx       ← React entry point
├── index.html
├── package.json
├── vite.config.js
├── .env.example       ← Copy to .env and fill in your Sheet URL
├── .gitignore         ← .env is excluded from git
└── README.md
```
