# Test Reviews Endpoints
# This tests the /movies/:id/reviews and /tv/:id/reviews endpoints

Write-Host "`n[REVIEWS API TEST]" -ForegroundColor Cyan
Write-Host "============================================`n" -ForegroundColor Gray

# Configuration
$baseUrl = "http://localhost:5001/api"

# Test data - using popular movies/shows with known reviews
$testCases = @(
    @{
        title = "Movie Reviews Test - The Dark Knight"
        endpoint = "$baseUrl/movies/155/reviews"
        type = "movie"
        id = 155
    },
    @{
        title = "TV Reviews Test - Breaking Bad"
        endpoint = "$baseUrl/tv/1396/reviews"
        type = "tv"
        id = 1396
    },
    @{
        title = "Movie Reviews - Pagination Test (Page 2)"
        endpoint = "$baseUrl/movies/155/reviews?page=2"
        type = "movie"
        id = 155
    }
)

foreach ($test in $testCases) {
    Write-Host "[Test] $($test.title)" -ForegroundColor Yellow
    Write-Host "Endpoint: $($test.endpoint)`n" -ForegroundColor Gray
    
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    
    try {
        $response = Invoke-RestMethod -Uri $test.endpoint -Method Get `
            -ContentType "application/json" `
            -TimeoutSec 30
        
        $stopwatch.Stop()
        
        Write-Host "[OK] Success in $([math]::Round($stopwatch.Elapsed.TotalSeconds, 1))s`n" -ForegroundColor Green
        
        # Extract data from response envelope
        $data = $response.data
        
        # Display results
        Write-Host "Response Summary:" -ForegroundColor Cyan
        Write-Host "  Total Reviews: $($data.total_results)" -ForegroundColor White
        Write-Host "  Current Page: $($data.page)" -ForegroundColor White
        Write-Host "  Total Pages: $($data.total_pages)" -ForegroundColor White
        Write-Host "  Reviews in Response: $($data.results.Count)" -ForegroundColor White
        Write-Host "  Source: $($response.meta.source)" -ForegroundColor Gray
        
        if ($data.results.Count -gt 0) {
            Write-Host "`n  First Review:" -ForegroundColor Cyan
            $firstReview = $data.results[0]
            Write-Host "    Author: $($firstReview.author)" -ForegroundColor White
            Write-Host "    Rating: $($firstReview.author_details.rating)/10" -ForegroundColor White
            Write-Host "    Created: $($firstReview.created_at)" -ForegroundColor Gray
            Write-Host "    Content Preview: $($firstReview.content.Substring(0, [Math]::Min(100, $firstReview.content.Length)))..." -ForegroundColor Gray
            Write-Host "    URL: $($firstReview.url)" -ForegroundColor Gray
        }
        
    } catch {
        $stopwatch.Stop()
        Write-Host "[X] Failed after $([math]::Round($stopwatch.Elapsed.TotalSeconds, 1))s" -ForegroundColor Red
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
        
        if ($_.ErrorDetails.Message) {
            try {
                $errorData = $_.ErrorDetails.Message | ConvertFrom-Json
                Write-Host "`nError Details:" -ForegroundColor Yellow
                Write-Host "  $($errorData.error)" -ForegroundColor Gray
            } catch {
                Write-Host "`nRaw Error: $($_.ErrorDetails.Message)" -ForegroundColor Gray
            }
        }
    }
    
    Write-Host "`n" + ("-" * 80) + "`n"
}

Write-Host "[Notes]" -ForegroundColor Cyan
Write-Host "  - Reviews are cached for 12 hours" -ForegroundColor Gray
Write-Host "  - Not all movies/shows have reviews" -ForegroundColor Gray
Write-Host "  - Use TMDB IDs (not IMDb IDs) for these endpoints" -ForegroundColor Gray
Write-Host "  - Popular movies like The Dark Knight typically have many reviews" -ForegroundColor Gray
Write-Host "`n[*] Testing complete!`n" -ForegroundColor Green
