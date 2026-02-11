# Test multi-field search functionality
Write-Host "=== Testing Multi-Field Search ===" -ForegroundColor Cyan
Write-Host ""

$baseUrl = "http://localhost:5001/api"

# Test 1: Search by actor name
Write-Host "Test 1: Searching for 'Brad Pitt' (actor)" -ForegroundColor Yellow
$response = Invoke-RestMethod -Uri "$baseUrl/search/by-person?query=Brad Pitt" -Method Get
Write-Host "  Found $($response.totalResults) results" -ForegroundColor Green
if ($response.results.Count -gt 0) {
    Write-Host "  Top movie: $($response.results[0].Title) ($($response.results[0].Year))" -ForegroundColor Gray
    Write-Host "  Actor tagged: $($response.results[0].Actors)" -ForegroundColor Gray
}
Write-Host ""

# Test 2: Search by director name
Write-Host "Test 2: Searching for 'Christopher Nolan' (director)" -ForegroundColor Yellow
$response = Invoke-RestMethod -Uri "$baseUrl/search/by-person?query=Christopher Nolan" -Method Get
Write-Host "  Found $($response.totalResults) results" -ForegroundColor Green
if ($response.results.Count -gt 0) {
    Write-Host "  Top movie: $($response.results[0].Title) ($($response.results[0].Year))" -ForegroundColor Gray
}
Write-Host ""

# Test 3: Regular title search
Write-Host "Test 3: Regular search for 'Inception'" -ForegroundColor Yellow
$response = Invoke-RestMethod -Uri "$baseUrl/movies/search?q=Inception&type=movie" -Method Get
Write-Host "  Found $($response.totalResults) results" -ForegroundColor Green
if ($response.Search.Count -gt 0) {
    Write-Host "  Top result: $($response.Search[0].Title) ($($response.Search[0].Year))" -ForegroundColor Gray
}
Write-Host ""

Write-Host "=== Tests Complete ===" -ForegroundColor Cyan
