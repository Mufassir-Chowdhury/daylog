# Checks that an installed Electron daylog updates into the Tauri installer the
# way electron-updater runs it (`--updated /S --force-run`), on a Windows runner:
# the Electron copy is gone, the Tauri app is installed and running, the prefs
# survived, and "Start with Windows" now starts the Tauri app. Then updates the
# Tauri app the way its own updater does (`/S /UPDATE /R`).
#
#   pwsh desktop/test-migration.ps1 <new installer>
param([Parameter(Mandatory)][string]$Installer)

$ErrorActionPreference = 'Stop'
$electronDir = Join-Path $env:LOCALAPPDATA 'Programs\todo'
$tauriExe = Join-Path $env:LOCALAPPDATA 'daylog\daylog.exe'
$prefs = Join-Path $env:APPDATA 'daylog\desktop-prefs.json'
$runKey = 'Software\Microsoft\Windows\CurrentVersion\Run'
$failed = $false

function Check([bool]$ok, [string]$what) {
  if ($ok) { Write-Host "ok   $what" } else { Write-Host "FAIL $what"; $script:failed = $true }
}

function RunEntries {
  foreach ($hive in 'HKCU', 'HKLM') {
    $key = Get-Item "${hive}:\$runKey" -ErrorAction SilentlyContinue
    if ($key) {
      foreach ($name in $key.GetValueNames()) { "${hive}:$name=$($key.GetValue($name))" }
    }
  }
}

Write-Host '— Installing the last Electron release'
$old = Join-Path $env:RUNNER_TEMP 'daylog-electron-setup.exe'
Invoke-WebRequest 'https://github.com/Mufassir-Chowdhury/daylog/releases/download/desktop-v0.1.7/daylog-setup.exe' -OutFile $old
Start-Process $old -ArgumentList '/S' -Wait
Check (Test-Path "$electronDir\daylog.exe") 'Electron app installed'

Write-Host '— First run of the Electron app (writes prefs, turns on Start with Windows)'
Start-Process "$electronDir\daylog.exe" -ArgumentList '--hidden'
for ($i = 0; $i -lt 30 -and -not (Test-Path $prefs); $i++) { Start-Sleep 1 }
Start-Sleep 5
Check (Test-Path $prefs) 'Electron wrote its prefs'
$prefsBefore = Get-Content $prefs -Raw | ConvertFrom-Json
Write-Host "Run entries before: $((RunEntries) -join '; ')"

Write-Host '— Updating into the Tauri installer like electron-updater does'
Get-Process daylog -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2
Start-Process $Installer -ArgumentList '--updated', '/S', '--force-run' -Wait
Start-Sleep 15

Check (-not (Test-Path $electronDir)) 'Electron copy removed'
Check (Test-Path $tauriExe) 'Tauri app installed'
$running = Get-Process daylog -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $tauriExe }
Check ($null -ne $running) 'Tauri app relaunched (--force-run)'
$prefsAfter = Get-Content $prefs -Raw | ConvertFrom-Json
Check ($prefsAfter.summonKey -eq $prefsBefore.summonKey) 'hotkeys kept'
Check ($prefsAfter.electronMigrated -eq $true) 'one-time migration ran'
$entries = RunEntries
Write-Host "Run entries after: $($entries -join '; ')"
Check (-not ($entries | Where-Object { $_ -like '*\Programs\todo\*' })) 'Electron autostart entry removed'
$tauriEntry = $entries | Where-Object { $_ -like '*\daylog\daylog.exe*--hidden*' -and $_ -notlike '*\Programs\*' }
Check ($null -ne $tauriEntry) 'Tauri app starts with Windows'
try {
  $page = Invoke-WebRequest 'http://localhost:47615/' -UseBasicParsing -TimeoutSec 10
  Check ($page.StatusCode -eq 200) 'app served on http://localhost:47615'
} catch {
  Check $false "app served on http://localhost:47615 ($_)"
}

Write-Host '— Updating the running Tauri app like its own updater does'
$before = Get-Process daylog -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $tauriExe }
Start-Process $Installer -ArgumentList '/S', '/UPDATE', '/R' -Wait
Start-Sleep 10
$after = Get-Process daylog -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $tauriExe }
Check ($null -ne $after) 'Tauri app running again after its update'
Check ($null -eq $before -or $after.Id -ne $before.Id) 'Tauri app was restarted'

Get-Process daylog -ErrorAction SilentlyContinue | Stop-Process -Force
if ($failed) { exit 1 }
