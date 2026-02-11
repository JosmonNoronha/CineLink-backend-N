# Quick Startup Speed Comparison
# Simple test to measure before/after optimization impact

Write-Host "`n=== CineLink Startup Speed Test ===" -ForegroundColor Cyan

$baseUrl = "http://localhost:5001/api"

# Test with invalid token (measures timing without valid auth)
$headers = @{
    "Authorization" = "Bearer test-token"
    "Content-Type" = "application/json"
}

Write-Host "`nTesting parallel API calls (simulating app startup)...`n"

# Run 5 quick tests
$results = @()

for ($i = 1; $i -le 5; $i++) {
    Write-Host "Test $i/5..." -NoNewline
    
    $start = Get-Date
    
    # Make parallel calls like the app does
    $jobs = @(
        (Start-Job -ScriptBlock {
            param($url, $h)
            try { Invoke-RestMethod -Uri "$url/favorites" -Headers $h -ErrorAction Stop } catch {}
        } -ArgumentList $baseUrl, $headers),
        
        (Start-Job -ScriptBlock {
            param($url, $h)
            try { Invoke-RestMethod -Uri "$url/watchlists" -Headers $h -ErrorAction Stop } catch {}
        } -ArgumentList $baseUrl, $headers)
    )
    
    $jobs | Wait-Job | Out-Null
    $jobs | Remove-Job
    
    $duration = ((Get-Date) - $start).TotalMilliseconds
    $results += $duration
    
    Write-Host " $([Math]::Round($duration, 0))ms" -ForegroundColor $(if($duration -lt 1000){"Green"}elseif($duration -lt 3000){"Yellow"}else{"Red"})
    
    if ($i -lt 5) { Start-Sleep -Milliseconds 500 }
}

$avg = ($results | Measure-Object -Average).Average
$min = ($results | Measure-Object -Minimum).Minimum
$max = ($results | Measure-Object -Maximum).Maximum

Write-Host "`n--- Results ---" -ForegroundColor Cyan
Write-Host "Average: $([Math]::Round($avg, 0))ms" -ForegroundColor $(if($avg -lt 1000){"Green"}elseif($avg -lt 3000){"Yellow"}else{"Red"})
Write-Host "Best:    ${min}ms"
Write-Host "Worst:   ${max}ms"

Write-Host "`n--- Rating ---" -ForegroundColor Cyan
if ($avg -lt 500) {
    Write-Host "EXCELLENT" -ForegroundColor Green -NoNewline
    Write-Host " - Instant startup!"
} elseif ($avg -lt 1000) {
    Write-Host "GOOD" -ForegroundColor Green -NoNewline
    Write-Host " - Fast startup"
} elseif ($avg -lt 2000) {
    Write-Host "ACCEPTABLE" -ForegroundColor Yellow -NoNewline
    Write-Host " - Noticeable delay"
} elseif ($avg -lt 5000) {
    Write-Host "SLOW" -ForegroundColor Red -NoNewline
    Write-Host " - Users will notice lag"
} else {
    Write-Host "VERY SLOW" -ForegroundColor Red -NoNewline
    Write-Host " - Poor user experience"
}

Write-Host "`n`nSave this number to compare later!"
Write-Host "After optimization, run again and compare.`n"
