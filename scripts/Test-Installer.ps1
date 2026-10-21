[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$InstallerPath,
    [Parameter(Mandatory)]
    [string]$TestDirectory
)

$ErrorActionPreference = 'Stop'
$InstallerPath = (Resolve-Path -LiteralPath $InstallerPath).Path
$TestDirectory = [IO.Path]::GetFullPath($TestDirectory)
$installDirectory = Join-Path $TestDirectory 'app'
if (Test-Path -LiteralPath $TestDirectory) { throw 'Installer test requires a fresh test directory.' }
if (Get-ScheduledTask -TaskName ZeusDisplay -ErrorAction SilentlyContinue) {
    throw 'An existing ZeusDisplay task is present. Run this check on a clean Windows runner.'
}
New-Item -ItemType Directory -Path $TestDirectory | Out-Null

try {
    $setup = Start-Process -FilePath $InstallerPath -ArgumentList @(
        '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/TASKS=startup',
        ('/DIR="{0}"' -f $installDirectory), ('/LOG="{0}"' -f (Join-Path $TestDirectory 'install.log'))
    ) -WindowStyle Hidden -Wait -PassThru
    if ($setup.ExitCode -ne 0) { throw "Silent setup failed: $($setup.ExitCode). See install.log." }

    foreach ($file in @('ZeusDisplay.exe', 'coreclr.dll', 'hostfxr.dll', 'wwwroot\index.html', 'wwwroot\dashboard.css', 'wwwroot\dashboard.js', 'wwwroot\assets\app-icon.png', 'installer\Startup.ps1', 'unins000.exe')) {
        if (-not (Test-Path -LiteralPath (Join-Path $installDirectory $file))) { throw "Installed file missing: $file" }
    }
    $task = Get-ScheduledTask -TaskName ZeusDisplay
    if ($task.Actions.Execute -ne (Join-Path $installDirectory 'ZeusDisplay.exe') -or
        $task.Actions.Arguments -ne '--tray' -or
        $task.Principal.RunLevel -ne 'Highest' -or
        $task.Principal.LogonType -ne 'Interactive' -or
        $task.Settings.ExecutionTimeLimit -ne 'PT0S' -or
        $task.Triggers.Delay -ne 'PT10S' -or
        -not $task.Settings.Enabled) { throw 'Startup task was not configured correctly.' }

    # Rerunning setup without startup must remove its task rather than leave it enabled.
    $reinstall = Start-Process -FilePath $InstallerPath -ArgumentList @(
        '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/TASKS=',
        ('/DIR="{0}"' -f $installDirectory), ('/LOG="{0}"' -f (Join-Path $TestDirectory 'reinstall.log'))
    ) -WindowStyle Hidden -Wait -PassThru
    if ($reinstall.ExitCode -ne 0) { throw "Setup without startup failed: $($reinstall.ExitCode)." }
    if (Get-ScheduledTask -TaskName ZeusDisplay -ErrorAction SilentlyContinue) { throw 'Disabling startup left its task registered.' }

    # Restore startup so uninstall is also checked against a registered task.
    & (Join-Path $installDirectory 'installer\Startup.ps1') -Action Install -InstallDirectory $installDirectory
} finally {
    $uninstaller = Join-Path $installDirectory 'unins000.exe'
    if (Test-Path -LiteralPath $uninstaller) {
        $uninstall = Start-Process -FilePath $uninstaller -ArgumentList @(
            '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART',
            ('/LOG="{0}"' -f (Join-Path $TestDirectory 'uninstall.log'))
        ) -WindowStyle Hidden -Wait -PassThru
        if ($uninstall.ExitCode -ne 0) { throw "Silent uninstall failed: $($uninstall.ExitCode). See uninstall.log." }
    }
}
if (Get-ScheduledTask -TaskName ZeusDisplay -ErrorAction SilentlyContinue) { throw 'Uninstall left the startup task registered.' }
if (Test-Path -LiteralPath (Join-Path $installDirectory 'ZeusDisplay.exe')) { throw 'Uninstall left the application executable behind.' }
Write-Output 'PASS: setup files, elevated startup, disabling startup, and uninstall cleanup.'
