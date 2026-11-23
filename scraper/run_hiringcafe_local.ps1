# Local-only hiring.cafe scrape (Cloudflare blocks Render IPs).
# Scrapes from this machine and posts jobs to the deployed backend (BACKEND_URL in
# scraper\local.env), which writes to Supabase. No local backend / Postgres involved.
# Any failure sends a ntfy "FAILED" push so it can never be silent again.
$ErrorActionPreference = 'Continue'
$ScraperDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python     = 'C:\Users\hp\AppData\Local\Microsoft\WindowsApps\PythonSoftwareFoundation.Python.3.10_qbz5n2kfra8p0\python.exe'
$Log        = Join-Path $ScraperDir 'hiringcafe_local.log'

function Log($m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m" | Add-Content -Path $Log }

function Send-Failure($msg) {
    Log "FAILED: $msg"
    try {
        $topic = (Get-Content (Join-Path $ScraperDir 'notify_config.json') -Raw | ConvertFrom-Json).ntfy_topic
        if ($topic) {
            Invoke-RestMethod -Uri "https://ntfy.sh/$topic" -Method Post -Body $msg -TimeoutSec 10 `
                -Headers @{ Title = 'hiring.cafe check FAILED'; Tags = 'warning'; Priority = '4' } | Out-Null
        }
    } catch { Log "ntfy failure push also failed: $($_.Exception.Message)" }
}

# Load BACKEND_URL / APP_USERNAME / APP_PASSWORD from scraper\local.env (gitignored).
$envFile = Join-Path $ScraperDir 'local.env'
if (Test-Path $envFile) {
    foreach ($line in Get-Content $envFile) {
        if ($line -match '^\s*([A-Z_]+)\s*=\s*(.*?)\s*$' -and -not $line.TrimStart().StartsWith('#')) {
            Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2]
        }
    }
}
if (-not $env:BACKEND_URL)  { Send-Failure 'BACKEND_URL missing in scraper\local.env'; exit 4 }
if (-not $env:APP_PASSWORD) { Send-Failure 'APP_PASSWORD missing in scraper\local.env'; exit 4 }
if (-not $env:APP_USERNAME) { $env:APP_USERNAME = 'admin' }
$env:BACKEND_URL = $env:BACKEND_URL.TrimEnd('/')

# Render free plan sleeps when idle: poll /healthz until it answers (up to ~3 min).
$up = $false
$deadline = (Get-Date).AddMinutes(3)
while ((Get-Date) -lt $deadline) {
    try { Invoke-WebRequest -Uri "$($env:BACKEND_URL)/healthz" -UseBasicParsing -TimeoutSec 20 | Out-Null; $up = $true; break }
    catch { if ($_.Exception.Response) { $up = $true; break }; Start-Sleep -Seconds 5 }
}
if (-not $up) { Send-Failure "Backend $($env:BACKEND_URL) not reachable after 3 minutes"; exit 3 }

# Verify login up front so a bad password fails loudly instead of per-job warnings.
try {
    Invoke-RestMethod -Uri "$($env:BACKEND_URL)/api/auth/login" -Method Post -ContentType 'application/json' `
        -Body (@{ username = $env:APP_USERNAME; password = $env:APP_PASSWORD } | ConvertTo-Json) -TimeoutSec 20 | Out-Null
} catch { Send-Failure "Backend login failed: $($_.Exception.Message)"; exit 5 }

Set-Location $ScraperDir
& $Python 'hiringcafe_search.py'
$code = $LASTEXITCODE
Log "hiringcafe_search.py exit code $code"
if ($code -ne 0) { Send-Failure "hiringcafe_search.py exited with code $code" }
exit $code
