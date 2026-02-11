# CineLink Backend API Test Script
# Usage: .\test-api.ps1 -Token "YOUR_FIREBASE_TOKEN_HERE"

param(
    [Parameter(Mandatory=$true)]
    [string]$Token,
    [string]$BaseUrl = "http://localhost:5001/api"
)

$headers = @{
    "Authorization" = "Bearer $Token"
    "Content-Type" = "application/json"
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "CineLink Backend API Tests" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Test 1: Health Check (no auth)
Write-Host "1. Testing Health Endpoint..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "$BaseUrl/health" -Method GET
    Write-Host "   ✅ Health: $($health.data.status)" -ForegroundColor Green
} catch {
    Write-Host "   ❌ Failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 2: Get Favorites
Write-Host "`n2. Testing GET /user/favorites..." -ForegroundColor Yellow
try {
    $favorites = Invoke-RestMethod -Uri "$BaseUrl/user/favorites" -Method GET -Headers $headers
    Write-Host "   ✅ Favorites: $($favorites.data.Count) items" -ForegroundColor Green
    if ($favorites.data.Count -gt 0) {
        Write-Host "   First item: $($favorites.data[0].Title)" -ForegroundColor Gray
    }
} catch {
    Write-Host "   ❌ Failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 3: Get Watchlists
Write-Host "`n3. Testing GET /user/watchlists..." -ForegroundColor Yellow
try {
    $watchlists = Invoke-RestMethod -Uri "$BaseUrl/user/watchlists" -Method GET -Headers $headers
    Write-Host "   ✅ Watchlists: $($watchlists.data.Count) items" -ForegroundColor Green
    foreach ($wl in $watchlists.data) {
        Write-Host "   - $($wl.name): $($wl.movies.Count) movies" -ForegroundColor Gray
    }
} catch {
    Write-Host "   ❌ Failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 4: Add to Favorites
Write-Host "`n4. Testing POST /user/favorites (add movie)..." -ForegroundColor Yellow
try {
    $testMovie = @{
        movie = @{
            imdbID = "tt0133093"
            Title = "The Matrix"
            Year = "1999"
            Type = "movie"
            Poster = "https://m.media-amazon.com/images/M/MV5BNzQzOTk3OTAtNDQ0Zi00ZTVkLWI0MTEtMDllZjNkYzNjNTc4L2ltYWdlXkEyXkFqcGdeQXVyNjU0OTQ0OTY@._V1_SX300.jpg"
        }
    } | ConvertTo-Json -Depth 3

    $result = Invoke-RestMethod -Uri "$BaseUrl/user/favorites" -Method POST -Headers $headers -Body $testMovie
    Write-Host "   ✅ Added to favorites" -ForegroundColor Green
} catch {
    Write-Host "   ❌ Failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 5: Create Watchlist
Write-Host "`n5. Testing POST /user/watchlists (create watchlist)..." -ForegroundColor Yellow
try {
    $watchlistName = "test-$(Get-Date -Format 'HHmmss')"
    $newWatchlist = @{
        name = $watchlistName
        description = "Test watchlist"
    } | ConvertTo-Json

    $result = Invoke-RestMethod -Uri "$BaseUrl/user/watchlists" -Method POST -Headers $headers -Body $newWatchlist
    Write-Host "   ✅ Created watchlist: $watchlistName" -ForegroundColor Green
    
    # Test 6: Add Movie to Watchlist
    Write-Host "`n6. Testing POST /user/watchlists/$watchlistName/movies (add movie)..." -ForegroundColor Yellow
    try {
        $movieToAdd = @{
            movie = @{
                imdbID = "tt0468569"
                Title = "The Dark Knight"
                Year = "2008"
                Type = "movie"
                Poster = "https://m.media-amazon.com/images/M/MV5BMTMxNTMwODM0NF5BMl5BanBnXkFtZTcwODAyMTk2Mw@@._V1_SX300.jpg"
            }
        } | ConvertTo-Json -Depth 3

        $addResult = Invoke-RestMethod -Uri "$BaseUrl/user/watchlists/$watchlistName/movies" -Method POST -Headers $headers -Body $movieToAdd
        Write-Host "   ✅ Added movie to watchlist" -ForegroundColor Green
    } catch {
        Write-Host "   ❌ Failed to add movie: $($_.Exception.Message)" -ForegroundColor Red
    }

    # Test 7: Toggle Watched Status
    Write-Host "`n7. Testing PATCH /user/watchlists/$watchlistName/movies/tt0468569/watched..." -ForegroundColor Yellow
    try {
        $toggleResult = Invoke-RestMethod -Uri "$BaseUrl/user/watchlists/$watchlistName/movies/tt0468569/watched" -Method PATCH -Headers $headers
        Write-Host "   ✅ Toggled watched status: $($toggleResult.data.watched)" -ForegroundColor Green
    } catch {
        Write-Host "   ❌ Failed: $($_.Exception.Message)" -ForegroundColor Red
    }

    # Test 8: Remove Movie from Watchlist
    Write-Host "`n8. Testing DELETE /user/watchlists/$watchlistName/movies/tt0468569..." -ForegroundColor Yellow
    try {
        $removeResult = Invoke-RestMethod -Uri "$BaseUrl/user/watchlists/$watchlistName/movies/tt0468569" -Method DELETE -Headers $headers
        Write-Host "   ✅ Removed movie from watchlist" -ForegroundColor Green
    } catch {
        Write-Host "   ❌ Failed: $($_.Exception.Message)" -ForegroundColor Red
    }

    # Test 9: Delete Watchlist
    Write-Host "`n9. Testing DELETE /user/watchlists/$watchlistName..." -ForegroundColor Yellow
    try {
        $deleteResult = Invoke-RestMethod -Uri "$BaseUrl/user/watchlists/$watchlistName" -Method DELETE -Headers $headers
        Write-Host "   ✅ Deleted watchlist" -ForegroundColor Green
    } catch {
        Write-Host "   ❌ Failed: $($_.Exception.Message)" -ForegroundColor Red
    }

} catch {
    Write-Host "   ❌ Failed to create watchlist: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 10: Remove from Favorites
Write-Host "`n10. Testing DELETE /user/favorites/tt0133093..." -ForegroundColor Yellow
try {
    $removeResult = Invoke-RestMethod -Uri "$BaseUrl/user/favorites/tt0133093" -Method DELETE -Headers $headers
    Write-Host "   ✅ Removed from favorites" -ForegroundColor Green
} catch {
    Write-Host "   ❌ Failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Tests Complete!" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan
