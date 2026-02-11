const dotenv = require('dotenv');
const crypto = require('crypto');

dotenv.config();

console.log('\n=== Firebase Configuration Diagnosis ===\n');

// Check which env vars are set
const checks = {
  'FIREBASE_SERVICE_ACCOUNT_JSON_BASE64': !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64,
  'FIREBASE_SERVICE_ACCOUNT_JSON_PATH': !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON_PATH,
  'FIREBASE_SERVICE_ACCOUNT_JSON': !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
  'FIREBASE_PROJECT_ID': !!process.env.FIREBASE_PROJECT_ID,
  'FIREBASE_CLIENT_EMAIL': !!process.env.FIREBASE_CLIENT_EMAIL,
  'FIREBASE_PRIVATE_KEY': !!process.env.FIREBASE_PRIVATE_KEY,
};

console.log('Environment variables present:');
Object.entries(checks).forEach(([key, present]) => {
  console.log(`  ${key}: ${present ? '✓ SET' : '✗ NOT SET'}`);
});

// Try to parse and validate the private key
function testPrivateKey(label, privateKey) {
  console.log(`\n--- Testing: ${label} ---`);
  
  if (!privateKey) {
    console.log('❌ Private key is empty or undefined');
    return false;
  }

  console.log(`Length: ${privateKey.length} characters`);
  console.log(`First 50 chars: ${privateKey.substring(0, 50)}...`);
  console.log(`Last 50 chars: ...${privateKey.substring(privateKey.length - 50)}`);
  
  // Check for common issues
  const issues = [];
  
  if (!privateKey.includes('-----BEGIN')) {
    issues.push('Missing BEGIN header');
  }
  if (!privateKey.includes('-----END')) {
    issues.push('Missing END footer');
  }
  if (!privateKey.includes('PRIVATE KEY-----')) {
    issues.push('Malformed header/footer');
  }
  
  // Count actual newlines vs escaped newlines
  const realNewlines = (privateKey.match(/\n/g) || []).length;
  const escapedNewlines = (privateKey.match(/\\n/g) || []).length;
  console.log(`Real newlines (\\n): ${realNewlines}`);
  console.log(`Escaped newlines (\\\\n): ${escapedNewlines}`);
  
  if (escapedNewlines > 0) {
    issues.push(`Contains ${escapedNewlines} escaped \\\\n sequences (should be real newlines)`);
  }
  
  if (issues.length > 0) {
    console.log('\n⚠️  Issues found:');
    issues.forEach(issue => console.log(`  - ${issue}`));
  }
  
  // Try to parse with Node's crypto
  try {
    crypto.createPrivateKey({ key: privateKey, format: 'pem' });
    console.log('✓ Successfully validated as PEM private key');
    return true;
  } catch (e) {
    console.log(`❌ Validation failed: ${e.message}`);
    return false;
  }
}

// Test based on which option is being used
if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64) {
  console.log('\n📋 Using: FIREBASE_SERVICE_ACCOUNT_JSON_BASE64');
  try {
    const decoded = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    testPrivateKey('Decoded from base64', parsed.private_key);
  } catch (e) {
    console.log(`❌ Failed to decode: ${e.message}`);
  }
} else if (process.env.FIREBASE_PRIVATE_KEY) {
  console.log('\n📋 Using: Discrete fields (FIREBASE_PRIVATE_KEY)');
  testPrivateKey('Direct from env var', process.env.FIREBASE_PRIVATE_KEY);
} else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  console.log('\n📋 Using: FIREBASE_SERVICE_ACCOUNT_JSON');
  try {
    const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    testPrivateKey('From JSON blob', parsed.private_key);
  } catch (e) {
    console.log(`❌ Failed to parse JSON: ${e.message}`);
  }
} else {
  console.log('\n❌ No Firebase configuration found!');
}

console.log('\n=== End Diagnosis ===\n');