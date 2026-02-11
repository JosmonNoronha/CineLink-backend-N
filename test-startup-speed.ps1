# App Startup Speed Test
# Simulates the API calls made when the CineLink app starts up
# Measures timing to compare before/after optimization

param(
    [string]$Token = "",
    [int]$Runs = 3
)

Write-Host "`n================================================" -ForegroundColor Cyan
Write-Host "   CineLink App Startup Speed Test" -ForegroundColor Cyan
Write-Host "================================================`n" -ForegroundColor Cyan

$baseUrl = "http://localhost:5001/api"

# Get token from user if not provided
if ([string]::IsNullOrWhiteSpace($Token)) {
    Write-Host "To test accurately, you need a valid Firebase token from the app." -ForegroundColor Yellow
    Write-Host "Steps to get token:" -ForegroundColor Yellow
    Write-Host "1. Login to CineLink app" -ForegroundColor Yellow
    Write-Host "2. Check AsyncStorage for 'userToken' or inspect network request headers" -ForegroundColor Yellow
    Write-Host "3. Copy the token and paste it here`n" -ForegroundColor Yellow
    
    $Token = Read-Host "Enter Firebase token (or press Enter to use test token)"
    
    if ([string]::IsNullOrWhiteSpace($Token)) {
        $Token = "test-invalid-token-for-timing-only"
        Write-Host "`nUsing test token - you'll see 401 errors, but timing is still valid`n" -ForegroundColor Yellow
    }
}

$headers = @{
    "Authorization" = "Bearer $Token"
    "Content-Type" = "application/json"
}

Write-Host "Configuration:" -ForegroundColor Green
Write-Host "  Base URL: $baseUrl"
Write-Host "  Test Runs: $Runs"
Write-Host "  Token: $($Token.Substring(0, [Math]::Min(20, $Token.Length)))...`n"

# Check if backend is running
Write-Host "Checking backend status..." -ForegroundColor Yellow
try {
    $healthCheck = Invoke-RestMethod -Uri "$baseUrl/health" -Method Get -TimeoutSec 3
    Write-Host "Backend is running: v$($healthCheck.version)`n" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Backend is not running!" -ForegroundColor Red
    Write-Host "Start the backend first: cd backend && npm run dev`n" -ForegroundColor Red
    exit 1
}

