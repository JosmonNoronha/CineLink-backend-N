# 🔑 Firebase Base64 Conversion - Quick Guide

## Why Base64?

Render (and most hosting platforms) require environment variables to be single-line strings. Firebase service account JSON files are multi-line and contain special characters that break environment variables. Base64 encoding solves this.

---

## Method 1: PowerShell (Windows) - RECOMMENDED

### Step 1: Download Firebase JSON

1. Go to https://console.firebase.google.com
2. Select your project
3. ⚙️ Settings → Project Settings
4. Service Accounts tab
5. **Generate New Private Key**
6. Save file (e.g., `cinelink-firebase-key.json`)

### Step 2: Convert to Base64

Open PowerShell and run:

```powershell
# Navigate to the folder with your JSON file
cd "C:\Users\YourName\Downloads"

# Replace with your actual filename
$jsonFile = "cinelink-firebase-key.json"

# Read and convert
$json = Get-Content $jsonFile -Raw
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
$base64 = [Convert]::ToBase64String($bytes)

# Copy to clipboard
$base64 | Set-Clipboard

# Also display it
Write-Host "✅ Base64 string copied to clipboard!"
Write-Host ""
Write-Host "Preview (first 100 chars):"
Write-Host $base64.Substring(0, 100)
Write-Host "..."
Write-Host ""
Write-Host "Length: $($base64.Length) characters"
```

### Step 3: Paste into Render

1. Go to Render environment variables
2. Add new variable:
   - Name: `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64`
   - Value: Paste from clipboard (Ctrl+V)
3. Save

---

## Method 2: Online Tool (Quick but Less Secure)

⚠️ **Use only if you trust the tool and are in development**

### Option A: Base64Encode.org

1. Go to https://www.base64encode.org/
2. Open your Firebase JSON in notepad
3. Copy entire content
4. Paste into the tool
5. Click "Encode"
6. Copy result

### Option B: Base64Decode.org

1. Go to https://www.base64decode.org/
2. Same process as above
3. Use the encode function

---

## Method 3: Node.js Script (Cross-Platform)

Create a file `convert-firebase-json.js`:

```javascript
const fs = require('fs');

// Usage: node convert-firebase-json.js path/to/firebase-key.json

const filePath = process.argv[2];

if (!filePath) {
  console.error('Usage: node convert-firebase-json.js <path-to-firebase-json>');
  process.exit(1);
}

try {
  const json = fs.readFileSync(filePath, 'utf8');
  const base64 = Buffer.from(json).toString('base64');

  console.log('✅ Base64 Conversion Successful!\n');
  console.log('Copy this value to Render environment variable:');
  console.log('Variable name: FIREBASE_SERVICE_ACCOUNT_JSON_BASE64\n');
  console.log('Value:');
  console.log(base64);
  console.log('\n---');
  console.log(`Length: ${base64.length} characters`);
  console.log(`Preview: ${base64.substring(0, 100)}...`);
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
```

Run it:

```bash
node convert-firebase-json.js cinelink-firebase-key.json
```

---

## Method 4: WSL/Linux/Mac (Terminal)

```bash
base64 -w 0 cinelink-firebase-key.json | pbcopy  # Mac (copies to clipboard)
base64 -w 0 cinelink-firebase-key.json | xclip    # Linux (requires xclip)
base64 -w 0 cinelink-firebase-key.json            # Just output
```

---

## Verify Your Base64 String

### It Should:

- ✅ Be a single long line (no line breaks)
- ✅ Start with something like: `eyJ0eXBlIjoic2VydmljZV9hY2NvdW50...`
- ✅ Be 1000-3000 characters long
- ✅ Only contain: A-Z, a-z, 0-9, +, /, = (Base64 alphabet)

### It Should NOT:

- ❌ Have line breaks or newlines
- ❌ Have curly braces { } (that's the raw JSON)
- ❌ Be less than 500 characters (too short)
- ❌ Have quotes around it

---

## Decode Back (To Verify)

### PowerShell:

```powershell
$base64 = "paste_your_base64_here"
$bytes = [Convert]::FromBase64String($base64)
$json = [System.Text.Encoding]::UTF8.GetString($bytes)
$json | ConvertFrom-Json | ConvertTo-Json -Depth 10
```

### Node.js:

```javascript
const base64 = 'paste_your_base64_here';
const json = Buffer.from(base64, 'base64').toString('utf8');
console.log(JSON.parse(json));
```

---

## Security Best Practices

1. **Never commit the Base64 string to Git**
   - It's just as sensitive as the original JSON
   - Always use environment variables

2. **Delete the JSON file securely after converting**

   ```powershell
   # Windows - Secure delete
   Remove-Item -Path "cinelink-firebase-key.json" -Force
   ```

3. **Rotate keys periodically**
   - Generate new service account every 6-12 months
   - Revoke old keys in Firebase console

4. **Use different keys for different environments**
   - Development: One service account
   - Production: Separate service account
   - Better security isolation

---

## Troubleshooting

### "Invalid argument" error in PowerShell

**Cause**: Special characters in JSON breaking the command

**Fix**: Wrap in single quotes:

```powershell
$json = Get-Content 'cinelink-firebase-key.json' -Raw
```

### "File not found" error

**Cause**: Wrong path or filename

**Fix**: Use full path:

```powershell
$json = Get-Content "C:\Users\YourName\Downloads\cinelink-firebase-key.json" -Raw
```

### Base64 string doesn't work in Render

**Cause**: Line breaks or extra spaces

**Fix**: Ensure it's one continuous line with no spaces at start/end

### "Cannot convert" error

**Cause**: File not in UTF-8 encoding

**Fix**: Re-save the JSON file as UTF-8 in notepad

---

## Quick Copy-Paste Commands

### For PowerShell (All-in-One):

```powershell
$json = Get-Content "cinelink-firebase-key.json" -Raw; $bytes = [System.Text.Encoding]::UTF8.GetBytes($json); $base64 = [Convert]::ToBase64String($bytes); $base64 | Set-Clipboard; Write-Host "✅ Copied to clipboard! Length: $($base64.Length)"
```

### For Node.js (All-in-One):

```bash
node -e "console.log(Buffer.from(require('fs').readFileSync('cinelink-firebase-key.json')).toString('base64'))" | clip
```

---

## Reference

**Original JSON format** (multi-line):

```json
{
  "type": "service_account",
  "project_id": "your-project",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com"
}
```

**After Base64** (single line):

```
eyJ0eXBlIjoic2VydmljZV9hY2NvdW50IiwicHJvamVjdF9pZCI6InlvdXItcHJvamVjdCIsInByaXZhdGVfa2V5X2lkIjoiLi4uIiwicHJpdmF0ZV9rZXkiOiItLS0tLUJFR0lOIFBSSVZBVEUgS0VZLS0tLS1cbi4uLlxuLS0tLS1FTkQgUFJJVkFURSBLRVktLS0tLVxuIiwiY2xpZW50X2VtYWlsIjoiZmlyZWJhc2UtYWRtaW5zZGstd...
```

---

**Last Updated**: February 11, 2026
