[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Install', 'Remove', 'Validate')]
    [string]$Action,
    [Parameter(Mandatory)]
    [string]$InstallDirectory
)

$ErrorActionPreference = 'Stop'
$taskName = 'ZeusDisplay'
$executablePath = Join-Path ([IO.Path]::GetFullPath($InstallDirectory)) 'ZeusDisplay.exe'
$scheduler = New-Object -ComObject 'Schedule.Service'
$scheduler.Connect()
$taskFolder = $scheduler.GetFolder('\')

if ($Action -eq 'Remove') {
    # Only remove our own task, including when setup is rerun without startup selected.
    $existingTask = @($taskFolder.GetTasks(0)) | Where-Object Name -EQ $taskName
    if ($existingTask) {
        if ($existingTask.Definition.Actions.Item(1).Path -ne $executablePath) {
            throw 'The ZeusDisplay task belongs to another installation.'
        }
        $taskFolder.DeleteTask($taskName, 0)
    }
    return
}

if (-not (Test-Path -LiteralPath $executablePath -PathType Leaf)) {
    throw "Application executable not found: $executablePath"
}

$userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$definition = $scheduler.NewTask(0)
$definition.RegistrationInfo.Description = 'Start Zeus Display silently in the system tray at sign-in.'
$definition.Principal.UserId = $userSid
$definition.Principal.LogonType = 3 # TASK_LOGON_INTERACTIVE_TOKEN: tray is in the signed-in user's session.
$definition.Principal.RunLevel = 1 # TASK_RUNLEVEL_HIGHEST: hardware sensors require elevation.
$definition.Settings.Enabled = $true
$definition.Settings.DisallowStartIfOnBatteries = $false
$definition.Settings.StopIfGoingOnBatteries = $false
$definition.Settings.ExecutionTimeLimit = 'PT0S'
$definition.Settings.MultipleInstances = 2 # TASK_INSTANCES_IGNORE_NEW
$definition.Settings.StartWhenAvailable = $true
$trigger = $definition.Triggers.Create(9) # TASK_TRIGGER_LOGON
$trigger.UserId = $userSid
$trigger.Delay = 'PT10S'
$trigger.Enabled = $true
$taskAction = $definition.Actions.Create(0) # TASK_ACTION_EXEC
$taskAction.Path = $executablePath
$taskAction.Arguments = '--tray'
$taskAction.WorkingDirectory = [IO.Path]::GetDirectoryName($executablePath)

if ($Action -eq 'Validate') {
    # Build and validate the actual Task Scheduler definition without registering startup.
    $definition.XmlText
    return
}
$taskFolder.RegisterTaskDefinition($taskName, $definition, 6, $userSid, $null, 3, $null) | Out-Null
