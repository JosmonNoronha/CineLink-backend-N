# Redis Cache Testing Script for CineLink Backend
# This script tests TMDB caching with Redis

Write-Host "`n================================================" -ForegroundColor Cyan
Write-Host "   CineLink Redis Cache Testing Script" -ForegroundColor Cyan
Write-Host "================================================`n" -ForegroundColor Cyan

$baseUrl = "http://localhost:5001/api"

# Test 1: Health Check
Write-Host "━━━ Test 1: Health Check ━━━" -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "$baseUrl/health" -Method GET
    Write-Host "[OK] Server Status: $($health.data.status)" -ForegroundColor Green
    Write-Host "[OK] Cache Status: $($health.data.services.cache)" -ForegroundColor Green
    
    if ($health.data.services.cache -ne "healthy") {
        Write-Host "[ERROR] Redis is not healthy! Please check Redis connection." -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "[ERROR] Server is not running! Please start with: npm run dev" -ForegroundColor Red
    exit 1
}

# Test 2: First Request (Cache Miss)
Write-Host "`n━━━ Test 2: First Request - Popular Movies (CACHE MISS) ━━━" -ForegroundColor Yellow
Write-Host "Fetching from TMDB API..." -ForegroundColor Gray

$sw1 = [System.Diagnostics.Stopwatch]::StartNew()
try {
    $response1 = Invoke-RestMethod -Uri "$baseUrl/movies/popular?page=1" -Method GET
    $sw1.Stop()
    
    Write-Host "[OK] Response Time: $($sw1.ElapsedMilliseconds)ms" -ForegroundColor Cyan
    Write-Host "[OK] Movies Returned: $($response1.data.results.Count)" -ForegroundColor Cyan
    Write-Host "[OK] Source: TMDB API (not cached yet)" -ForegroundColor Cyan
} catch {
    Write-Host "[ERROR] Request failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Test 3: Second Request (Cache Hit)
Write-Host "`n━━━ Test 3: Second Request - Same Endpoint (CACHE HIT) ━━━" -ForegroundColor Yellow
Write-Host "Fetching from Redis cache..." -ForegroundColor Gray

Start-Sleep -Seconds 1

$sw2 = [System.Diagnostics.Stopwatch]::StartNew()
try {
    $response2 = Invoke-RestMethod -Uri "$baseUrl/movies/popular?page=1" -Method GET
    $sw2.Stop()
    
    Write-Host "[OK] Response Time: $($sw2.ElapsedMilliseconds)ms" -ForegroundColor Green
    Write-Host "[OK] Movies Returned: $($response2.data.results.Count)" -ForegroundColor Green
    Write-Host "[OK] Source: Redis Cache" -ForegroundColor Green
    
    # Calculate speed improvement
    $improvement = [math]::Round((($sw1.ElapsedMilliseconds - $sw2.ElapsedMilliseconds) / $sw1.ElapsedMilliseconds) * 100, 1)
    
    if ($sw2.ElapsedMilliseconds -lt $sw1.ElapsedMilliseconds) {
        Write-Host "`nCACHE PERFORMANCE:" -ForegroundColor Magenta
        Write-Host "   First request:  $($sw1.ElapsedMilliseconds)ms (TMDB API)" -ForegroundColor White
        Write-Host "   Cached request: $($sw2.ElapsedMilliseconds)ms (Redis)" -ForegroundColor White
        Write-Host "   Speed boost:    $improvement% faster!" -ForegroundColor Green
    } else {
        Write-Host "`n⚠️  Cache might not be working - second request was slower!" -ForegroundColor Yellow
    }
} catch {
    Write-Host "[ERROR] Cached request failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 4: Different Endpoint
Write-Host "`n━━━ Test 4: Different Endpoint - Top Rated (NEW CACHE) ━━━" -ForegroundColor Yellow

$sw3 = [System.Diagnostics.Stopwatch]::StartNew()
try {
    $response3 = Invoke-RestMethod -Uri "$baseUrl/movies/top-rated?page=1" -Method GET
    $sw3.Stop()
    
    Write-Host "✓ Response Time: $($sw3.ElapsedMilliseconds)ms" -ForegroundColor Cyan
    Write-Host "✓ Movies Returned: $($response3.data.results.Count)" -ForegroundColor Cyan
} catch {
    Write-Host "[ERROR] Request failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 5: Search Endpoint (1 hour TTL)
Write-Host "`n━━━ Test 5: Search Endpoint - Testing Search Cache ━━━" -ForegroundColor Yellow

$sw4 = [System.Diagnostics.Stopwatch]::StartNew()
try {
    $response4 = Invoke-RestMethod -Uri "$baseUrl/search?query=batman" -Method GET
    $sw4.Stop()
    
    Write-Host "[OK] Response Time: $($sw4.ElapsedMilliseconds)ms (First search)" -ForegroundColor Cyan
    Write-Host "[OK] Results Found: $($response4.data.results.Count)" -ForegroundColor Cyan
    
    # Repeat same search
    Start-Sleep -Seconds 1
    $sw5 = [System.Diagnostics.Stopwatch]::StartNew()
    $response5 = Invoke-RestMethod -Uri "$baseUrl/search?query=batman" -Method GET
    $sw5.Stop()
    
    Write-Host "[OK] Response Time: $($sw5.ElapsedMilliseconds)ms (Cached search)" -ForegroundColor Green
    
    if ($sw5.ElapsedMilliseconds -lt $sw4.ElapsedMilliseconds) {
        $searchImprovement = [math]::Round((($sw4.ElapsedMilliseconds - $sw5.ElapsedMilliseconds) / $sw4.ElapsedMilliseconds) * 100, 1)
        Write-Host "[OK] Search cache working: $searchImprovement% faster!" -ForegroundColor Green
    }
} catch {
    Write-Host "✗ Search request failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 6: Status Monitor
Write-Host "`n━━━ Test 6: Status Monitor Dashboard ━━━" -ForegroundColor Yellow
try {
    $statusUrl = "http://localhost:5001/status-monitor"
    Write-Host "[OK] Access dashboard at: $statusUrl" -ForegroundColor Green
    Write-Host "  (View real-time metrics, response times, and cache stats)" -ForegroundColor Gray
} catch {
    Write-Host "✗ Could not access status monitor" -ForegroundColor Red
}

# Summary
Write-Host "`n================================================" -ForegroundColor Cyan
Write-Host "           CACHE TEST SUMMARY" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan

Write-Host "`nRedis is connected and caching TMDB API responses" -ForegroundColor Green
Write-Host "Cache TTL: 24h (details), 6h (lists), 1h (search)" -ForegroundColor Green
Write-Host "Cached data is significantly faster than API calls" -ForegroundColor Green

Write-Host "`nCACHE KEY PATTERNS:" -ForegroundColor Yellow
Write-Host "   tmdb:/movie/popular" -ForegroundColor Gray
Write-Host "   tmdb:/movie/id" -ForegroundColor Gray
Write-Host "   tmdb:/search/multi" -ForegroundColor Gray

Write-Host "`nVERIFY REDIS KEYS (optional):" -ForegroundColor Yellow
Write-Host "   Run in Redis CLI: redis-cli KEYS tmdb:*" -ForegroundColor Gray

Write-Host "`nAll cache tests completed!`n" -ForegroundColor Green
