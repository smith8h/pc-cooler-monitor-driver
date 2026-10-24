; Inno Setup script. CI builds two installers from it:
;   ISCC /DAppVersion=1.0.0 installer\ZeusDisplay.iss          full installer: bundles .NET, works offline
;   ISCC /DAppVersion=1.0.0 /DLite installer\ZeusDisplay.iss   lite installer: uses the installed .NET 10 Desktop Runtime
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#define AppName "Zeus Display"
#define AppExe  "ZeusDisplay.exe"
#ifdef Lite
  #define PublishDir "..\publish-lite"
  #define SetupName  "ZeusDisplay-Lite-Setup-" + AppVersion
#else
  #define PublishDir "..\publish"
  #define SetupName  "ZeusDisplay-Setup-" + AppVersion
#endif

[Setup]
AppId={{4EC1C59C-4CCA-475D-B7C7-BE3EA5E03767}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=smith8h
AppPublisherURL=https://github.com/smith8h/zeus-display
DefaultDirName={autopf}\ZeusDisplay
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\{#AppExe}
OutputDir=..\dist
OutputBaseFilename={#SetupName}
Compression=lzma2/ultra64
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
WizardStyle=modern
InfoAfterFile=after-install.txt

[InstallDelete]
; Clean upgrade: remove files from an older version or from the other installer type before copying.
Type: files; Name: "{app}\*.dll"
Type: files; Name: "{app}\*.json"
Type: filesandordirs; Name: "{app}\wwwroot"
Type: filesandordirs; Name: "{app}\runtimes"

[Files]
Source: "{#PublishDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"

[Run]
; The dashboard window needs the Edge WebView2 Runtime (already present on most Windows 10/11 PCs).
Filename: "{cmd}"; Parameters: "/C winget install --id Microsoft.EdgeWebView2Runtime -e --silent --accept-package-agreements --accept-source-agreements"; Flags: runhidden waituntilterminated; StatusMsg: "Installing the Microsoft Edge WebView2 Runtime..."; Check: not WebView2Installed
#ifdef Lite
; The lite build uses a shared .NET runtime instead of bundling its own.
Filename: "{cmd}"; Parameters: "/C winget install --id Microsoft.DotNet.DesktopRuntime.10 -e --silent --accept-package-agreements --accept-source-agreements"; Flags: runhidden waituntilterminated; StatusMsg: "Installing the .NET 10 Desktop Runtime..."; Check: not DesktopRuntimeInstalled
#endif
; Start silently in the tray at every logon, elevated (needed to read CPU temperature).
Filename: "{sys}\schtasks.exe"; Parameters: "/Create /TN ""ZeusDisplay"" /TR ""\""{app}\{#AppExe}\"" --tray"" /SC ONLOGON /DELAY 0000:15 /RL HIGHEST /F"; Flags: runhidden waituntilterminated; StatusMsg: "Creating the startup task..."
; Offer to start it now.
Filename: "{app}\{#AppExe}"; Description: "Start {#AppName} now"; Flags: nowait postinstall skipifsilent runascurrentuser; Check: RuntimeReady

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM {#AppExe}"; Flags: runhidden; RunOnceId: "KillZeusDisplay"
Filename: "{sys}\schtasks.exe"; Parameters: "/Delete /TN ""ZeusDisplay"" /F"; Flags: runhidden; RunOnceId: "DeleteZeusTask"

[Code]
const
  WebView2Key = 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

function WebView2Installed: Boolean;
var
  Version: String;
begin
  Result := RegQueryStringValue(HKLM32, WebView2Key, 'pv', Version) or
            RegQueryStringValue(HKCU, WebView2Key, 'pv', Version);
  Result := Result and (Version <> '') and (Version <> '0.0.0.0');
end;

#ifdef Lite
function DesktopRuntimeInstalled: Boolean;
var
  Names: TArrayOfString;
  I: Integer;
begin
  Result := False;
  if RegGetValueNames(HKLM64, 'SOFTWARE\dotnet\Setup\InstalledVersions\x64\sharedfx\Microsoft.WindowsDesktop.App', Names) then
    for I := 0 to GetArrayLength(Names) - 1 do
      if Pos('10.', Names[I]) = 1 then
      begin
        Result := True;
        Exit;
      end;
end;
#endif

function RuntimeReady: Boolean;
begin
#ifdef Lite
  Result := DesktopRuntimeInstalled;
#else
  Result := True;
#endif
end;

// Close a running copy so its files can be replaced during an upgrade.
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM {#AppExe}', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := '';
end;

procedure CurPageChanged(CurPageID: Integer);
begin
#ifdef Lite
  if (CurPageID = wpFinished) and (not DesktopRuntimeInstalled) then
    MsgBox('The .NET 10 Desktop Runtime could not be installed automatically.' + #13#10 + #13#10 +
           'Install the x64 ".NET Desktop Runtime" from https://dotnet.microsoft.com/download/dotnet/10.0, ' +
           'or use the full installer, which needs nothing extra.', mbError, MB_OK);
#endif
end;
