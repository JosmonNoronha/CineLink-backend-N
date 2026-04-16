param(
    [string]$BaseUrl = "http://127.0.0.1:5001/api",
    [switch]$AllowTmdb401,
    [switch]$ProbeReconnect,
    [int]$ProbeSeconds = 75,
    [int]$ProbeIntervalSeconds = 5
)

$tests = @(
    @{ Name = "GET /health"; Method = "GET"; Url = "$BaseUrl/health"; Expected = @(200); Body = $null },
    @{ Name = "GET /movies/popular?page=1"; Method = "GET"; Url = "$BaseUrl/movies/popular?page=1"; Expected = @(200); Body = $null },
    @{ Name = "GET /movies/search?q=batman"; Method = "GET"; Url = "$BaseUrl/movies/search?q=batman"; Expected = @(200); Body = $null },
    @{ Name = "GET /movies/details/tt0372784"; Method = "GET"; Url = "$BaseUrl/movies/details/tt0372784"; Expected = @(200); Body = $null },
    @{ Name = "GET /movies/155/reviews"; Method = "GET"; Url = "$BaseUrl/movies/155/reviews"; Expected = @(200); Body = $null },
    @{ Name = "GET /tv/1396/reviews"; Method = "GET"; Url = "$BaseUrl/tv/1396/reviews"; Expected = @(200); Body = $null },
    @{ Name = "GET /movies/550/watch-providers"; Method = "GET"; Url = "$BaseUrl/movies/550/watch-providers"; Expected = @(200); Body = $null },
    @{ Name = "GET /tv/1396/watch-providers"; Method = "GET"; Url = "$BaseUrl/tv/1396/watch-providers"; Expected = @(200); Body = $null },
    @{ Name = "POST /recommendations"; Method = "POST"; Url = "$BaseUrl/recommendations"; Expected = @(200); Body = @{ title = "Batman"; top_n = 5 } },
    @{ Name = "GET /user/favorites (no token)"; Method = "GET"; Url = "$BaseUrl/user/favorites"; Expected = @(401); Body = $null }
)

if ($AllowTmdb401) {
    foreach ($t in $tests) {
        if ($t.Name -ne "GET /health" -and $t.Name -ne "GET /user/favorites (no token)") {
            $t.Expected = @($t.Expected + 401)
        }
    }
}

$results = [System.Collections.Generic.List[object]]::new()

function Parse-Body {
    param([string]$content)

    if ([string]::IsNullOrWhiteSpace($content)) {
        return $null
    }

    try {
        return $content | ConvertFrom-Json
    } catch {
        return $null
    }
}

foreach ($t in $tests) {
    $status = "ERR"
    $ok = $false
    $note = ""
    $redisQuotaError = $false

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        if ($t.Method -eq "POST") {
            $payload = $t.Body | ConvertTo-Json -Depth 6
            $resp = Invoke-WebRequest -UseBasicParsing -Uri $t.Url -Method POST -ContentType "application/json" -Body $payload -TimeoutSec 45
        } else {
            $resp = Invoke-WebRequest -UseBasicParsing -Uri $t.Url -Method GET -TimeoutSec 45
        }

        $status = [int]$resp.StatusCode
        $json = Parse-Body -content $resp.Content
        if ($json -and $json.error -and $json.error.message) {
            $note = [string]$json.error.message
        } elseif ($json -and $json.data -and $json.data.status) {
            $note = [string]$json.data.status
        } elseif ($json -and $json.data -and $json.data.Title) {
            $note = [string]$json.data.Title
        }
    } catch {
        if ($_.Exception.Response) {
            $status = [int]$_.Exception.Response.StatusCode
            $stream = $_.Exception.Response.GetResponseStream()
            if ($stream) {
                $reader = New-Object System.IO.StreamReader($stream)
                $raw = $reader.ReadToEnd()
                $reader.Close()
                $json = Parse-Body -content $raw
                if ($json -and $json.error -and $json.error.message) {
                    $note = [string]$json.error.message
                } else {
                    $note = $raw
                }
            } else {
                $note = $_.Exception.Message
            }
        } else {
            $note = $_.Exception.Message
        }
    }

    $sw.Stop()

    if ($t.Expected -contains $status) {
        $ok = $true
    }

    if ($note -match "max requests limit exceeded") {
        $redisQuotaError = $true
    }

    $results.Add([pscustomobject]@{
        check = $t.Name
        expected = ($t.Expected -join ",")
        status = $status
        ok = $ok
        ms = $sw.ElapsedMilliseconds
        redisQuotaError = $redisQuotaError
        note = $note
    })
}

$results | Format-Table -AutoSize | Out-String -Width 400

if ($ProbeReconnect) {
    Write-Host "`n[Reconnect Probe] Polling $BaseUrl/health for cache state..." -ForegroundColor Cyan

    $probeDeadline = (Get-Date).AddSeconds($ProbeSeconds)
    $sawDisabled = $false
    $sawHealthyAfterDisabled = $false
    $probeRows = [System.Collections.Generic.List[object]]::new()

    while ((Get-Date) -lt $probeDeadline) {
        $statusCode = "ERR"
        $cacheState = "unknown"
        $note = ""

        try {
            $resp = Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/health" -Method GET -TimeoutSec 10
            $statusCode = [int]$resp.StatusCode
            $json = Parse-Body -content $resp.Content
            if ($json -and $json.data -and $json.data.services -and $json.data.services.cache) {
                $cacheState = [string]$json.data.services.cache
            }
        } catch {
            $note = $_.Exception.Message
        }

        if ($cacheState -eq "disabled-or-not-ready") {
            $sawDisabled = $true
        }

        if ($sawDisabled -and $cacheState -eq "healthy") {
            $sawHealthyAfterDisabled = $true
        }

        $probeRows.Add([pscustomobject]@{
            time = (Get-Date).ToString("HH:mm:ss")
            status = $statusCode
            cache = $cacheState
            note = $note
        })

        Start-Sleep -Seconds $ProbeIntervalSeconds
    }

    $probeRows | Format-Table -AutoSize | Out-String -Width 400

    if ($sawHealthyAfterDisabled) {
        Write-Host "RECONNECT_RECOVERED" -ForegroundColor Green
    } else {
        Write-Host "RECONNECT_NOT_OBSERVED" -ForegroundColor Yellow
    }
}

$hasRedisQuotaError = $results | Where-Object { $_.redisQuotaError -eq $true }
if ($hasRedisQuotaError) {
    Write-Host "REDIS_QUOTA_ERROR_FOUND" -ForegroundColor Red
    exit 2
}

$failed = $results | Where-Object { $_.ok -eq $false }
if ($failed) {
    Write-Host "TESTS_COMPLETED_WITH_FAILURES" -ForegroundColor Yellow
    exit 1
}

Write-Host "ALL_TESTS_PASSED" -ForegroundColor Green
exit 0
