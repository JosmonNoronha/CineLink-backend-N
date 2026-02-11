# Test External ML Recommendations Endpoint
# This tests the optional /recommendations/ml endpoint that uses movie-reco-api.onrender.com

Write-Host "`n[ML RECOMMENDATIONS TEST]" -ForegroundColor Cyan
Write-Host "============================================`n" -ForegroundColor Gray

# Configuration
$baseUrl = "http://localhost:5001/api"  # Change port if needed
$endpoint = "$baseUrl/recommendations/ml"

# Test data
$testCases = @(
    @{
        title = "Single Movie Test"
        body = @{
            titles = @("Inception")
            top_n = 5
        }
    },
    @{
        title = "Multiple Movies Test"
        body = @{
            titles = @("The Matrix", "Inception", "Interstellar")
            top_n = 10
        }
    }
)

foreach ($test in $testCases) {
    Write-Host "[Test] $($test.title)" -ForegroundColor Yellow
    Write-Host "Request: $($test.body | ConvertTo-Json -Compress)`n" -ForegroundColor Gray
    
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    
    try {
        $response = Invoke-RestMethod -Uri $endpoint -Method Post `
            -Body ($test.body | ConvertTo-Json) `
            -ContentType "application/json" `
            -TimeoutSec 120
        
        $stopwatch.Stop()
        
        Write-Host "[OK] Success in $([math]::Round($stopwatch.Elapsed.TotalSeconds, 1))s`n" -ForegroundColor Green
        
        # Extract data from response envelope
        $data = $response.data
        
        # Display results
        Write-Host "Response Summary:" -ForegroundColor Cyan
        Write-Host "  Found Titles: $($data.found_titles -join ', ')" -ForegroundColor White
        Write-Host "  Message: $($data.message)" -ForegroundColor White
        Write-Host "  Processing Time: $($data.processing_time)s" -ForegroundColor White
        Write-Host "  Recommendations: $($data.recommendations.Count)" -ForegroundColor White
        Write-Host "  Sources Breakdown:" -ForegroundColor White
        Write-Host "    - Content-based: $($data.recommendation_sources.content_based)" -ForegroundColor Gray
        Write-Host "    - Similarity-based: $($data.recommendation_sources.similarity_based)" -ForegroundColor Gray
        Write-Host "    - Popular fallback: $($data.recommendation_sources.popular_fallback)" -ForegroundColor Gray
        
        Write-Host "`n  Top 3 Recommendations:" -ForegroundColor Cyan
        $data.recommendations | Select-Object -First 3 | ForEach-Object {
            Write-Host "    [*] $($_.title) ($($_.release_year)) - $($_.genres)" -ForegroundColor White
            Write-Host "        Rating: $($_.avg_rating)/5 | $($_.rating_count) votes" -ForegroundColor Gray
        }
        
    } catch {
        $stopwatch.Stop()
        Write-Host "[X] Failed after $([math]::Round($stopwatch.Elapsed.TotalSeconds, 1))s" -ForegroundColor Red
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
        
        if ($_.ErrorDetails.Message) {
            $errorData = $_.ErrorDetails.Message | ConvertFrom-Json
            Write-Host "`nError Details:" -ForegroundColor Yellow
            Write-Host "  $($errorData.error)" -ForegroundColor Gray
            Write-Host "  Note: $($errorData.note)" -ForegroundColor Gray
        }
    }
    
    Write-Host "`n" + ("-" * 80) + "`n"
}

Write-Host "[Notes]" -ForegroundColor Cyan
Write-Host "  - First request may take ~60 seconds (Render cold start)" -ForegroundColor Gray
Write-Host "  - Use primary /recommendations endpoint for TMDB recommendations (faster)" -ForegroundColor Gray
Write-Host "  - This ML endpoint is optional and uses external API" -ForegroundColor Gray
Write-Host "`n[*] Testing complete!`n" -ForegroundColor Green