# Function to make a timed API call
function Measure-ApiCall {
    param(
        [string]$Name,
        [string]$Endpoint,
        [string]$Method = "Get",
        [hashtable]$Headers
    )
    
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $success = $false
    $status = "N/A"
    
    try {
        $response = Invoke-RestMethod -Uri "$baseUrl$Endpoint" `
            -Method $Method `
            -Headers $Headers `
            -ErrorAction Stop
        $success = $true
        $status = "200 OK"
    } catch {
        $status = "$($_.Exception.Response.StatusCode.Value__)"
        if ($status -eq "401") {
            # 401 is expected with invalid token, still measures timing
            $success = $true
        }
    }
    
    $stopwatch.Stop()
    $duration = $stopwatch.ElapsedMilliseconds
    
    return @{
        Name = $Name
        Duration = $duration
        Success = $success
        Status = $status
    }
}

# Store results across runs
$allResults = @()

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Starting Speed Tests ($Runs runs)..." -ForegroundColor Cyan
Write-Host "================================================`n" -ForegroundColor Cyan

for ($run = 1; $run -le $Runs; $run++) {
    Write-Host "Run #$run of $Runs" -ForegroundColor Magenta
    Write-Host "----------------------------------------" -ForegroundColor Magenta
    
    $runResults = @{
        Run = $run
        Calls = @()
        TotalTime = 0
        StartTime = Get-Date
    }
    
    # Simulate app startup: Favorites + Watchlists called in parallel
    Write-Host "Simulating parallel API calls (like app startup)..." -ForegroundColor Yellow
    
    $parallelStart = [System.Diagnostics.Stopwatch]::StartNew()
    
    # Create background jobs for parallel execution
    $favoritesJob = Start-Job -ScriptBlock {
        param($url, $hdrs)
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        try {
            $result = Invoke-RestMethod -Uri "$url/favorites" -Method Get -Headers $hdrs -ErrorAction Stop
            $sw.Stop()
            return @{ Success = $true; Duration = $sw.ElapsedMilliseconds; Status = "200" }
        } catch {
            $sw.Stop()
            return @{ Success = $false; Duration = $sw.ElapsedMilliseconds; Status = $_.Exception.Response.StatusCode.Value__ }
        }
    } -ArgumentList $baseUrl, $headers
    
    $watchlistsJob = Start-Job -ScriptBlock {
        param($url, $hdrs)
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        try {
            $result = Invoke-RestMethod -Uri "$url/watchlists" -Method Get -Headers $hdrs -ErrorAction Stop
            $sw.Stop()
            return @{ Success = $true; Duration = $sw.ElapsedMilliseconds; Status = "200" }
        } catch {
            $sw.Stop()
            return @{ Success = $false; Duration = $sw.ElapsedMilliseconds; Status = $_.Exception.Response.StatusCode.Value__ }
        }
    } -ArgumentList $baseUrl, $headers
    
    # Wait for both to complete
    $favResult = Wait-Job $favoritesJob | Receive-Job
    $watchResult = Wait-Job $watchlistsJob | Receive-Job
    
    Remove-Job $favoritesJob, $watchlistsJob
    
    $parallelStart.Stop()
    $parallelTotal = $parallelStart.ElapsedMilliseconds
    
    # Record results
    $favCall = @{
        Name = "GET /favorites"
        Duration = $favResult.Duration
        Success = $favResult.Success
        Status = $favResult.Status
    }
    
    $watchCall = @{
        Name = "GET /watchlists"
        Duration = $watchResult.Duration
        Success = $watchResult.Success
        Status = $watchResult.Status
    }
    
    $runResults.Calls += $favCall
    $runResults.Calls += $watchCall
    $runResults.TotalTime = $parallelTotal
    
    # Display results
    Write-Host ""
    Write-Host "  GET /favorites   : $($favCall.Duration)ms [$($favCall.Status)]" -ForegroundColor $(if($favCall.Duration -lt 500){"Green"}elseif($favCall.Duration -lt 2000){"Yellow"}else{"Red"})
    Write-Host "  GET /watchlists  : $($watchCall.Duration)ms [$($watchCall.Status)]" -ForegroundColor $(if($watchCall.Duration -lt 500){"Green"}elseif($watchCall.Duration -lt 2000){"Yellow"}else{"Red"})
    Write-Host ""
    Write-Host "  Parallel Total   : $parallelTotal ms" -ForegroundColor $(if($parallelTotal -lt 1000){"Green"}elseif($parallelTotal -lt 3000){"Yellow"}else{"Red"})
    Write-Host "  Max Single Call  : $([Math]::Max($favCall.Duration, $watchCall.Duration)) ms" -ForegroundColor Cyan
    Write-Host ""
    
    $allResults += $runResults
    
    # Wait before next run (except on last run)
    if ($run -lt $Runs) {
        Write-Host "Waiting 2 seconds before next run...`n" -ForegroundColor Gray
        Start-Sleep -Seconds 2
    }
}

# Calculate statistics
Write-Host "`n================================================" -ForegroundColor Cyan
Write-Host "   Results Summary" -ForegroundColor Cyan
Write-Host "================================================`n" -ForegroundColor Cyan

$favoriteTimes = $allResults.Calls | Where-Object { $_.Name -eq "GET /favorites" } | Select-Object -ExpandProperty Duration
$watchlistTimes = $allResults.Calls | Where-Object { $_.Name -eq "GET /watchlists" } | Select-Object -ExpandProperty Duration
$parallelTimes = $allResults | Select-Object -ExpandProperty TotalTime

$favAvg = ($favoriteTimes | Measure-Object -Average).Average
$favMin = ($favoriteTimes | Measure-Object -Minimum).Minimum
$favMax = ($favoriteTimes | Measure-Object -Maximum).Maximum

$watchAvg = ($watchlistTimes | Measure-Object -Average).Average
$watchMin = ($watchlistTimes | Measure-Object -Minimum).Minimum
$watchMax = ($watchlistTimes | Measure-Object -Maximum).Maximum

$parallelAvg = ($parallelTimes | Measure-Object -Average).Average
$parallelMin = ($parallelTimes | Measure-Object -Minimum).Minimum
$parallelMax = ($parallelTimes | Measure-Object -Maximum).Maximum

Write-Host "GET /favorites:" -ForegroundColor Green
Write-Host "  Average: $([Math]::Round($favAvg, 0)) ms"
Write-Host "  Min:     $favMin ms"
Write-Host "  Max:     $favMax ms"
Write-Host ""

Write-Host "GET /watchlists:" -ForegroundColor Green
Write-Host "  Average: $([Math]::Round($watchAvg, 0)) ms"
Write-Host "  Min:     $watchMin ms"
Write-Host "  Max:     $watchMax ms"
Write-Host ""

Write-Host "Parallel Execution (Real App Startup):" -ForegroundColor Cyan
Write-Host "  Average: $([Math]::Round($parallelAvg, 0)) ms" -ForegroundColor $(if($parallelAvg -lt 1000){"Green"}elseif($parallelAvg -lt 3000){"Yellow"}else{"Red"})
Write-Host "  Min:     $parallelMin ms"
Write-Host "  Max:     $parallelMax ms"
Write-Host ""

# Performance rating
$rating = if ($parallelAvg -lt 500) {
    "EXCELLENT"
} elseif ($parallelAvg -lt 1000) {
    "GOOD"
} elseif ($parallelAvg -lt 2000) {
    "ACCEPTABLE"
} elseif ($parallelAvg -lt 5000) {
    "SLOW"
} else {
    "VERY SLOW"
}

$ratingColor = switch ($rating) {
    "EXCELLENT" { "Green" }
    "GOOD" { "Green" }
    "ACCEPTABLE" { "Yellow" }
    "SLOW" { "Red" }
    "VERY SLOW" { "Red" }
}

Write-Host "Performance Rating: $rating" -ForegroundColor $ratingColor
Write-Host ""

# Recommendations
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "   Analysis" -ForegroundColor Cyan
Write-Host "================================================`n" -ForegroundColor Cyan

if ($parallelAvg -lt 500) {
    Write-Host "Your startup speed is excellent!" -ForegroundColor Green
    Write-Host "- Users will experience instant app loading" -ForegroundColor Green
    Write-Host "- Token verification is well-optimized" -ForegroundColor Green
} elseif ($parallelAvg -lt 1000) {
    Write-Host "Your startup speed is good." -ForegroundColor Green
    Write-Host "- Most users will be satisfied with this speed" -ForegroundColor Green
    Write-Host "- Consider caching if you want to optimize further" -ForegroundColor Yellow
} elseif ($parallelAvg -lt 2000) {
    Write-Host "Startup speed is acceptable but could be improved." -ForegroundColor Yellow
    Write-Host "- Check backend logs for slow database queries" -ForegroundColor Yellow
    Write-Host "- Ensure Firebase JWT warmup is working" -ForegroundColor Yellow
} else {
    Write-Host "Startup speed needs optimization!" -ForegroundColor Red
    Write-Host "- Check if Firebase JWT warmup is enabled" -ForegroundColor Red
    Write-Host "- Look for slow database queries in backend" -ForegroundColor Red
    Write-Host "- Consider implementing request deduplication" -ForegroundColor Red
}

Write-Host ""
Write-Host "Expected Timings:" -ForegroundColor Cyan
Write-Host "  First cold start (after backend restart): 500-2000ms" -ForegroundColor Gray
Write-Host "  Subsequent startups (keys cached):        50-500ms" -ForegroundColor Gray
Write-Host ""

# Export results
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$exportFile = "startup-speed-test-$timestamp.json"
$allResults | ConvertTo-Json -Depth 5 | Out-File $exportFile
Write-Host "Results exported to: $exportFile" -ForegroundColor Green
Write-Host ""

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "   Before/After Comparison Guide" -ForegroundColor Cyan
Write-Host "================================================`n" -ForegroundColor Cyan

Write-Host "To compare before/after optimization:"-ForegroundColor Yellow
Write-Host "1. Run this test BEFORE applying fixes -> Save average time"
Write-Host "2. Apply optimizations (Firebase warmup + deduplication)"
Write-Host "3. Restart backend: npm run dev"
Write-Host "4. Run this test AFTER fixes -> Compare average time"
Write-Host "5. Calculate improvement: (Before - After) / Before * 100%"
Write-Host ""
Write-Host "Example:" -ForegroundColor Cyan
Write-Host "  Before: 21000ms (21 seconds)"
Write-Host "  After:  500ms (0.5 seconds)"
Write-Host "  Improvement: 97.6% faster!"
Write-Host ""
