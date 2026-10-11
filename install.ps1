# CyberManju OS — universal `cyb` installer for native Windows PowerShell.
#   irm https://cybermanju.github.io/install.ps1 | iex
# Checksum-verified against the release SHA256SUMS.
#
# Env knobs: $env:CYB_VERSION (release tag, default latest),
#            $env:INSTALL_DIR (default $env:LOCALAPPDATA\cybermanju\bin)
$ErrorActionPreference = 'Stop'

$Repo = if ($env:CYB_REPO) { $env:CYB_REPO } else { 'cybermanju/cybermanju.github.io' }
$InstallDir = if ($env:INSTALL_DIR) { $env:INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'cybermanju\bin' }
$WantVersion = if ($env:CYB_VERSION) { $env:CYB_VERSION } else { 'latest' }

if ([Net.ServicePointManager]::SecurityProtocol -notmatch 'Tls12') {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
}

if ($WantVersion -eq 'latest') {
  Write-Host '◈ resolving latest release…'
  $rel = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest"
  $Tag = $rel.tag_name
  if (-not $Tag) { throw 'could not resolve the latest release' }
} else {
  $Tag = $WantVersion
}

$Arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'amd64' }
$Asset = "cyb-windows-$Arch.tar.gz"
$Base = "https://github.com/$Repo/releases/download/$Tag"
$Tmp = Join-Path ([IO.Path]::GetTempPath()) ("cyb-install-" + [Guid]::NewGuid().ToString('N')))
New-Item -ItemType Directory -Path $Tmp | Out-Null
try {
  Write-Host "◈ installing cyb $Tag (windows/$Arch)…"
  Invoke-WebRequest "$Base/$Asset" -OutFile (Join-Path $Tmp $Asset)
  Invoke-WebRequest "$Base/SHA256SUMS.txt" -OutFile (Join-Path $Tmp 'SHA256SUMS.txt')

  $wantLine = Select-String -Path (Join-Path $Tmp 'SHA256SUMS.txt') -Pattern ([regex]::Escape($Asset)) | Select-Object -First 1
  if (-not $wantLine) { throw "no checksum entry for $Asset" }
  $wantSum = ($wantLine.Line -split '\s+')[0]
  $gotSum = (Get-FileHash (Join-Path $Tmp $Asset) -Algorithm SHA256).Hash.ToLower()
  if ($gotSum -ne $wantSum.ToLower()) { throw "checksum mismatch for $Asset (integrity: refusing to install)" }
  Write-Host '◈ checksum verified'

  # tar ships inbox on Windows 10+ and handles .tar.gz.
  tar -xzf (Join-Path $Tmp $Asset) -C $Tmp
  $bin = Join-Path $Tmp 'cyb.exe'
  if (-not (Test-Path $bin)) { throw 'tarball contains no cyb.exe' }

  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
  Copy-Item $bin (Join-Path $InstallDir 'cyb.exe') -Force

  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ($userPath -notlike "*$InstallDir*") {
    [Environment]::SetEnvironmentVariable('Path', "$userPath;$InstallDir", 'User')
    Write-Host "→ added to user PATH (restart the terminal): $InstallDir"
  }
  Write-Host "◈ installed: $(Join-Path $InstallDir 'cyb.exe')"
  Write-Host '→ start here:  cyb setup'
} finally {
  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
}
