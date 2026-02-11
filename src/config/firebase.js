const admin = require('firebase-admin');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Buffer } = require('buffer');
const { env } = require('./environment');
const { logger } = require('../utils/logger');

let firebaseApp;
let initializationPromise;

async function initializeFirebase() {
  // Return existing promise if initialization is in progress
  if (initializationPromise) return initializationPromise;

  // Return immediately if already initialized
  if (firebaseApp) return firebaseApp;

  initializationPromise = (async () => {
    if (admin.apps.length) {
      firebaseApp = admin.app();
      return firebaseApp;
    }

    const serviceAccount = parseServiceAccountFromEnv();
    if (serviceAccount) {
      try {
        if (serviceAccount.private_key) validatePrivateKeyPem(serviceAccount.private_key);
      } catch (e) {
        const message =
          'Firebase Admin private key is not valid PEM. ' +
          'Fix your env formatting (recommended: FIREBASE_SERVICE_ACCOUNT_JSON_BASE64), then restart the server.';
        logger.error({ message, reason: e && e.message ? e.message : String(e) });
        throw e;
      }

      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      logger.info('Firebase Admin initialized with service account');
    } else {
      // Fallback: Application Default Credentials
      firebaseApp = admin.initializeApp({
        projectId: env.FIREBASE_PROJECT_ID || undefined,
      });
      logger.info('Firebase Admin initialized with application default credentials');
    }

    // Verify Firebase is ready by testing auth
    try {
      await firebaseApp.auth().listUsers(1);
      logger.info('Firebase Admin SDK verified and ready');
    } catch (error) {
      logger.warn('Firebase verification test failed (non-critical):', error.message);
    }

    return firebaseApp;
  })();

  return initializationPromise;
}

function normalizePrivateKey(serviceAccount) {
  if (!serviceAccount || typeof serviceAccount !== 'object') return serviceAccount;

  const out = { ...serviceAccount };
  if (typeof out.private_key === 'string') {
    // Firebase Admin expects a valid PEM string with real newlines.
    // Env vars often contain escaped newlines (\n) or Windows CRLF, and some
    // copy/paste flows lose the newline after BEGIN / before END.
    let key = out.private_key;

    // Normalize escaped sequences first.
    key = key.replace(/\\r\\n/g, '\n');
    key = key.replace(/\\n/g, '\n');

    // Normalize real CRLF to LF.
    key = key.replace(/\r\n/g, '\n');
    key = key.replace(/\r/g, '\n');

    // Ensure a newline after the BEGIN header and before the END footer.
    // Works for PRIVATE KEY / RSA PRIVATE KEY, etc.
    key = key.replace(/(-----BEGIN [^-]+-----)([^\n])/g, '$1\n$2');
    key = key.replace(/([^\n])(-----END [^-]+-----)/g, '$1\n$2');

    out.private_key = key.trim();
  }
  return out;
}

function validatePrivateKeyPem(privateKey) {
  if (typeof privateKey !== 'string' || !privateKey.trim()) {
    throw new Error('Firebase private key is empty');
  }

  const trimmed = privateKey.trim();
  if (!trimmed.includes('-----BEGIN ') || !trimmed.includes(' PRIVATE KEY-----')) {
    throw new Error('Firebase private key is missing a PEM BEGIN header');
  }
  if (!trimmed.includes('-----END ') || !trimmed.includes(' PRIVATE KEY-----')) {
    throw new Error('Firebase private key is missing a PEM END footer');
  }

  // Ensure Node can parse it as a PEM private key.
  // This does not log key material.
  crypto.createPrivateKey({ key: trimmed, format: 'pem' });
}

function tryParseJson(str) {
  try {
    return JSON.parse(str);
  } catch (_e) {
    return null;
  }
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function parseServiceAccountFromEnv() {
  // Preferred (most robust) option: base64 encoded service account JSON.
  if (env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64) {
    const decoded = Buffer.from(String(env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64), 'base64').toString('utf8');
    const parsed = tryParseJson(decoded);
    if (!parsed) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 is not valid base64-encoded JSON');
    return normalizePrivateKey(parsed);
  }

  // Optional: load JSON from a file path.
  // - Useful for local dev: set FIREBASE_SERVICE_ACCOUNT_JSON_PATH to an absolute path.
  // - Useful for env var indirection: set FIREBASE_SERVICE_ACCOUNT_JSON=@./serviceAccount.json
  if (env.FIREBASE_SERVICE_ACCOUNT_JSON_PATH) {
    const p = String(env.FIREBASE_SERVICE_ACCOUNT_JSON_PATH);
    const resolved = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
    return normalizePrivateKey(readJsonFile(resolved));
  }

  // Discrete fields (dotenv-friendly).
  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    return normalizePrivateKey({
      project_id: env.FIREBASE_PROJECT_ID,
      client_email: env.FIREBASE_CLIENT_EMAIL,
      private_key: env.FIREBASE_PRIVATE_KEY,
    });
  }

  // Legacy: single JSON blob.
  // NOTE: dotenv does NOT reliably support multi-line JSON values; prefer base64 or discrete vars.
  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const raw = String(env.FIREBASE_SERVICE_ACCOUNT_JSON);

    if (raw.startsWith('@')) {
      const p = raw.slice(1).trim();
      const resolved = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
      return normalizePrivateKey(readJsonFile(resolved));
    }

    const parsed = tryParseJson(raw);
    if (!parsed) {
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON (tip: use FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY or FIREBASE_SERVICE_ACCOUNT_JSON_BASE64)'
      );
    }

    // Guard against placeholder/partial JSON: these can cause valid client tokens
    // to be rejected due to project mismatch.
    if (!parsed?.client_email || !parsed?.private_key) {
      logger.warn(
        'FIREBASE_SERVICE_ACCOUNT_JSON is present but missing client_email/private_key; ignoring it'
      );
      return null;
    }
    return normalizePrivateKey(parsed);
  }

  return null;
}

