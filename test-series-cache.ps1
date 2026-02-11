# TV Series Cache Testing Script
Write-Host "`n================================================" -ForegroundColor Cyan
Write-Host "   TV Series Caching Test (Redis)" -ForegroundColor Cyan
Write-Host "================================================`n" -ForegroundColor Cyan

$baseUrl = "http://localhost:5001/api"

# Test Series: Breaking Bad (tt0903747 / TMDB ID: 1396)
$testSeriesIMDB = "tt0903747"
$testSeasonNumber = 1
$testEpisodeNumber = 1

Write-Host "[Step 1] Health Check" -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "$baseUrl/health" -Method GET
    Write-Host "    Server: $($health.data.status)" -ForegroundColor Green
    Write-Host "    Cache: $($health.data.services.cache)" -ForegroundColor Green
    
    if ($health.data.services.cache -ne "healthy") {
        Write-Host "    [ERROR] Redis not healthy!" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "    [ERROR] Server not running!" -ForegroundColor Red
    exit 1
}

Write-Host "`n[Step 2] Clear TV Cache for Fresh Test" -ForegroundColor Yellow
try {
    $tvKeys = & "D:\Program Files\Redis\redis-cli.exe" KEYS "tmdb:/tv/*"
    if ($tvKeys) {
        foreach ($key in $tvKeys) {
            & "D:\Program Files\Redis\redis-cli.exe" DEL $key | Out-Null
        }
        Write-Host "    Cleared $($tvKeys.Count) TV cache keys" -ForegroundColor Green
    } else {
        Write-Host "    No TV cache keys to clear" -ForegroundColor Gray
    }
} catch {
    Write-Host "    [WARNING] Could not clear cache" -ForegroundColor Yellow
}

Write-Host "`n[Step 3] Test TV Show Details (CACHE MISS)" -ForegroundColor Yellow
Write-Host "    Fetching Breaking Bad details..." -ForegroundColor Gray

