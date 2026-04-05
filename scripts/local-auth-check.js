const fs = require('fs');

const tokenFile = 'd:/91982/Desktop/App/CineLink/temp-clear-cache-button.txt';
const base = 'http://localhost:5001/api';

function extractToken(text) {
  const bearer = text.match(/Bearer\s+([A-Za-z0-9._-]+)/);
  if (bearer) return bearer[1];

  const psVar = text.match(/\$token\s*=\s*"([A-Za-z0-9._-]+)"/);
  if (psVar) return psVar[1];

  return null;
}

async function hit(name, path, method = 'GET', body) {
  try {
    const res = await fetch(base + path, {
      method,
      headers: {
        Authorization: `Bearer ${global.token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    console.log(`${name}:${res.status}`);
    console.log(text.slice(0, 400));
  } catch (error) {
    console.log(`${name}:ERR`);
    console.log(error.message);
  }
}

(async () => {
  const envToken = process.env.FRESH_ID_TOKEN || process.env.ID_TOKEN;
  if (envToken && envToken.trim()) {
    global.token = envToken.trim();
  }

  if (!global.token && !fs.existsSync(tokenFile)) {
    console.log('NO_TOKEN_FILE');
    process.exit(0);
  }

  if (!global.token) {
    const raw = fs.readFileSync(tokenFile, 'utf8');
    const token = extractToken(raw);
    if (!token) {
      console.log('NO_TOKEN_FOUND');
      process.exit(0);
    }
    global.token = token;
  }

  await hit('PROFILE', '/user/profile');
  await hit('FAVORITES', '/user/favorites');
  await hit('WATCHLISTS', '/user/watchlists');
  await hit('WATCHED_GET', '/user/watched/tmdb:tv:1396');
  await hit('WATCHED_PATCH', '/user/watched/tmdb:tv:1396/episodes', 'PATCH', {
    season: 1,
    episode: 1,
    watched: true,
  });
})();
