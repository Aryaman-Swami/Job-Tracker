# Daily heartbeat push: proves the phone -> ntfy path works even on days with no new jobs.
$ScraperDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$topic = (Get-Content (Join-Path $ScraperDir 'notify_config.json') -Raw | ConvertFrom-Json).ntfy_topic
if ($topic) {
    Invoke-RestMethod -Uri "https://ntfy.sh/$topic" -Method Post -Body 'Good morning' -TimeoutSec 15 `
        -Headers @{ Title = 'Job Tracker'; Tags = 'sunrise'; Priority = '2' } | Out-Null
}
