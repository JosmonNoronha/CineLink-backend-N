# 🚀 Push Backend to GitHub - Pre-Flight Checklist

## ✅ Git Safety Check - Run These Commands First!

### Step 1: Verify No Sensitive Files Will Be Committed

```powershell
# Navigate to backend folder
cd backend

# Check what will be committed (should NOT see any .env or firebase files)
git status

# Look for any sensitive files that shouldn't be there
git ls-files | Select-String -Pattern "\.env|firebase.*\.json|serviceAccount|credentials|\.key|\.pem"
```

**Expected Result**: The above command should return **NOTHING**. If you see files, they're already tracked and need to be removed.

---

## 🔒 If Sensitive Files Are Already Tracked

If you accidentally added sensitive files before:

```powershell
# Remove from Git but keep locally
git rm --cached .env
git rm --cached *firebase*.json
git rm --cached *serviceAccount*.json

# Then commit the removal
git add .gitignore
git commit -m "Remove sensitive files from Git tracking"
```

---

## 📋 Push Backend to GitHub - Step by Step

### Option A: Backend Already in Repository (Most Likely Your Case)

Since your backend is in the `Cine-link` repo:

```powershell
# Make sure you're in the project root
cd D:\91982\Desktop\CineLink

# Check current status
git status

# Add all backend changes
git add backend/

# Commit with descriptive message
git commit -m "Prepare backend for Render deployment

- Remove debug console.log statements for production
- Update .gitignore for comprehensive file exclusions
- Add deployment guides and documentation
- Optimize for production environment"

# Push to GitHub
git push origin main
```

### Option B: If Backend Needs to Be Added Fresh

```powershell
cd D:\91982\Desktop\CineLink

# Add all backend files
git add backend/

# Commit
git commit -m "Add production-ready backend with deployment guides"

# Push
git push origin main
```

---

## 🔍 Pre-Push Verification Checklist

Before pushing, verify these files are **IGNORED**:

```powershell
cd backend

# This should show ONLY the files that will be committed
git status

# These should NOT appear:
# ❌ .env
# ❌ .env.local
# ❌ .env.production
# ❌ node_modules/
# ❌ *firebase*.json (any firebase service account files)
# ❌ coverage/
# ❌ logs/
# ❌ *.log files
```

### Files That SHOULD Be Committed:

✅ `src/**/*.js` - All source code
✅ `package.json` - Dependencies
✅ `package-lock.json` - Lock file
✅ `.env.example` - Environment variable template
✅ `.gitignore` - Git ignore rules
✅ `render.yaml` - Render configuration
✅ `*.md` - Documentation files
✅ `.prettierrc.json`, `eslint.config.js` - Config files
✅ `jest.config.cjs` - Test config

---

## 🎯 Quick Push Command (After Verification)

```powershell
cd D:\91982\Desktop\CineLink
git add .
git commit -m "Backend ready for production deployment"
git push origin main
```

---

## 🔐 Security Verification

After pushing, verify on GitHub:

1. Go to: https://github.com/JosmonNoronha/Cine-link
2. Navigate to `backend/` folder
3. **Check that these files DON'T exist:**
   - ❌ `.env`
   - ❌ Any `*firebase*.json` files
   - ❌ `node_modules/` folder
   - ❌ `logs/` folder

4. **Check that these DO exist:**
   - ✅ `src/` folder
   - ✅ `package.json`
   - ✅ `.env.example`
   - ✅ `.gitignore`
   - ✅ All `.md` documentation files

---

## 🚨 If You Accidentally Pushed Secrets

**Don't panic, but act quickly:**

1. **Rotate ALL credentials immediately:**
   - Generate new TMDB API key
   - Generate new Firebase service account
   - Update Render environment variables

2. **Remove from Git history:**

```powershell
# Install git-filter-repo (if not installed)
# Then remove sensitive files from history
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch backend/.env" \
  --prune-empty --tag-name-filter cat -- --all

# Force push (THIS REWRITES HISTORY!)
git push origin --force --all
```

3. **Make repository private** (if it's public):
   - Go to GitHub repo → Settings → Danger Zone
   - Change visibility to Private

---

## 📊 What Gets Committed vs Ignored

### ✅ COMMITTED (Safe to Push):

```
backend/
├── src/                    ✅ Source code
├── scripts/                ✅ Utility scripts
├── test/                   ✅ Test files
├── package.json            ✅ Dependencies
├── package-lock.json       ✅ Lock file
├── .env.example            ✅ Template
├── .gitignore             ✅ Ignore rules
├── render.yaml            ✅ Render config
├── *.md                   ✅ Documentation
├── .prettierrc.json       ✅ Prettier config
├── eslint.config.js       ✅ ESLint config
└── jest.config.cjs        ✅ Jest config
```

### ❌ IGNORED (Never Pushed):

```
backend/
├── .env                   ❌ Secrets
├── .env.local            ❌ Secrets
├── .env.production       ❌ Secrets
├── *firebase*.json       ❌ Credentials
├── node_modules/         ❌ Dependencies (huge)
├── coverage/             ❌ Test results
├── logs/                 ❌ Log files
├── *.log                 ❌ Debug logs
└── .vscode/              ❌ Editor settings
```

---

## 🎬 Complete Push Workflow

```powershell
# 1. Navigate to project
cd D:\91982\Desktop\CineLink

# 2. Check what's changed
git status

# 3. Review changes (optional but recommended)
git diff backend/

# 4. Add backend files
git add backend/

# 5. Check what will be committed
git status

# 6. Verify no sensitive files
git diff --cached --name-only | Select-String -Pattern "\.env|firebase.*\.json"
# Should return nothing!

# 7. Commit with message
git commit -m "Production-ready backend with deployment documentation"

# 8. Push to GitHub
git push origin main

# 9. Verify on GitHub
# Open: https://github.com/JosmonNoronha/Cine-link/tree/main/backend
```

---

## 🎉 After Successful Push

Your backend code is now on GitHub and Render can deploy it!

**Next Steps:**

1. ✅ Code is on GitHub
2. ➡️ Go to Render.com and deploy (follow [RENDER_DEPLOYMENT_GUIDE.md](RENDER_DEPLOYMENT_GUIDE.md))
3. ➡️ Setup Cron-Job.org (follow [CRONJOB_SETUP.md](CRONJOB_SETUP.md))

---

## 💡 Pro Tips

1. **Always verify before pushing:**

   ```powershell
   git status
   git diff --name-only
   ```

2. **Use meaningful commit messages:**
   - ❌ Bad: "update files"
   - ✅ Good: "Optimize backend for production deployment"

3. **Push frequently:**
   - Small, incremental commits
   - Easier to track changes
   - Easier to revert if needed

4. **Check GitHub after every push:**
   - Verify files look correct
   - Check no secrets were pushed
   - Review the diff

---

**Last Updated**: February 11, 2026

Ready to push? Run the commands above! 🚀
