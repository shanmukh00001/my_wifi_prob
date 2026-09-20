# uninstall.ps1
# Uninstaller for IIT(ISM) Wi-Fi Auto Login

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  IIT(ISM) Wi-Fi Auto Login Uninstall    " -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

$TaskName = "wifi_auto_login"

# 1. Stop and remove scheduled task
Write-Host "🛑 Stopping and removing background task..." -ForegroundColor Yellow
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue 2>$null
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue 2>$null
node index.js --stop 2>$null

# 2. Clear credentials from Windows Credential Manager
Write-Host "🗑️ Clearing stored credentials from Windows Credential Vault..." -ForegroundColor Yellow
node index.js --clear

Write-Host ""
Write-Host "✅ Uninstalled successfully." -ForegroundColor Green
Write-Host "The background task and your saved credentials have been removed." -ForegroundColor Green
