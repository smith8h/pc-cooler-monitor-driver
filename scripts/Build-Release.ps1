[CmdletBinding()]
param(
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version = '1.0.0',
    [string]$InnoCompiler
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$publishDirectory = Join-Path $repositoryRoot 'artifacts\publish'
$releaseDirectory = Join-Path $repositoryRoot 'artifacts\release'
$dependencyDirectory = Join-Path $repositoryRoot 'artifacts\dependencies'

if (-not $InnoCompiler) {
    $compilerCandidates = @(
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
        "$env:ProgramFiles\Inno Setup 7\ISCC.exe",
        "${env:ProgramFiles(x86)}\Inno Setup 7\ISCC.exe"
    )
    $InnoCompiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $InnoCompiler -or -not (Test-Path -LiteralPath $InnoCompiler)) {
    throw 'Install Inno Setup 6.3 or later, or pass -InnoCompiler with the full path to ISCC.exe.'
}

# Only clear these two known directories under this repository's artifacts folder.
foreach ($buildDirectory in @($publishDirectory, $releaseDirectory)) {
    $resolvedBuildDirectory = [IO.Path]::GetFullPath($buildDirectory)
    $expectedArtifactRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot 'artifacts')) + [IO.Path]::DirectorySeparatorChar
    if (-not $resolvedBuildDirectory.StartsWith($expectedArtifactRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Build output is outside the artifacts directory: $resolvedBuildDirectory"
    }
    if (Test-Path -LiteralPath $resolvedBuildDirectory) { Remove-Item -LiteralPath $resolvedBuildDirectory -Recurse -Force }
    New-Item -ItemType Directory -Path $resolvedBuildDirectory -Force | Out-Null
}
New-Item -ItemType Directory -Path $dependencyDirectory -Force | Out-Null

dotnet publish (Join-Path $repositoryRoot 'ZeusDisplay.csproj') --configuration Release --runtime win-x64 `
    --self-contained true --output $publishDirectory "-p:Version=$Version" -p:PublishTrimmed=false
if ($LASTEXITCODE -ne 0) { throw 'Application publish failed.' }

# Bundle Microsoft's signed Evergreen bootstrapper. It only installs WebView2 when absent.
# https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution
$bootstrapperPath = Join-Path $dependencyDirectory 'MicrosoftEdgeWebview2Setup.exe'
Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $bootstrapperPath -UseBasicParsing
$signature = Get-AuthenticodeSignature -LiteralPath $bootstrapperPath
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(?:^|,\s*)O=Microsoft Corporation(?:,|$)') {
    throw 'WebView2 bootstrapper does not have a valid Microsoft signature.'
}

foreach ($requiredFile in @('ZeusDisplay.exe', 'coreclr.dll', 'hostfxr.dll', 'wwwroot\index.html', 'wwwroot\dashboard.css', 'wwwroot\dashboard.js', 'wwwroot\assets\app-icon.png', 'WebView2Loader.dll')) {
    if (-not (Test-Path -LiteralPath (Join-Path $publishDirectory $requiredFile))) {
        throw "Published package is missing: $requiredFile"
    }
}
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'README.md') -Destination $publishDirectory

& $InnoCompiler "/DAppVersion=$Version" "/DPublishDir=$publishDirectory" `
    "/DBootstrapperPath=$bootstrapperPath" "/DOutputDirectory=$releaseDirectory" `
    (Join-Path $repositoryRoot 'installer\ZeusDisplay.iss')
if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed.' }
$installerPath = Join-Path $releaseDirectory "ZeusDisplay-$Version-win-x64-Setup.exe"
if (-not (Test-Path -LiteralPath $installerPath)) { throw 'Installer output was not produced.' }
$checksum = Get-FileHash -LiteralPath $installerPath -Algorithm SHA256
'{0}  {1}' -f $checksum.Hash.ToLowerInvariant(), [IO.Path]::GetFileName($installerPath) |
    Set-Content -LiteralPath (Join-Path $releaseDirectory 'SHA256SUMS.txt') -Encoding ascii
Write-Output "Release files: $releaseDirectory"
