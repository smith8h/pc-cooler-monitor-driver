#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef PublishDir
  #define PublishDir SourcePath + "..\artifacts\publish"
#endif
#ifndef BootstrapperPath
  #define BootstrapperPath SourcePath + "..\artifacts\dependencies\MicrosoftEdgeWebview2Setup.exe"
#endif
#ifndef OutputDirectory
  #define OutputDirectory SourcePath + "..\artifacts\release"
#endif

[Setup]
AppId={{A38A0699-4777-4D4B-A372-AF7BB31B6DA5}
AppName=Zeus Display
AppVersion={#AppVersion}
AppPublisher=Zeus Display
DefaultDirName={autopf}\Zeus Display
DefaultGroupName=Zeus Display
DisableProgramGroupPage=yes
DisableWelcomePage=no
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19045
AppMutex=Global\ZeusDisplay.SingleInstance
SetupMutex=ZeusDisplay.Setup
SetupIconFile=..\Assets\app.ico
UninstallDisplayIcon={app}\ZeusDisplay.exe
WizardStyle=modern
Compression=lzma2
SolidCompression=yes
OutputDir={#OutputDirectory}
OutputBaseFilename=ZeusDisplay-{#AppVersion}-win-x64-Setup
VersionInfoVersion={#AppVersion}

[Tasks]
Name: "startup"; Description: "Start Zeus Display when I sign in to Windows"; GroupDescription: "Startup:"; Flags: checkedonce
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked

[Files]
Source: "{#PublishDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "Startup.ps1"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "{#BootstrapperPath}"; Flags: dontcopy

[Icons]
Name: "{autoprograms}\Zeus Display"; Filename: "{app}\ZeusDisplay.exe"
Name: "{autodesktop}\Zeus Display"; Filename: "{app}\ZeusDisplay.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\ZeusDisplay.exe"; Description: "Open Zeus Display"; Flags: nowait postinstall skipifsilent runascurrentuser

[Code]
function ValidRuntimeVersion(Root: Integer; const Key: String): Boolean;
var
  Version: String;
begin
  Result := RegQueryStringValue(Root, Key, 'pv', Version) and
    (Version <> '') and (Version <> '0.0.0.0');
end;

function HasWebView2: Boolean;
var
  Key: String;
begin
  Key := 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  Result := ValidRuntimeVersion(HKLM32, Key) or ValidRuntimeVersion(HKLM64, Key) or
    ValidRuntimeVersion(HKCU32, Key) or ValidRuntimeVersion(HKCU64, Key);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  if HasWebView2 then Exit;
  WizardForm.StatusLabel.Caption := 'Installing Microsoft Edge WebView2 Runtime...';
  ExtractTemporaryFile('MicrosoftEdgeWebview2Setup.exe');
  if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'), '/silent /install',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
  begin
    Result := 'Could not start WebView2 setup. Install Microsoft Edge WebView2 Runtime and try again.';
    Exit;
  end;
  if (ResultCode <> 0) and (ResultCode <> 3010) then
  begin
    Result := Format('WebView2 setup failed (exit code %d). Check your internet connection and try again.', [ResultCode]);
    Exit;
  end;
  NeedsRestart := ResultCode = 3010;
  if not HasWebView2 then
    Result := 'WebView2 Runtime was not detected after setup. Restart Windows or install it manually, then try again.';
end;

function ConfigureStartup(const Action: String): Boolean;
var
  ResultCode: Integer;
  Params: String;
begin
  Params := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
    ExpandConstant('{app}\installer\Startup.ps1') + '" -Action ' + Action +
    ' -InstallDirectory "' + ExpandConstant('{app}') + '"';
  Result := Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    Params, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  if Result then Result := ResultCode = 0;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    if WizardIsTaskSelected('startup') then
    begin
      if not ConfigureStartup('Install') then
        RaiseException('Could not enable Windows startup. Rerun setup as administrator to try again.');
    end
    else if not ConfigureStartup('Remove') then
      RaiseException('Could not remove the Windows startup task.');
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    if not ConfigureStartup('Remove') then
      RaiseException('Could not remove the ZeusDisplay startup task. Close Task Scheduler and retry uninstall.');
end;

procedure InitializeWizard;
begin
  WizardForm.WelcomeLabel2.Caption := 'Install Zeus Display and its required runtime components.' + #13#10 + #13#10 +
    'PawnIO is not included. Install PawnIO separately to enable CPU temperature readings.';
end;
