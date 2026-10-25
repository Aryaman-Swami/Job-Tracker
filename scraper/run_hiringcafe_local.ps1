# Local-only hiring.cafe scrape (Cloudflare blocks Render IPs).
# 1) make sure the backend is up on :3000 (start the built jar hidden if not)
# 2) run hiringcafe_search.py with the Store Python.
$ErrorActionPreference = 'Continue'
$ScraperDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root       = Split-Path -Parent $ScraperDir
$Backend    = Join-Path $Root 'backend'
$Jar        = Join-Path $Backend 'target\job-tracker-backend.jar'
$Python     = 'C:\Users\hp\AppData\Local\Microsoft\WindowsApps\PythonSoftwareFoundation.Python.3.10_qbz5n2kfra8p0\python.exe'
$Log        = Join-Path $ScraperDir 'hiringcafe_local.log'
$BaseUrl    = 'http://localhost:3000'

function Log($m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m" | Add-Content -Path $Log }

function Test-Backend {
    # Any HTTP response (200/401/403/404...) means Spring is serving; connection errors mean down.
    try { Invoke-WebRequest -Uri "$BaseUrl/healthz" -UseBasicParsing -TimeoutSec 5 | Out-Null; return $true }
    catch { return [bool]$_.Exception.Response }
}

if (-not (Test-Backend)) {
    Log 'backend not reachable, starting it'
    if (-not (Test-Path $Jar)) { Log "jar not found: $Jar"; exit 2 }
    # Use JAVA_HOME's java directly: the Oracle javapath shim crashes (0xC0000409) when stdout is redirected.
    $java = $null
    if ($env:JAVA_HOME -and (Test-Path "$env:JAVA_HOME\bin\java.exe")) { $java = "$env:JAVA_HOME\bin\java.exe" }
    elseif (Test-Path 'C:\Program Files\Java\jdk-21.0.10\bin\java.exe') { $java = 'C:\Program Files\Java\jdk-21.0.10\bin\java.exe' }
    else { $java = (Get-Command java -ErrorAction SilentlyContinue).Source }
    if (-not $java) { Log 'java not found'; exit 2 }
    # Load DB_* / APP_* from scraper\local.env (gitignored) so the backend writes to Supabase.
    $envFile = Join-Path $ScraperDir 'local.env'
    if (Test-Path $envFile) {
        foreach ($line in Get-Content $envFile) {
            if ($line -match '^\s*([A-Z_]+)\s*=\s*(.*?)\s*$' -and -not $line.TrimStart().StartsWith('#')) {
                Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2]
            }
        }
    }
    if (-not $env:DB_HOST -or -not $env:DB_PASSWORD) {
        Log 'DB_HOST/DB_PASSWORD missing (fill scraper\local.env); refusing to start backend against local Postgres'
        exit 4
    }
    if (-not $env:APP_USERNAME) { $env:APP_USERNAME = 'admin' }
    if (-not $env:APP_PASSWORD) { $env:APP_PASSWORD = 'admin' }
    Start-Process -FilePath $java -ArgumentList @('-jar', "`"$Jar`"") -WorkingDirectory $Backend `
        -WindowStyle Hidden -RedirectStandardOutput (Join-Path $Backend 'backend_run.log') `
        -RedirectStandardError (Join-Path $Backend 'backend_run_err.log') | Out-Null
    $deadline = (Get-Date).AddMinutes(3)
    while ((Get-Date) -lt $deadline -and -not (Test-Backend)) { Start-Sleep -Seconds 3 }
    if (-not (Test-Backend)) { Log 'backend did not become ready within 3 minutes'; exit 3 }
    Log 'backend ready'
} else {
    Log 'backend already running'
}

Set-Location $ScraperDir
& $Python 'hiringcafe_search.py'
$code = $LASTEXITCODE
Log "hiringcafe_search.py exit code $code"
exit $code
