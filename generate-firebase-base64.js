#!/usr/bin/env node

/**
 * Helper script to convert Firebase service account JSON to base64
 * 
 * Usage:
 *   node generate-firebase-base64.js path/to/serviceAccount.json
 * 
 * This will output the base64-encoded string you can use for
 * FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 in your .env file
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Usage: node generate-firebase-base64.js <path-to-service-account.json>');
  process.exit(1);
}

const filePath = args[0];
const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);

try {
  // Read the file
  const fileContent = fs.readFileSync(resolvedPath, 'utf8');
  
  // Parse to validate it's proper JSON
  const parsed = JSON.parse(fileContent);
  
  // Validate required fields
  if (!parsed.project_id) {
    throw new Error('Missing required field: project_id');
  }
  if (!parsed.client_email) {
    throw new Error('Missing required field: client_email');
  }
  if (!parsed.private_key) {
    throw new Error('Missing required field: private_key');
  }
  
  console.log('✓ Service account JSON is valid');
  console.log(`  Project ID: ${parsed.project_id}`);
  console.log(`  Client Email: ${parsed.client_email}`);
  
  // Convert to base64
  const base64 = Buffer.from(fileContent, 'utf8').toString('base64');
  
  console.log('\n✓ Successfully encoded to base64');
  console.log(`  Length: ${base64.length} characters`);
  
  console.log('\n📋 Add this to your .env file:');
  console.log('─'.repeat(80));
  console.log(`FIREBASE_SERVICE_ACCOUNT_JSON_BASE64=${base64}`);
  console.log('─'.repeat(80));
  
  // Verify it can be decoded
  const decoded = Buffer.from(base64, 'base64').toString('utf8');
  const reparsed = JSON.parse(decoded);
  
  if (JSON.stringify(parsed) === JSON.stringify(reparsed)) {
    console.log('\n✓ Verification successful - encoding/decoding works correctly');
  } else {
    console.warn('\n⚠️  Warning: Decoded content does not match original');
  }
  
} catch (e) {
  console.error(`\n❌ Error: ${e.message}`);
  process.exit(1);
}