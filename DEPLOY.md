# Deploy to Web - Step by Step Guide

## Option 1: Render (Recommended - Easiest)

### Step 1: Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/pharma-pos.git
git push -u origin main
```

### Step 2: Deploy on Render
1. Go to [render.com](https://render.com) and sign up/login
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repo
4. Configure:
   - **Name**: `pharma-pos`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: Free or Starter ($7/month for persistent disk)
5. Add **Disk** (important for SQLite):
   - Name: `data`
   - Mount Path: `/opt/render/project/src`
   - Size: 1 GB
6. Click **Create Web Service**

### Step 3: Set Auto-Deploy
1. In Render dashboard → Settings
2. Enable **Auto-Deploy** on git push
3. Copy the **Deploy Hook URL**
4. In GitHub repo → Settings → Secrets → Actions:
   - Add `RENDER_DEPLOY_HOOK_URL` with the copied URL

---

## Option 2: Railway (Alternative)

1. Go to [railway.app](https://railway.app)
2. New Project → Deploy from GitHub repo
3. Add **Volume** for database persistence:
   - Settings → Volumes → Add Volume
   - Mount path: `/app`
4. Deploy!

---

## Option 3: Local + Cloud Sync Architecture

For true sync between local and web, you need:

### A) Cloud Database (PostgreSQL)
Replace SQLite with a cloud database that both local and web can access.

### B) Or: Sync Service
Keep local SQLite + deployed SQLite, sync via API:

1. **Local changes** → Push to cloud API
2. **Cloud changes** → Pull to local periodically

---

## Data Sync Setup (Local ↔ Web)

### If using Render with persistent disk:
- Database stays on disk even after restarts
- Manual backup/restore for moving data between local and web

### For Real-time Sync (Advanced):

**1. Add sync endpoints to `server.js`:**
```javascript
// Export all data
app.get('/api/sync/export', async (req, res) => {
  const data = await exportAllData();
  res.json(data);
});

// Import data
app.post('/api/sync/import', async (req, res) => {
  await importAllData(req.body);
  res.json({ success: true });
});
```

**2. Create `sync.js` utility:**
```javascript
// Run: node sync.js --to-web
// or:  node sync.js --from-web
```

---

## After Deployment

### Your URLs:
- **Web App**: `https://pharma-pos-xxx.onrender.com`
- **Local**: `http://localhost:3000`

### Sync Workflow:
1. **Code changes**: Push to GitHub → Auto-deploys to web
2. **Data changes**: Use backup/restore or sync utility

### Backup/Restore for Data:
```bash
# Backup local data
cp pharma.db pharma-backup-$(date +%Y%m%d).db

# To move to web - use the Data Backup module
# Or download/upload the .db file
```

---

## Need Help?

- **Render Docs**: https://render.com/docs
- **Deploy Issues**: Check Render logs in dashboard
- **Database lost?**: Ensure disk is mounted correctly
