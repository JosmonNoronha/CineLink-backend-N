# Watch Providers Backend Testing Guide

## ✅ Backend Implementation Status

All backend code is properly implemented and lint-checked:

### Services Added:
- ✅ `backend/src/services/tmdb/movies.js` - Added `watchProviders()` function
- ✅ `backend/src/services/tmdb/tv.js` - Added `watchProviders()` function
- ✅ `backend/src/services/user/profile.js` - Added `getSubscriptions()` and `updateSubscriptions()`

### Routes Added:
- ✅ `GET /api/movies/:id/watch-providers` - Get movie streaming availability
- ✅ `GET /api/tv/:id/watch-providers` - Get TV show streaming availability
- ✅ `GET /api/user/subscriptions` - Get user's streaming subscriptions
- ✅ `PUT /api/user/subscriptions` - Update user's streaming subscriptions

## 🧪 How to Test

### 1. Start the Backend Server

```bash
cd backend
npm run dev
```

The server should start on `http://localhost:5001`

### 2. Test Watch Providers Endpoints

Once the server is running, run the test script:

```bash
node test-watch-providers.js
```

Or manually test with curl:

#### Test Movie Watch Providers (Fight Club - ID: 550)
```bash
curl http://localhost:5001/api/movies/550/watch-providers
```

Expected response format:
```json
{
  "success": true,
  "data": {
    "id": 550,
    "results": {
      "US": {
        "link": "https://www.themoviedb.org/movie/550-fight-club/watch?locale=US",
        "flatrate": [
          {
            "display_priority": 9,
            "logo_path": "/path/to/logo.jpg",
            "provider_id": 8,
            "provider_name": "Netflix"
          }
        ],
        "rent": [...],
        "buy": [...]
      }
    }
  }
}
```

#### Test TV Watch Providers (Breaking Bad - ID: 1396)
```bash
curl http://localhost:5001/api/tv/1396/watch-providers
```

#### Test User Subscriptions (requires auth token)
```bash
# Get subscriptions
curl http://localhost:5001/api/user/subscriptions \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN"

# Update subscriptions
curl -X PUT http://localhost:5001/api/user/subscriptions \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"subscriptions": [8, 337, 384]}'
```

### 3. Test from Frontend

1. Start the backend: `cd backend && npm run dev`
2. Start the frontend: `cd .. && npx expo start`
3. Navigate to any movie/TV show details screen
4. You should see the "Where to Watch" section
5. Go to Settings → Streaming Services to select your subscriptions

## 📊 What The Backend Returns

### Movie/TV Watch Providers Response:
```json
{
  "success": true,
  "data": {
    "id": 550,
    "results": {
      "US": {
        "link": "https://...",
        "flatrate": [
          {
            "provider_id": 8,
            "provider_name": "Netflix",
            "logo_path": "/9A1JSVmSxsyaBK4SUFsYVqbAYfW.jpg"
          }
        ],
        "rent": [...],
        "buy": [...]
      },
      "GB": {...},
      "CA": {...}
    }
  }
}
```

### User Subscriptions Response:
```json
{
  "success": true,
  "subscriptions": [8, 337, 384]
}
```

Where the numbers are provider IDs:
- 8 = Netflix
- 337 = Disney Plus
- 384 = HBO Max
- 9 = Amazon Prime Video
- etc.

## 🔍 Troubleshooting

### Backend won't start?
Check for:
- Port 5001 already in use
- Missing `.env` file with `TMDB_API_KEY`
- Node version compatibility (needs Node 20+)

### Endpoints return errors?
- Verify TMDB API key is valid
- Check Firebase admin credentials are configured
- Ensure Redis is running (or cache is properly configured)

### Frontend not showing data?
- Check browser/app console for API errors
- Verify API_BASE_URL in frontend `.env`
- Ensure user is signed in for subscription features

## 📝 Provider IDs Reference

Popular streaming services:
- 8: Netflix
- 9: Amazon Prime Video
- 337: Disney Plus
- 384: HBO Max
- 15: Hulu
- 350: Apple TV Plus
- 531: Paramount Plus
- 29: Peacock

## ✨ Expected Behavior

1. **First Request**: Fetches from TMDB API (~200-500ms)
2. **Cached Requests**: Returns from cache (~5-10ms)
3. **Cache Duration**: 24 hours for watch providers
4. **User Subscriptions**: Stored in Firebase Firestore
5. **Frontend**: Auto-highlights available services with green borders
