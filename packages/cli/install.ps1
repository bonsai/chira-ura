# chira-ura CLI を Windows の PATH へ入れる（install.sh の Windows 版）
#   powershell -NoProfile -ExecutionPolicy Bypass -File cli\install.ps1
# 置く場所: %USERPROFILE%\.local\bin\chira.cmd （同ディレクトリは既 factored PATH 前提）
$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path   # ...\chira-ura\cli
$repo = Split-Path -Parent $here                          # ...\chira-ura
$bin  = Join-Path $env:USERPROFILE ".local\bin"

New-Item -ItemType Directory -Force -Path $bin | Out-Null

# 候補: インストール時の絶対パス → repo 内 cli → .crx → .skills の順で最初に見つかったものを使う
$cands = @(
  (Join-Path $repo "cli\cli.js"),
  "%~dp0..\..\.crx\chira-ura\cli\cli.js",
  "%~dp0..\..\.skills\chira-ura\cli\cli.js"
)
$abs = $cands[0]   # インストール時の絶対パス（batch 内で使う）

$shim = Join-Path $bin "chira.cmd"
$body = @"
@echo off
rem chira-ura CLI (Windows shim). repo: $abs
setlocal
set "CLI="
for %%P in (
  "$abs"
  "%~dp0..\..\.crx\chira-ura\cli\cli.js"
  "%~dp0..\..\.skills\chira-ura\cli\cli.js"
) do if not defined CLI if exist "%%~P" set "CLI=%%~P"
if not defined CLI (
  echo chira: cli.js not found. Run install.ps1 again, or set CHIRA_CLI. 1>&2
  exit /b 1
)
node "%CLI%" %*
"@
Set-Content -Path $shim -Value $body -Encoding ascii
Write-Host "installed (windows): $shim"

# PATH チェック（ユーザー PATH）
$userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($userPath -notlike "*$bin*") {
  $new = if ([string]::IsNullOrWhiteSpace($userPath)) { $bin } else { "$userPath;$bin" }
  [Environment]::SetEnvironmentVariable("PATH", $new, "User")
  Write-Host "added to user PATH: $bin  (open a new shell to pick it up)"
} else {
  Write-Host "already on user PATH: $bin"
}

& node (Join-Path $repo "cli\cli.js") path