function getFirebaseApp() {
  if (firebaseApp) return firebaseApp;

  if (admin.apps.length) {
    firebaseApp = admin.app();
    return firebaseApp;
  }

  const serviceAccount = parseServiceAccountFromEnv();
  if (serviceAccount) {
    try {
      if (serviceAccount.private_key) validatePrivateKeyPem(serviceAccount.private_key);
    } catch (e) {
      const message =
        'Firebase Admin private key is not valid PEM. ' +
        'Fix your env formatting (recommended: FIREBASE_SERVICE_ACCOUNT_JSON_BASE64), then restart the server.';
      logger.error({ message, reason: e && e.message ? e.message : String(e) });
      throw e;
    }

    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    logger.info('Firebase Admin initialized with service account');
    return firebaseApp;
  }

  // Fallback: Application Default Credentials
  firebaseApp = admin.initializeApp({
    projectId: env.FIREBASE_PROJECT_ID || undefined,
  });
  logger.info('Firebase Admin initialized with application default credentials');
  return firebaseApp;
}

function getAuth() {
  return getFirebaseApp().auth();
}

function getFirestore() {
  return getFirebaseApp().firestore();
}

/**
 * Warms up JWT verification by triggering public key download.
 * This prevents cold start delays on first token verification.
 * The Firebase Admin SDK downloads Google's public keys on first verifyIdToken() call.
 */
async function warmupJwtVerification() {
  const startTime = Date.now();
  try {
    const auth = getAuth();

    // Create a properly formatted Firebase ID token structure with invalid signature
    // This will pass format checks and trigger key download, but fail signature verification
    // Format: header.payload.signature (all base64url encoded)

    // Extract project ID from service account or environment
    let projectId = env.FIREBASE_PROJECT_ID;
    if (!projectId) {
      const serviceAccount = parseServiceAccountFromEnv();
      projectId = serviceAccount?.project_id || 'cinelink-7343e'; // fallback to known project ID
    }

    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'dummy' })).toString(
      'base64url'
    );
    const payload = Buffer.from(
      JSON.stringify({
        iss: `https://securetoken.google.com/${projectId}`,
        aud: projectId,
        auth_time: Math.floor(Date.now() / 1000),
        user_id: 'warmup-dummy-user',
        sub: 'warmup-dummy-user',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ).toString('base64url');
    const signature = 'invalid-signature-to-trigger-key-download';
    const dummyToken = `${header}.${payload}.${signature}`;

    try {
      await auth.verifyIdToken(dummyToken);
      // If this succeeds, something unexpected happened
      logger.warn('JWT warmup: Dummy token was unexpectedly accepted');
      return true;
    } catch (error) {
      // Expected to fail - we just want to trigger key download
      const duration = Date.now() - startTime;

      if (
        error.code === 'auth/argument-error' &&
        error.message.includes('Decoding Firebase ID token failed')
      ) {
        // Token format was invalid before key download
        logger.warn(`JWT warmup failed to trigger key download (invalid format) in ${duration}ms`);
        return false;
      } else if (error.message && error.message.includes('invalid signature')) {
        // Success! Keys were fetched and signature verification failed (as expected)
        logger.info(`Firebase JWT verification warmed up in ${duration}ms`);
        return true;
      } else if (
        error.message &&
        (error.message.includes('expired') || error.message.includes('Token expired'))
      ) {
        // Also success - token was validated (keys downloaded)
        logger.info(`Firebase JWT verification warmed up in ${duration}ms`);
        return true;
      } else {
        // Some other error - log it but don't fail startup
        logger.warn(
          `JWT warmup encountered error (${error.code || 'unknown'}): ${error.message} [${duration}ms]`
        );
        return false;
      }
    }
  } catch (error) {
    logger.error('JWT warmup failed:', error);
    return false;
  }
}

/**
 * Warms up Firestore connection by performing a simple read operation.
 * This prevents cold start delays on first Firestore query.
 */
async function warmupFirestore() {
  const startTime = Date.now();
  try {
    const firestore = getFirestore();

    // Perform a simple query to establish connection
    // Using a non-existent document to avoid side effects
    const dummyRef = firestore.collection('_warmup').doc('_connection_test');
    await dummyRef.get();

    const duration = Date.now() - startTime;
    logger.info(`Firestore connection warmed up in ${duration}ms`);
    return true;
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.warn(`Firestore warmup encountered error: ${error.message} [${duration}ms]`);
    return false;
  }
}

module.exports = {
  initializeFirebase,
  getFirebaseApp,
  getAuth,
  getFirestore,
  warmupJwtVerification,
  warmupFirestore,
};
