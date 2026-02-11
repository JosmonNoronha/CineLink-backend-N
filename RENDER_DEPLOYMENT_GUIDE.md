# 🚀 CineLink Backend - Render Deployment Guide

## ✅ Pre-Deployment Checklist

Your backend is now **production-ready**:

- ✅ Console logs removed for better performance
- ✅ Proper error logging with Winston
- ✅ Environment validation configured
- ✅ Health check endpoint ready
- ✅ Firebase Admin SDK optimized with warmup
- ✅ Rate limiting configured
- ✅ Compression enabled
- ✅ Security headers (Helmet) configured

---

## 📋 Prerequisites

Before deploying, gather these credentials:

### 1. **TMDB API Key**

- Go to: https://www.themoviedb.org/settings/api
- Copy your API Key (v3 auth)

### 2. **Firebase Service Account JSON**

- Go to: https://console.firebase.google.com
- Select your project (cinelink or whatever you named it)
- Click ⚙️ (Settings) → **Project Settings**
- Go to **Service Accounts** tab
- Click **Generate New Private Key** → Download JSON file
- **IMPORTANT**: This file should be kept secure!

---

## 🎯 Step-by-Step Deployment

### **Step 1: Prepare Firebase Credentials for Render**

Render requires environment variables, so we need to convert the Firebase JSON to Base64:

#### **Option A: Using PowerShell (Windows)**

```powershell
# Navigate to where you saved the Firebase JSON file
cd "C:\path\to\your\firebase-service-account.json"

# Convert to Base64 (single line)
$json = Get-Content "firebase-service-account.json" -Raw
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
$base64 = [Convert]::ToBase64String($bytes)
$base64 | Set-Clipboard
Write-Host "Base64 copied to clipboard!"
```

#### **Option B: Using Online Tool (Quick Method)**

1. Go to: https://www.base64encode.org/
2. Paste your entire Firebase JSON file content
3. Click "Encode"
4. Copy the result

---

### **Step 2: Create Render Account**

1. Go to: https://render.com
2. Sign up with GitHub (recommended - enables auto-deploy)
3. Verify your email

---

### **Step 3: Connect GitHub Repository**

1. In Render dashboard, click **"New +"** → **"Web Service"**
2. Click **"Connect a repository"**
3. Authorize Render to access your GitHub
4. Select your **"Cine-link"** repository
5. Click **"Connect"**

---

### **Step 4: Configure Web Service**

Fill in the deployment form:

#### **Basic Settings:**

- **Name**: `cinelink-backend` (or your preferred name)
- **Region**: Select closest to your users:
  - **Oregon (US West)** - Good for global
  - **Frankfurt** - Good for Europe/India
  - **Singapore** - Good for Asia
- **Branch**: `main`
- **Root Directory**: `backend` ⚠️ **IMPORTANT!**
- **Runtime**: `Node`

#### **Build & Deploy:**

- **Build Command**: `npm ci`
- **Start Command**: `npm start`

#### **Plan:**

