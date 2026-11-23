# Shared launcher for every locally scheduled scraper.
#  - loads scraper\local.env (BACKEND_URL, APP_USERNAME, APP_PASSWORD) so ALL scrapers
#    post to the hosted backend (-> Supabase) instead of localhost:3000
#  - wakes the Render backend (free plan sleeps) before starting
#  - runs the scraper with its output appended to a log; no console window of its own
# Started hidden by run_hidden.vbs. Usage: run_local.ps1 -Task wellfound|runscraper|naukri|instahyre
param([Parameter(Mandatory)][ValidateSet('wellfound','runscraper','workday','greenhouse','naukri','instahyre')][string]$Task)

$ErrorActionPreference = 'Continue'
$ScraperDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root       = Split-Path -Parent $ScraperDir
$Python     = 'C:\Users\hp\AppData\Local\Microsoft\WindowsApps\PythonSoftwareFoundation.Python.3.10_qbz5n2kfra8p0\python.exe'
$Node       = 'C:\Program Files\nodejs\node.exe'

switch ($Task) {
    'wellfound'  { $Exe = $Python; $Arg = 'wellfound_search.py';  $Dir = $ScraperDir; $Log = Join-Path $ScraperDir 'wellfound_local.log' }
    'runscraper' { $Exe = $Python; $Arg = 'run_scraper.py';       $Dir = $ScraperDir; $Log = Join-Path $ScraperDir 'runscraper_local.log' }
    'workday'    { $Exe = $Python; $Arg = 'workday_search.py';    $Dir = $ScraperDir; $Log = Join-Path $ScraperDir 'workday_local.log' }
    'greenhouse' { $Exe = $Python; $Arg = 'greenhouse_search.py'; $Dir = $ScraperDir; $Log = Join-Path $ScraperDir 'greenhouse_local.log' }
    'naukri'     { $Exe = $Node;   $Arg = 'scrape.js'; $Dir = Join-Path $Root 'naukri-scraper';    $Log = Join-Path $Root 'naukri-scraper\scrape_run.log' }
    'instahyre'  { $Exe = $Node;   $Arg = 'scrape.js'; $Dir = Join-Path $Root 'instahyre-scraper'; $Log = Join-Path $Root 'instahyre-scraper\scrape_run.log' }
}

function Log($m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [$Task] $m" | Add-Content -Path $Log }

function Send-Failure($msg) {
    Log "FAILED: $msg"
    try {
        $topic = (Get-Content (Join-Path $ScraperDir 'notify_config.json') -Raw | ConvertFrom-Json).ntfy_topic
        if ($topic) {
            Invoke-RestMethod -Uri "https://ntfy.sh/$topic" -Method Post -Body "${Task}: $msg" -TimeoutSec 10 `
                -Headers @{ Title = "$Task check FAILED"; Tags = 'warning'; Priority = '4' } | Out-Null
        }
    } catch { Log "ntfy failure push also failed: $($_.Exception.Message)" }
}

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

# Wake Render (up to ~3 min).
$up = $false
$deadline = (Get-Date).AddMinutes(3)
while ((Get-Date) -lt $deadline) {
    try { Invoke-WebRequest -Uri "$($env:BACKEND_URL)/healthz" -UseBasicParsing -TimeoutSec 20 | Out-Null; $up = $true; break }
    catch { if ($_.Exception.Response) { $up = $true; break }; Start-Sleep -Seconds 5 }
}
if (-not $up) { Send-Failure "Backend $($env:BACKEND_URL) not reachable after 3 minutes"; exit 3 }

Log "starting $Arg -> $($env:BACKEND_URL)"
$tmpOut = [IO.Path]::GetTempFileName(); $tmpErr = [IO.Path]::GetTempFileName()
$p = Start-Process -FilePath $Exe -ArgumentList $Arg -WorkingDirectory $Dir -WindowStyle Hidden -Wait -PassThru `
        -RedirectStandardOutput $tmpOut -RedirectStandardError $tmpErr
Get-Content $tmpOut, $tmpErr | Add-Content -Path $Log
Remove-Item $tmpOut, $tmpErr -ErrorAction SilentlyContinue
Log "$Arg exit code $($p.ExitCode)"
if ($p.ExitCode -ne 0) { Send-Failure "$Arg exited with code $($p.ExitCode)" }
exit $p.ExitCode
