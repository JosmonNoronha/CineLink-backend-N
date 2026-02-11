# Test Firebase Token Verification Warmup
# This tests if the first token verification is fast (keys already cached)

Write-Host "`n=== Testing Firebase Token Verification Speed ===" -ForegroundColor Cyan

# You'll need to replace this with a valid Firebase token from your app
# Get it by logging into the app and checking the Authorization header
$token = Read-Host "Enter a valid Firebase token (or press Enter to skip)"

if ([string]::IsNullOrWhiteSpace($token)) {
    Write-Host "`nNo token provided. To test properly:" -ForegroundColor Yellow
    Write-Host "1. Login to your CineLink app"
    Write-Host "2. Get the token from AsyncStorage or network request headers"
    Write-Host "3. Run this script again with the token"
    Write-Host "`nFor now, testing with invalid token to check error response speed..." -ForegroundColor Yellow
    $token = "invalid-token-for-speed-test"
}

$baseUrl = "http://localhost:5001/api"

# Test 1: First request (should be fast if warmup worked)
Write-Host "`n[Test 1] First token verification after server start" -ForegroundColor Green
$start = Get-Date
try {
    $response = Invoke-RestMethod -Uri "$baseUrl/favorites" `
        -Method Get `
        -Headers @{
            "Authorization" = "Bearer $token"
            "Content-Type" = "application/json"
        } `
        -ErrorAction Stop
    $end = Get-Date
    $duration = ($end - $start).TotalMilliseconds
    Write-Host "SUCCESS: Request completed in ${duration}ms" -ForegroundColor Green
    Write-Host "Response: $($response | ConvertTo-Json -Depth 2)"
} catch {
    $end = Get-Date
    $duration = ($end - $start).TotalMilliseconds
    $statusCode = $_.Exception.Response.StatusCode.Value__
    Write-Host "Response time: ${duration}ms (Status: $statusCode)" -ForegroundColor $(if ($duration -lt 2000) {"Green"} else {"Red"})
    if ($duration -lt 2000) {
        Write-Host "EXCELLENT: Token verification was fast! Warmup is working." -ForegroundColor Green
    } else {
        Write-Host "WARNING: Token verification took ${duration}ms - warmup may not be working" -ForegroundColor Red
    }
}

# Test 2: Second request (should also be fast due to cached keys)
Write-Host "`n[Test 2] Second token verification" -ForegroundColor Green
$start = Get-Date
try {
    $response = Invoke-RestMethod -Uri "$baseUrl/watchlists" `
        -Method Get `
        -Headers @{
            "Authorization" = "Bearer $token"
            "Content-Type" = "application/json"
        } `
        -ErrorAction Stop
    $end = Get-Date
    $duration = ($end - $start).TotalMilliseconds
    Write-Host "SUCCESS: Request completed in ${duration}ms" -ForegroundColor Green
} catch {
    $end = Get-Date
    $duration = ($end - $start).TotalMilliseconds
    $statusCode = $_.Exception.Response.StatusCode.Value__
    Write-Host "Response time: ${duration}ms (Status: $statusCode)" -ForegroundColor $(if ($duration -lt 500) {"Green"} else {"Yellow"})
}

Write-Host "`n=== Test Complete ===" -ForegroundColor Cyan
Write-Host "If both requests completed in under 2 seconds, warmup is working correctly!" -ForegroundColor Green
