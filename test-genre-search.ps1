# Test genre search functionality
Write-Host "=== Testing Genre Search ===" -ForegroundColor Cyan
Write-Host ""

$baseUrl = "http://localhost:5001/api"

# Test 1: Action genre
Write-Host "Test 1: Searching for 'action' movies" -ForegroundColor Yellow
$response = Invoke-RestMethod -Uri "$baseUrl/search/by-genre?genre=action&type=movie" -Method Get
Write-Host "  Found $($response.totalResults) results" -ForegroundColor Green
if ($response.Search.Count -gt 0) {
    Write-Host "  Top 3 results:" -ForegroundColor Gray
    $response.Search | Select-Object -First 3 | ForEach-Object {
        Write-Host "    - $($_.Title) ($($_.Year)) ⭐ $($_.imdbRating)" -ForegroundColor Gray
    }
}
Write-Host ""

# Test 2: Anime
Write-Host "Test 2: Searching for 'anime'" -ForegroundColor Yellow
$response = Invoke-RestMethod -Uri "$baseUrl/search/by-genre?genre=anime" -Method Get
Write-Host "  Found $($response.totalResults) results" -ForegroundColor Green
if ($response.Search.Count -gt 0) {
    Write-Host "  Top 3 results:" -ForegroundColor Gray
    $response.Search | Select-Object -First 3 | ForEach-Object {
        Write-Host "    - $($_.Title) ($($_.Year)) ⭐ $($_.imdbRating)" -ForegroundColor Gray
    }
}
Write-Host ""

# Test 3: Thriller TV series
Write-Host "Test 3: Searching for 'thriller' series" -ForegroundColor Yellow
$response = Invoke-RestMethod -Uri "$baseUrl/search/by-genre?genre=thriller&type=series" -Method Get
Write-Host "  Found $($response.totalResults) results" -ForegroundColor Green
if ($response.Search.Count -gt 0) {
    Write-Host "  Top 3 results:" -ForegroundColor Gray
    $response.Search | Select-Object -First 3 | ForEach-Object {
        Write-Host "    - $($_.Title) ($($_.Year)) ⭐ $($_.imdbRating)" -ForegroundColor Gray
    }
}
Write-Host ""

# Test 4: Comedy
Write-Host "Test 4: Searching for 'comedy'" -ForegroundColor Yellow
$response = Invoke-RestMethod -Uri "$baseUrl/search/by-genre?genre=comedy" -Method Get
Write-Host "  Found $($response.totalResults) results" -ForegroundColor Green
if ($response.Search.Count -gt 0) {
    Write-Host "  Top 3 results:" -ForegroundColor Gray
    $response.Search | Select-Object -First 3 | ForEach-Object {
        Write-Host "    - $($_.Title) ($($_.Year)) [$($.Type)] ⭐ $($_.imdbRating)" -ForegroundColor Gray
    }
}
Write-Host ""

Write-Host "=== Tests Complete ===" -ForegroundColor Cyan
