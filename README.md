# CineLink Backend

Express backend for CineLink.

## Features

- Firebase Auth (ID token verification via Firebase Admin)
- Firestore user data (profile, favorites, watchlists)
- TMDB proxy endpoints with optional Redis caching
- Rate limiting, CORS, Helmet, compression

## Local setup

1. `cd backend`
2. `npm install`
3. Copy `.env.example` to `.env` and fill values
4. `npm run dev`

## Firebase Admin credentials

This backend verifies Firebase ID tokens using Firebase Admin. For local dev and production, prefer dotenv-safe formats.

Supported options (pick one):

- `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64`: Base64 of the full service account JSON (recommended for CI/Render env vars).
- `FIREBASE_SERVICE_ACCOUNT_JSON_PATH`: Path to a service account JSON file (recommended for local dev).
- `FIREBASE_PROJECT_ID` + `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`: Discrete env vars (private key should use `\\n` sequences).
- `FIREBASE_SERVICE_ACCOUNT_JSON`: Single-line JSON only (multi-line JSON blocks will NOT parse correctly via dotenv).

## Auth

Send Firebase ID token:
`Authorization: Bearer <id-token>`

## API boundaries

- `/api/user/*` requires Firebase auth and is the protected user-data surface.
- `/api/analytics/*` uses optional auth; the endpoints return aggregate data and do not require a token.
- `/api/recommendations` stays public because it is content-based, not user-scoped.
- `/api/metrics` is protected by a separate production-only metrics secret.
- Legacy watchlist routes under `/api/user/watchlists/:name/movies/*` remain supported for compatibility, but `/api/user/watchlists/:name/items/*` is the canonical TMDB-based path.

## Health

`GET /api/health`
