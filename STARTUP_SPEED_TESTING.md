# Startup Speed Testing Guide

## Quick Test (Recommended)

```powershell
cd backend
.\test-startup-quick.ps1
```

**What it does:**

- Runs 5 parallel API calls (favorites + watchlists)
- Shows average, best, and worst times
- Provides instant performance rating

**Example output:**

```
Test 1/5... 523ms
Test 2/5... 156ms
Test 3/5... 142ms
Test 4/5... 138ms
Test 5/5... 145ms

--- Results ---
Average: 221ms
Best:    138ms
Worst:   523ms

--- Rating ---
EXCELLENT - Instant startup!
```

---

## Comprehensive Test

```powershell
cd backend
.\test-startup-speed.ps1 -Runs 3
```

**What it does:**

- Simulates real app startup with parallel calls
- Runs multiple times for accuracy
- Calculates detailed statistics
- Exports results to JSON

**With valid token:**

```powershell
.\test-startup-speed.ps1 -Token "your-firebase-token" -Runs 5
```

---

## Before/After Comparison Workflow

### Step 1: Baseline Test (Before Optimization)

```powershell
# Make sure backend is running WITHOUT optimizations
cd backend
npm run dev

# In another terminal
cd backend
.\test-startup-quick.ps1
```

**Save the average time.** Example: `21,234ms`

### Step 2: Apply Optimizations

1. **Firebase JWT Warmup** - Already implemented ✅
2. **Deduplication** - Already implemented ✅

### Step 3: After Test

```powershell
# Restart backend to test cold start
# Stop current backend (Ctrl+C)
npm run dev

# Wait for warmup message in logs:
# "🔥 Firebase JWT verification warmed up in XXXms"

# In another terminal
cd backend
.\test-startup-quick.ps1
```

**Save the new average time.** Example: `412ms`

### Step 4: Calculate Improvement

```
Improvement = (Before - After) / Before * 100%

Example:
(21234 - 412) / 21234 * 100% = 98.1% faster! 🚀
```

---

## Understanding the Results

### Timing Breakdown

**Expected times on cold start (first request after backend restart):**

- **Without optimization:** 15,000 - 25,000ms (15-25 seconds)
- **With Firebase warmup:** 500 - 2,000ms (0.5-2 seconds)
- **With warmup + deduplication:** 200 - 800ms (0.2-0.8 seconds)

**Expected times on warm start (subsequent requests):**

- **Any configuration:** 50 - 300ms (instant)

### Performance Ratings

| Average Time | Rating        | User Experience              |
| ------------ | ------------- | ---------------------------- |
| < 500ms      | EXCELLENT ✅  | Instant, imperceptible       |
| 500-1000ms   | GOOD ✅       | Fast, barely noticeable      |
| 1000-2000ms  | ACCEPTABLE ⚠️ | Noticeable but tolerable     |
| 2000-5000ms  | SLOW ❌       | Frustrating delay            |
| > 5000ms     | VERY SLOW ❌  | Poor UX, users may close app |

### What Affects Speed

1. **First call after backend restart:**
   - Downloads Firebase public keys (5-20 seconds without warmup)
   - Warmup reduces this to milliseconds

2. **Number of parallel calls:**
   - Before: 4 calls (2 favorites + 2 watchlists)
   - After: 2 calls (1 favorites + 1 watchlists)
   - 50% reduction in token verifications

3. **Network latency:**
   - Your location to backend server
   - Your location to Google's Firebase servers
   - DNS resolution time

4. **Database queries:**
   - Firestore read performance
   - Number of documents to fetch
   - Index optimization

---

## Interpreting Backend Logs

During tests, watch backend logs for these messages:

### Good Signs ✅

```
Firebase JWT verification warmed up in 500ms
Token verified for uid: [...] in 50 ms
Token verified for uid: [...] in 120 ms
```

### Warning Signs ⚠️

```
Firebase JWT verification warmed up in 5ms
# ↑ Too fast! Keys not actually downloaded

Token verified for uid: [...] in 21840 ms
# ↑ Very slow! Warmup didn't work
```

### What to Look For

**Cold start (first request):**

```
Firebase Admin initialized
🔥 Firebase JWT verification warmed up in 5000-20000ms  ← Key download
Redis initialized
CineLink backend listening on :5001

# First app request:
🔐 Token verified for uid: [...] in 50-200 ms  ← Fast! Keys cached
```

**Subsequent requests:**

```
🔐 Token verified from cache for uid: [...] in 10-50 ms
```

---

## Troubleshooting

### "Backend is not running" error

```powershell
cd backend
npm run dev
```

### High timing variance (e.g., 100ms, 15000ms, 100ms)

This means warmup isn't working consistently. Check:

1. Backend logs show warmup message
2. Warmup time is 5-20 seconds (not milliseconds)
3. Subsequent calls are fast (<200ms)

### All calls are slow (>5000ms every time)

Possible issues:

1. Firebase warmup not enabled
2. Network issues
3. Backend not optimized
4. Database queries slow

### Token errors (401 Unauthorized)

This is expected with test token. Timing is still accurate.

For real auth test:

1. Login to app
2. Get token from AsyncStorage or network inspector
3. Run: `.\test-startup-speed.ps1 -Token "your-actual-token"`

---

## Real-World Example

### Before Optimization

```
Run 1: 21,456ms
Run 2: 156ms      # Fast because keys cached from Run 1
Run 3: 142ms
Average: 7,251ms  # Skewed by slow first run
```

**Problem:** First app startup takes 21+ seconds

### After Firebase Warmup

```
Run 1: 508ms      # Keys pre-downloaded during server startup
Run 2: 145ms
Run 3: 139ms
Average: 264ms
```

**Improvement:** 96.4% faster! (21,456ms → 508ms on first run)

### After Warmup + Deduplication

```
Run 1: 412ms      # Keys cached + fewer calls
Run 2: 128ms
Run 3: 121ms
Average: 220ms
```

**Total improvement:** 98.1% faster! (21,456ms → 412ms)

---

## Continuous Monitoring

### Regular Testing Schedule

**After code changes:**

```powershell
.\test-startup-quick.ps1
```

**Before production deployment:**

```powershell
.\test-startup-speed.ps1 -Runs 10
```

**Performance regression check:**
Compare JSON exports from different versions:

```powershell
# Current version
.\test-startup-speed.ps1 -Runs 5
# Creates: startup-speed-test-20260209_143022.json

# Compare with previous baseline
# If average increased significantly, investigate
```

### Set Performance Budgets

**Target:** Average < 500ms  
**Acceptable:** Average < 1000ms  
**Investigate if:** Average > 2000ms  
**Critical if:** Average > 5000ms

---

## Additional Tests

### Test individual endpoints:

```powershell
# Measure-Command { Invoke-RestMethod -Uri "http://localhost:5001/api/favorites" -Headers @{"Authorization"="Bearer token"} }
```

### Test TMDB API calls:

```powershell
# Measure-Command { Invoke-RestMethod -Uri "http://localhost:5001/api/tmdb/trending/all/week" }
```

### Test with network throttling:

Use browser DevTools or Charles Proxy to simulate slow 3G/4G and measure impact.

---

## Summary

**Quick 30-second test:**

```powershell
.\test-startup-quick.ps1
```

**Comprehensive comparison:**

1. Test before optimization
2. Apply fixes (warmup + deduplication)
3. Restart backend
4. Test after optimization
5. Calculate improvement percentage

**Goal:** Achieve <500ms average startup time for excellent user experience.
