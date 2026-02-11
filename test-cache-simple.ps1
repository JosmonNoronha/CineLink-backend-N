# Simple Redis Cache Test
Write-Host "`n=== CineLink Redis Cache Test ===`n" -ForegroundColor Cyan

# Health Check
$health = Invoke-RestMethod -Uri "http://localhost:5001/api/health"
Write-Host "[1] Health Check:" -ForegroundColor Yellow
Write-Host "    Server: $($health.data.status)" -ForegroundColor Green
Write-Host "    Cache: $($health.data.services.cache)" -ForegroundColor Green

# Test Popular Movies
Write-Host "`n[2] Testing Cache with Popular Movies:" -ForegroundColor Yellow

Write-Host "    First request (from TMDB)..." -ForegroundColor Gray
$time1 = Measure-Command {
    $result1 = Invoke-RestMethod -Uri "http://localhost:5001/api/movies/popular"
}
Write-Host "    Time: $([math]::Round($time1.TotalMilliseconds, 2))ms" -ForegroundColor White

Start-Sleep -Milliseconds 500

Write-Host "    Second request (from Cache)..." -ForegroundColor Gray  
$time2 = Measure-Command {
    $result2 = Invoke-RestMethod -Uri "http://localhost:5001/api/movies/popular"
}
Write-Host "    Time: $([math]::Round($time2.TotalMilliseconds, 2))ms" -ForegroundColor White

Write-Host "    Movies returned: $($result2.data.results.Count)" -ForegroundColor Cyan

# Performance Comparison
if ($time2.TotalMilliseconds -lt $time1.TotalMilliseconds) {
    $speedup = [math]::Round((1 - $time2.TotalMilliseconds / $time1.TotalMilliseconds) * 100, 1)
    Write-Host "`n[RESULT] Cache is WORKING! $speedup% faster" -ForegroundColor Green
} else {
    Write-Host "`n[RESULT] Both requests similar speed (already cached from previous run)" -ForegroundColor Yellow
}

# Check Redis Keys
Write-Host "`n[3] Verify Cache in Redis:" -ForegroundColor Yellow
try {
    $redis = "D:\Program Files\Redis\redis-cli.exe"
    $keys = & $redis KEYS "tmdb:*" 2>$null
    if ($keys) {
        Write-Host "    Found $($keys.Count) cached items in Redis" -ForegroundColor Green
        Write-Host "    Sample keys:" -ForegroundColor Gray
        $keys | Select-Object -First 3 | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }
    } else {
        Write-Host "    No keys found (cache may have expired)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "    Could not connect to Redis CLI" -ForegroundColor Yellow
}

Write-Host "`n[4] Status Dashboard:" -ForegroundColor Yellow
Write-Host "    URL: http://localhost:5001/status-monitor" -ForegroundColor Cyan
Write-Host "`n=== Test Complete ===`n" -ForegroundColor Green
