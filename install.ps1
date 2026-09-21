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

# 4. Create Windows Startup shortcut (Ensures 100% startup persistence across reboots, lid open, and battery changes)
Write-Host ""
Write-Host "⚙️ Registering Windows Startup..." -ForegroundColor Yellow
$WshShell = New-Object -ComObject WScript.Shell
$StartupFolder = [System.Environment]::GetFolderPath('Startup')
$VbsPath = Join-Path $PSScriptRoot "wifi_auto_login.vbs"
$Shortcut = $WshShell.CreateShortcut("$StartupFolder\wifi_auto_login.lnk")
$Shortcut.TargetPath = "wscript.exe"
$Shortcut.Arguments = "`"$VbsPath`""
$Shortcut.WorkingDirectory = $PSScriptRoot
$Shortcut.WindowStyle = 7
$Shortcut.Save()

# 5. Also register Task Scheduler for redundancy
$TaskName = "wifi_auto_login"
$ScriptPath = Join-Path $PSScriptRoot "index.js"
$NodePath = (Get-Command node).Source

try {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue 2>$null
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue 2>$null

    $arg = "-NoProfile -NonInteractive -WindowStyle Hidden -Command ""& '$NodePath' '$ScriptPath'"""
    $Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arg -WorkingDirectory $PSScriptRoot
    $Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Days 9999) -Priority 7

    Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description "IIT(ISM) Dhanbad Wi-Fi Auto Login Background Monitor" -User $env:USERNAME -Force -ErrorAction SilentlyContinue | Out-Null
    Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue 2>$null
} catch {
    # If Task Scheduler requires elevated permissions, Startup shortcut covers it completely
}

# 6. Start the daemon now if not running
node index.js --stop 2>$null
Start-Process -FilePath "wscript.exe" -ArgumentList "`"$VbsPath`"" -WorkingDirectory $PSScriptRoot

Write-Host ""
Write-Host "✅ Setup completed successfully!" -ForegroundColor Green
Write-Host "🚀 The daemon is now running in the background and will auto-start every time you turn on or open your laptop." -ForegroundColor Green
Write-Host ""
Write-Host "Helpful commands:"
Write-Host "  View live logs : Get-Content logs/wifi-auto.log -Tail 15 -Wait"
Write-Host "  Stop daemon    : node index.js --stop"
Write-Host "  Check status   : node index.js --check"
