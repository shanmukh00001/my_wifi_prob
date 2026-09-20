# install.ps1
# 1-Click setup script for IIT(ISM) Wi-Fi Auto Login

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  IIT(ISM) Wi-Fi Auto Login Setup        " -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Node.js is not installed or not in PATH." -ForegroundColor Red
    Write-Host "Please install Node.js (LTS version) from https://nodejs.org and try again." -ForegroundColor Yellow
    exit 1
}

# 2. Install dependencies
Write-Host "📦 Installing npm dependencies..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to install npm dependencies." -ForegroundColor Red
    exit 1
}

# 3. Store credentials securely
Write-Host ""
Write-Host "🔐 Configuring your IIT(ISM) credentials..." -ForegroundColor Yellow
node index.js --setup
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Credential setup aborted." -ForegroundColor Red
    exit 1
}

# 4. Register Windows Scheduled Task
Write-Host ""
Write-Host "⚙️ Creating Windows background task..." -ForegroundColor Yellow

$TaskName = "wifi_auto_login"
$ScriptPath = Join-Path $PSScriptRoot "index.js"
$NodePath = (Get-Command node).Source

# Stop existing task if running
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue 2>$null
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue 2>$null

# Define Action
$Action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -Command `\"& '$NodePath' '$ScriptPath'`\"" `
    -WorkingDirectory $PSScriptRoot

# Define Trigger (at logon of current user)
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# Define Settings (resilient background execution)
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Days 9999) `
    -Priority 7

# Register Task
Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Description "IIT(ISM) Dhanbad Wi-Fi Auto Login Background Monitor" `
    -User $env:USERNAME | Out-Null

# 5. Start task immediately
Start-ScheduledTask -TaskName $TaskName
Write-Host ""
Write-Host "✅ Setup completed successfully!" -ForegroundColor Green
Write-Host "🚀 The daemon is now running in the background and will auto-start every time you open your laptop." -ForegroundColor Green
Write-Host ""
Write-Host "Helpful commands:"
Write-Host "  View live logs : Get-Content logs/wifi-auto.log -Tail 15 -Wait"
Write-Host "  Stop daemon    : node index.js --stop"
Write-Host "  Check status   : node index.js --check"