- Select **Free** (for now)
- Note: Free tier spins down after 15 min inactivity (we'll fix with cron-job)

---

### **Step 5: Configure Environment Variables**

Click **"Advanced"** → **"Add Environment Variable"** for each:

```bash
# Node Environment
NODE_ENV=production

# Port (Render provides this automatically, but good to set)
PORT=5001

# API Prefix
API_PREFIX=/api

# CORS Origins (update after getting your app URL)
CORS_ORIGIN=https://your-frontend-app.com,exp://192.168.1.100:8081

# TMDB API
TMDB_API_KEY=your_tmdb_api_key_here
TMDB_BASE_URL=https://api.themoviedb.org/3
TMDB_IMAGE_BASE_URL=https://image.tmdb.org/t/p

# Firebase Admin (use Base64 from Step 1)
FIREBASE_SERVICE_ACCOUNT_JSON_BASE64=your_base64_encoded_json_here

# Redis (Optional - leave empty for free tier)
REDIS_URL=

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=120
SEARCH_RATE_LIMIT_MAX=40

# Logging
LOG_LEVEL=info

# Sentry (Optional - for error tracking)
# SENTRY_DSN=
# SENTRY_TRACES_SAMPLE_RATE=0.1
```

**CRITICAL**: Make sure to paste your:

- ✅ TMDB API Key
- ✅ Base64-encoded Firebase JSON
- ✅ Set NODE_ENV to `production`

---

### **Step 6: Configure Health Check**

Scroll down to **"Health Check Path"**:

- Enter: `/api/health`

This tells Render to ping this endpoint to check if your app is running.

---

### **Step 7: Deploy!**

1. Click **"Create Web Service"** at the bottom
2. Render will start building and deploying
3. **Wait 5-10 minutes** for:
   - Dependencies to install
   - Firebase Admin SDK to initialize
   - First health check to pass

#### **Monitor Deployment:**

- Watch the **Logs** tab for any errors
- You should see: `✅ Server running on port 5001`
- Health check should turn **green**

---

### **Step 8: Test Your Deployment**

Once deployed, Render gives you a URL like:

```
https://cinelink-backend-xyz.onrender.com
```

#### **Test the Health Endpoint:**

```bash
# Using curl
curl https://your-backend-url.onrender.com/api/health

# Or open in browser
https://your-backend-url.onrender.com/api/health
```

**Expected Response:**

```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "version": "2.0.0",
    "timestamp": "2026-02-11T...",
    "services": {
      "cache": "disabled-or-not-ready"
    }
  }
}
```

---

## 🔧 Post-Deployment Configuration

### **1. Update Frontend to Use Backend URL**

In your React Native app, update the API base URL:

**File**: `src/services/api.js` or wherever your API client is:

```javascript
const API_BASE_URL = __DEV__
  ? 'http://localhost:5001/api' // Local development
  : 'https://your-backend-url.onrender.com/api'; // Production
```

### **2. Update CORS Origins**

After deploying your frontend (Expo app):

1. Go back to Render dashboard
2. Click on your service → **Environment**
3. Update `CORS_ORIGIN` to include your app domains:

```
CORS_ORIGIN=https://your-frontend.vercel.app,exp://192.168.1.100:8081
```

4. Click **"Save Changes"** (will auto-redeploy)

### **3. Set Up Cron-Job.org Keepalive**

See the main Cron-Job setup guide, but here's your backend URL:

- **URL to ping**: `https://your-backend-url.onrender.com/api/health`
- **Frequency**: Every 10 minutes
- **Timeout**: 30 seconds

---

## 📊 Monitoring & Logs

### **View Logs:**

1. Render Dashboard → Your Service → **Logs** tab
2. Real-time logs stream here
3. Use filters to find errors

### **View Metrics:**

1. Click **Metrics** tab
2. See: CPU, Memory, Request count, Response times
3. Free tier has limited metrics

### **Set Up Alerts:**

1. Click **Settings** → **Notifications**
2. Add email for deploy failures
3. Get notified if service crashes

---

## 🚨 Troubleshooting

### **Problem: Build Fails**

**Check:**

- ✅ Root Directory is set to `backend`
- ✅ Build command is `npm ci` (not `npm install`)
- ✅ Node version in `package.json` matches (`>=20`)

**Fix:** Check build logs for specific errors

---

### **Problem: Deploy Succeeds but Health Check Fails**

**Common Causes:**

1. **Wrong Firebase credentials**

   ```
   Solution: Double-check Base64 encoding, ensure it's a single line
   ```

2. **Missing TMDB API Key**

   ```
   Solution: Add TMDB_API_KEY environment variable
   ```

3. **Port binding issue**
   ```
   Solution: Ensure server.js uses process.env.PORT
   ```

**Fix:**

- Check Logs tab for error messages
- Look for Firebase initialization errors
- Verify all required environment variables are set

---

### **Problem: "Firebase Admin misconfigured" Error**

**Causes:**

- Incorrectly formatted Base64 string
- JSON file missing required fields
- Wrong project ID

**Fix:**

1. Re-download Firebase service account JSON
2. Re-encode to Base64 (ensure no line breaks)
3. Update `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` variable
4. Trigger manual deploy

---

### **Problem: Slow First Request (Cold Start)**

**Expected Behavior:**

- First request after 15 min: **30-60 seconds**
- Subsequent requests: **< 1 second**

**Solutions:**

1. ✅ **Use Cron-Job.org** (recommended - keeps it warm)
2. Upgrade to paid tier ($7/mo - always on)
3. Accept the limitation (free tier)

---

### **Problem: 429 Too Many Requests**

**Cause:** Rate limiting triggered

**Fix:**

- Increase limits in environment variables:
  ```
  RATE_LIMIT_MAX=200
  SEARCH_RATE_LIMIT_MAX=60
  ```
- Or implement exponential backoff in your app

---

## 🔐 Security Best Practices

### **1. Never Commit Secrets**

- ✅ .env is in .gitignore
- ✅ Firebase JSON should NEVER be in repository
- ✅ Use Render environment variables

### **2. Rotate Keys Periodically**

- TMDB API key: Every 6 months
- Firebase service account: Every year

### **3. Monitor Unusual Activity**

- Check Render metrics for spikes
- Review logs for suspicious requests
- Set up Sentry for error tracking (optional)

---

## 📈 Upgrading to Paid Tier (Optional)

When ready for production:

1. Click **Settings** → **Plan**
2. Upgrade to **Starter** ($7/month)

**Benefits:**

- ✅ Always on (no cold starts)
- ✅ 512MB RAM (vs 256MB free)
- ✅ Better performance
- ✅ Custom domains
- ✅ More concurrent requests

---

## 🎉 Deployment Complete!

Your backend is now live at:

```
https://your-backend-url.onrender.com
```

### **Next Steps:**

1. ✅ Set up Cron-Job.org to keep it alive
2. ✅ Update frontend to use production URL
3. ✅ Test all endpoints with Postman or your app
4. ✅ Monitor logs for first 24 hours
5. ✅ Set up error tracking (Sentry - optional)

### **Test Checklist:**

- [ ] `/api/health` returns 200
- [ ] `/api/status` shows service info
- [ ] TMDB endpoints work (search, details)
- [ ] Firebase auth works (login, get profile)
- [ ] Favorites/Watchlists working
- [ ] No errors in Render logs

---

## 📞 Need Help?

**Render Issues:**

- Docs: https://render.com/docs
- Community: https://community.render.com
- Status: https://status.render.com

**CineLink Backend Issues:**

- Check logs in Render dashboard
- Review environment variables
- Test locally first: `npm run dev`

---

**Deployment Date**: February 11, 2026
**Backend Version**: 2.0.0
**Platform**: Render.com (Free Tier)

Good luck! 🚀
