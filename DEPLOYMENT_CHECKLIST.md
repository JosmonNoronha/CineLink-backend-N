# ✅ CineLink Backend Deployment Checklist

Copy this checklist and check off items as you complete them.

## Pre-Deployment

- [ ] TMDB API key obtained from https://www.themoviedb.org/settings/api
- [ ] Firebase service account JSON downloaded
- [ ] Firebase JSON converted to Base64
- [ ] GitHub repository pushed and up-to-date

## Render Setup

- [ ] Render.com account created
- [ ] GitHub connected to Render
- [ ] Repository authorized

## Web Service Configuration

- [ ] Service name: `cinelink-backend` (or your choice)
- [ ] Region selected (Oregon/Frankfurt/Singapore)
- [ ] Branch: `main`
- [ ] Root directory: `backend` ⚠️
- [ ] Runtime: Node
- [ ] Build command: `npm ci`
- [ ] Start command: `npm start`
- [ ] Plan: Free (for now)
- [ ] Health check path: `/api/health`

## Environment Variables (26 total)

Core (Required):

- [ ] `NODE_ENV=production`
- [ ] `PORT=5001`
- [ ] `API_PREFIX=/api`
- [ ] `TMDB_API_KEY=your_key_here`
- [ ] `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64=your_base64_here`

Optional but Recommended:

- [ ] `CORS_ORIGIN=your_frontend_url`
- [ ] `TMDB_BASE_URL=https://api.themoviedb.org/3`
- [ ] `TMDB_IMAGE_BASE_URL=https://image.tmdb.org/t/p`
- [ ] `RATE_LIMIT_WINDOW_MS=60000`
- [ ] `RATE_LIMIT_MAX=120`
- [ ] `SEARCH_RATE_LIMIT_MAX=40`
- [ ] `LOG_LEVEL=info`

Optional (Advanced):

- [ ] `REDIS_URL=` (leave empty for free tier)
- [ ] `SENTRY_DSN=` (error tracking)
- [ ] `SENTRY_TRACES_SAMPLE_RATE=0.1`

## Deployment

- [ ] "Create Web Service" clicked
- [ ] Build started (check Logs tab)
- [ ] Build completed successfully (5-10 min wait)
- [ ] Deployment succeeded
- [ ] Health check turning green
- [ ] Service URL copied: `https://______________.onrender.com`

## Testing

- [ ] Health endpoint works: `/api/health` returns 200
- [ ] Status endpoint works: `/api/status`
- [ ] Test TMDB search: `/api/search?query=inception`
- [ ] Check logs for errors (should see no critical errors)
- [ ] First request took long (~30-60s) - EXPECTED on free tier
- [ ] Subsequent requests fast (<1s)

## Cron-Job.org Setup

- [ ] Account created at https://cron-job.org
- [ ] Email verified
- [ ] Cron job created:
  - Title: CineLink Backend Keepalive
  - URL: Your backend URL + `/api/health`
  - Schedule: Every 10 minutes
  - Timeout: 30 seconds
- [ ] Job saved and active
- [ ] First execution successful (wait 10-15 min)
- [ ] Email notifications enabled

## Frontend Integration

- [ ] Backend URL added to frontend config
- [ ] CORS_ORIGIN updated with frontend URL
- [ ] API client updated to use production URL
- [ ] Test login flow (Firebase auth)
- [ ] Test data fetching (movies, search)
- [ ] Test user features (favorites, watchlists)

## 24-Hour Monitoring

- [ ] Check Render logs after 1 hour
- [ ] Check cron-job executions after 2 hours
- [ ] Verify no cold starts happening
- [ ] Test app functionality multiple times
- [ ] Review any error logs
- [ ] Confirm performance is acceptable

## Optional Enhancements

- [ ] Set up Sentry for error tracking
- [ ] Configure Redis (if using paid hosting)
- [ ] Add custom domain (requires paid tier)
- [ ] Set up backup monitoring with UptimeRobot
- [ ] Document API endpoints for team
- [ ] Create Postman collection for testing

## Production Readiness (When Ready)

- [ ] Upgrade to Render Starter plan ($7/mo)
- [ ] Remove cron-job (if upgraded - not needed)
- [ ] Enable Redis caching (for better performance)
- [ ] Set up proper error tracking
- [ ] Configure rate limiting for production load
- [ ] Review security settings
- [ ] Set up automated backups (Firestore)

---

## Quick Reference

**Backend URL**: `https://________________.onrender.com`

**Health Check**: `GET /api/health`

**Status**: `GET /api/status`

**Logs**: Render Dashboard → Services → cinelink-backend → Logs

**Environment Variables**: Render Dashboard → Services → cinelink-backend → Environment

**Cron Jobs**: https://cron-job.org → My Cronjobs

---

## Common Issues & Quick Fixes

| Issue              | Quick Fix                            |
| ------------------ | ------------------------------------ |
| Build fails        | Check root directory is `backend`    |
| Health check fails | Verify Firebase Base64 is correct    |
| CORS errors        | Update CORS_ORIGIN with frontend URL |
| Slow first request | Normal on free tier - use cron-job   |
| 429 errors         | Increase rate limits in env vars     |
| Auth fails         | Re-check Firebase credentials        |

---

**Date Completed**: ******\_******

**Notes**:

```
Add any deployment-specific notes here:
-
-
-
```

**Next Review Date**: ******\_******

---

Save this file for future reference and deployments!