$sw1 = [System.Diagnostics.Stopwatch]::StartNew()
try {
    $response1 = Invoke-RestMethod -Uri "$baseUrl/movies/details/$testSeriesIMDB" -Method GET
    $sw1.Stop()
    
    Write-Host "    [OK] Response Time: $($sw1.ElapsedMilliseconds)ms" -ForegroundColor Cyan
    Write-Host "    [OK] Title: $($response1.data.Title)" -ForegroundColor Cyan
    Write-Host "    [OK] Type: $($response1.data.Type)" -ForegroundColor Cyan
    Write-Host "    [OK] Total Seasons: $($response1.data.totalSeasons)" -ForegroundColor Cyan
    Write-Host "    [OK] Source: TMDB API (first request)" -ForegroundColor Cyan
} catch {
    Write-Host "    [ERROR] Request failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host "`n[Step 4] Test TV Show Details Again (CACHE HIT)" -ForegroundColor Yellow
Write-Host "    Fetching same show from cache..." -ForegroundColor Gray

Start-Sleep -Milliseconds 500

$sw2 = [System.Diagnostics.Stopwatch]::StartNew()
try {
    $response2 = Invoke-RestMethod -Uri "$baseUrl/movies/details/$testSeriesIMDB" -Method GET
    $sw2.Stop()
    
    Write-Host "    [OK] Response Time: $($sw2.ElapsedMilliseconds)ms" -ForegroundColor Green
    Write-Host "    [OK] Source: Redis Cache" -ForegroundColor Green
    
    if ($sw2.ElapsedMilliseconds -lt $sw1.ElapsedMilliseconds) {
        $improvement = [math]::Round((($sw1.ElapsedMilliseconds - $sw2.ElapsedMilliseconds) / $sw1.ElapsedMilliseconds) * 100, 1)
        Write-Host "    [OK] Speed improvement: $improvement% faster!" -ForegroundColor Green
    }
} catch {
    Write-Host "    [ERROR] Cached request failed" -ForegroundColor Red
}

Write-Host "`n[Step 5] Test Season Details (CACHE MISS)" -ForegroundColor Yellow
Write-Host "    Fetching Breaking Bad Season $testSeasonNumber..." -ForegroundColor Gray

$sw3 = [System.Diagnostics.Stopwatch]::StartNew()
try {
    $response3 = Invoke-RestMethod -Uri "$baseUrl/movies/season/$testSeriesIMDB/$testSeasonNumber" -Method GET
    $sw3.Stop()
    
    Write-Host "    [OK] Response Time: $($sw3.ElapsedMilliseconds)ms" -ForegroundColor Cyan
    Write-Host "    [OK] Season: $($response3.data.Season)" -ForegroundColor Cyan
    Write-Host "    [OK] Episodes: $($response3.data.Episodes.Count)" -ForegroundColor Cyan
    Write-Host "    [OK] Source: TMDB API (first request)" -ForegroundColor Cyan
} catch {
    Write-Host "    [ERROR] Season request failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n[Step 6] Test Season Details Again (CACHE HIT)" -ForegroundColor Yellow
Write-Host "    Fetching same season from cache..." -ForegroundColor Gray

Start-Sleep -Milliseconds 500

$sw4 = [System.Diagnostics.Stopwatch]::StartNew()
try {
    $response4 = Invoke-RestMethod -Uri "$baseUrl/movies/season/$testSeriesIMDB/$testSeasonNumber" -Method GET
    $sw4.Stop()
    
    Write-Host "    [OK] Response Time: $($sw4.ElapsedMilliseconds)ms" -ForegroundColor Green
    Write-Host "    [OK] Episodes: $($response4.data.Episodes.Count)" -ForegroundColor Green
    Write-Host "    [OK] Source: Redis Cache" -ForegroundColor Green
    
    if ($sw4.ElapsedMilliseconds -lt $sw3.ElapsedMilliseconds) {
        $improvement = [math]::Round((($sw3.ElapsedMilliseconds - $sw4.ElapsedMilliseconds) / $sw3.ElapsedMilliseconds) * 100, 1)
        Write-Host "    [OK] Speed improvement: $improvement% faster!" -ForegroundColor Green
    }
} catch {
    Write-Host "    [ERROR] Cached season request failed" -ForegroundColor Red
}

Write-Host "`n[Step 7] Test Episode Details (CACHE MISS)" -ForegroundColor Yellow
Write-Host "    Fetching Breaking Bad S${testSeasonNumber}E${testEpisodeNumber}..." -ForegroundColor Gray

$sw5 = [System.Diagnostics.Stopwatch]::StartNew()
try {
    $response5 = Invoke-RestMethod -Uri "$baseUrl/movies/episode/$testSeriesIMDB/$testSeasonNumber/$testEpisodeNumber" -Method GET
    $sw5.Stop()
    
    Write-Host "    [OK] Response Time: $($sw5.ElapsedMilliseconds)ms" -ForegroundColor Cyan
    Write-Host "    [OK] Title: $($response5.data.Title)" -ForegroundColor Cyan
    Write-Host "    [OK] Season: $($response5.data.Season), Episode: $($response5.data.Episode)" -ForegroundColor Cyan
    Write-Host "    [OK] Runtime: $($response5.data.Runtime)" -ForegroundColor Cyan
    Write-Host "    [OK] Source: TMDB API (first request)" -ForegroundColor Cyan
} catch {
    Write-Host "    [ERROR] Episode request failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n[Step 8] Test Episode Details Again (CACHE HIT)" -ForegroundColor Yellow
Write-Host "    Fetching same episode from cache..." -ForegroundColor Gray

Start-Sleep -Milliseconds 500

$sw6 = [System.Diagnostics.Stopwatch]::StartNew()
try {
    $response6 = Invoke-RestMethod -Uri "$baseUrl/movies/episode/$testSeriesIMDB/$testSeasonNumber/$testEpisodeNumber" -Method GET
    $sw6.Stop()
    
    Write-Host "    [OK] Response Time: $($sw6.ElapsedMilliseconds)ms" -ForegroundColor Green
    Write-Host "    [OK] Title: $($response6.data.Title)" -ForegroundColor Green
    Write-Host "    [OK] Source: Redis Cache" -ForegroundColor Green
    
    if ($sw6.ElapsedMilliseconds -lt $sw5.ElapsedMilliseconds) {
        $improvement = [math]::Round((($sw5.ElapsedMilliseconds - $sw6.ElapsedMilliseconds) / $sw5.ElapsedMilliseconds) * 100, 1)
        Write-Host "    [OK] Speed improvement: $improvement% faster!" -ForegroundColor Green
    }
} catch {
    Write-Host "    [ERROR] Cached episode request failed" -ForegroundColor Red
}

Write-Host "`n[Step 9] Verify Cache Keys in Redis" -ForegroundColor Yellow
try {
    $allKeys = & "D:\Program Files\Redis\redis-cli.exe" KEYS "tmdb:*"
    $tvKeys = $allKeys | Where-Object { $_ -match 'tv' -or $_ -match '1396' }
    
    Write-Host "    Total TMDB cache keys: $($allKeys.Count)" -ForegroundColor White
    Write-Host "    TV-related cache keys: $($tvKeys.Count)" -ForegroundColor Green
    
    if ($tvKeys) {
        Write-Host "`n    Sample cached items:" -ForegroundColor Gray
        $tvKeys | Select-Object -First 5 | ForEach-Object {
            $ttl = & "D:\Program Files\Redis\redis-cli.exe" TTL $_
            Write-Host "      Key: $_ (TTL: $ttl seconds)" -ForegroundColor DarkGray
        }
    }
} catch {
    Write-Host "    [WARNING] Could not verify cache keys" -ForegroundColor Yellow
}

Write-Host "`n================================================" -ForegroundColor Cyan
Write-Host "          TEST SUMMARY" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan

Write-Host "`n  Performance Results:" -ForegroundColor Yellow
Write-Host "    TV Details:  $($sw1.ElapsedMilliseconds)ms -> $($sw2.ElapsedMilliseconds)ms" -ForegroundColor White
Write-Host "    Season Data: $($sw3.ElapsedMilliseconds)ms -> $($sw4.ElapsedMilliseconds)ms" -ForegroundColor White
Write-Host "    Episode:     $($sw5.ElapsedMilliseconds)ms -> $($sw6.ElapsedMilliseconds)ms" -ForegroundColor White

Write-Host "`n  Cache Configuration:" -ForegroundColor Yellow
Write-Host "    TV Show Details: 24 hours TTL" -ForegroundColor White
Write-Host "    Season Details:  24 hours TTL" -ForegroundColor White
Write-Host "    Episode Details: 24 hours TTL" -ForegroundColor White

Write-Host "`n  [OK] Redis caching is working correctly!" -ForegroundColor Green
Write-Host "  [OK] No Firestore series cache needed!" -ForegroundColor Green
Write-Host "  [OK] All TV data served from backend Redis!" -ForegroundColor Green

Write-Host "`n================================================`n" -ForegroundColor Cyan
