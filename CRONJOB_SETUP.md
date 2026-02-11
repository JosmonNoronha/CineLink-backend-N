# 🕐 Cron-Job.org Setup for CineLink Backend

## Quick Setup Guide

### Step 1: Create Account

1. Go to https://cron-job.org
2. Sign up (free, no credit card)
3. Verify email

### Step 2: Create Keepalive Job

After your backend is deployed to Render:

1. **Click "Cronjobs" → "Create cronjob"**

2. **Fill in the form:**

   ```
   Title: CineLink Backend Keepalive

   URL: https://your-backend-url.onrender.com/api/health

   Schedule: Every 10 minutes
   (Use the dropdown: "Every X minutes" → 10)

   Request method: GET

   Request timeout: 30 seconds

   Save responses: ✓ Enabled (for debugging)

   Notify on failure: ✓ Enabled
   Email: your-email@example.com
   ```

3. **Click "Create"**

### Step 3: Verify It's Working

1. Wait 10-15 minutes
2. Check **"Executions"** tab
3. Verify status: ✅ **200 OK**
4. Check Render logs - should see health check requests

### Expected Response

Your backend should return:

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

### Troubleshooting

**If cron job fails (non-200 status):**

1. Test URL manually in browser
2. Check Render deployment status
3. Verify backend is running (check Render logs)
4. Ensure health endpoint path is correct: `/api/health`

**If backend still spins down:**

- Reduce interval to **5 minutes**
- Verify cron job is actually running (check execution history)
- Check Render metrics to confirm traffic

### Pro Tips

1. **Add second job for redundancy:**
   - Same config but offset by 5 minutes
   - Pings at :00, :10, :20... and :05, :15, :25...

2. **Monitor from multiple regions:**
   - Cron-Job.org pings from Europe by default
   - Add UptimeRobot (free) for US monitoring

3. **Alert configuration:**
   - Enable email notifications
   - Get alerted if 3+ consecutive failures
   - Connect to Discord/Slack (optional)

### Free Tier Limits

- ✅ Unlimited cron jobs
- ✅ Every minute minimum frequency
- ✅ 90 days execution history
- ✅ Email notifications
- ✅ HTTPS requests

---

## ML Recommender Setup

If/when you deploy the ML recommender to Render:

1. Create second cron job:

   ```
   Title: ML Recommender Keepalive
   URL: https://movie-reco-api.onrender.com/health
   Schedule: Every 10 minutes
   ```

2. Both services will now stay warm 24/7

---

**Last Updated**: February 11, 2026
