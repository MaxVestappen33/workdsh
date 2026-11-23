# 本地技能缺失（只显示 diagnose-windows-sandbox-acl）现场诊断
# 用法：右键 PowerShell「以管理员身份运行」后执行
#   powershell -ExecutionPolicy Bypass -File .\诊断-本地技能缺失.ps1 -InstallDir "D:\software_install\PoliceAssistant"
# 脚本只读，不改任何文件；结果同时打印并写入桌面 技能诊断-<时间>.txt
param(
  [Parameter(Mandatory = $true)][string]$InstallDir
)
$ErrorActionPreference = 'Continue'
$report = Join-Path ([Environment]::GetFolderPath('Desktop')) ("技能诊断-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + ".txt")
$lines = New-Object System.Collections.Generic.List[string]
function Say($text) { $lines.Add([string]$text); Write-Host $text }
function Exists($path) { if (Test-Path -LiteralPath $path) { '存在' } else { '缺失' } }
function Count-Items($path, $pattern = '*') {
  if (-not (Test-Path -LiteralPath $path)) { return '目录缺失' }
  try { (Get-ChildItem -LiteralPath $path -Filter $pattern -ErrorAction Stop).Count } catch { '读取失败' }
}

Say "===== 1. 安装目录与版本 ====="
Say "安装目录: $InstallDir"
$exe = Join-Path $InstallDir 'PoliceAssistant.exe'
if (Test-Path -LiteralPath $exe) {
  $info = (Get-Item -LiteralPath $exe).VersionInfo
  Say "exe 文件版本: $($info.ProductVersion)  (FileVersion: $($info.FileVersion))"
} else { Say "exe: 缺失（目录不对？）" }
$releaseFile = Join-Path $InstallDir 'resources\workdsh-runtime\profiles\workdsh\.workdsh-desktop-release.json'
if (Test-Path -LiteralPath $releaseFile) {
  try {
    $release = Get-Content -LiteralPath $releaseFile -Raw | ConvertFrom-Json
    Say "运行时 release.version: $($release.release.version)"
    Say "运行时 release.sourceCommit: $($release.release.sourceCommit)  dirty=$($release.release.sourceDirty)"
    Say "installerVersion: $($release.release.installerVersion)"
  } catch { Say "release 清单解析失败: $($_.Exception.Message)" }
} else { Say "release 清单: 缺失" }

$runtime = Join-Path $InstallDir 'resources\workdsh-runtime'
Say ''
Say "===== 2. 随包技能载荷（决定“本地技能”应有多少个） ====="
$office = Join-Path $runtime 'office-skills'
Say "office-skills 目录: $(Exists $office)"
Say "  office 技能数(SKILL.md): $(Count-Items $office 'SKILL.md')"
if (Test-Path -LiteralPath $office) {
  Say ("  子目录: " + ((Get-ChildItem -LiteralPath $office -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name) -join ', '))
}
$modules = Join-Path $runtime 'profiles\workdsh\node_modules'
foreach ($pkg in @('@deepseek-ai\dsh-skill', '@deepseek-ai\dsh-skill-office', '@deepseek-ai\dsh-sandbox-windows-acl', 'workdsh-plugin-skills', 'workdsh-plugin-experts')) {
  $dir = Join-Path $modules $pkg
  Say "$pkg : $(Exists $dir)"
  $pkgJson = Join-Path $dir 'package.json'
  if (Test-Path -LiteralPath $pkgJson) {
    try { Say "  版本: $((Get-Content -LiteralPath $pkgJson -Raw | ConvertFrom-Json).version)" } catch { Say "  版本: 解析失败" }
  }
}
$skillsRes = Join-Path $modules 'workdsh-plugin-skills\resources\skills'
Say "workdsh-plugin-skills\resources\skills : $(Exists $skillsRes)"
if (Test-Path -LiteralPath $skillsRes) {
  Say ("  内置技能目录: " + ((Get-ChildItem -LiteralPath $skillsRes -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name) -join ', '))
}
$officeLib = Join-Path $modules '@deepseek-ai\dsh-skill-office\lib\index.js'
Say "dsh-skill-office\lib\index.js : $(Exists $officeLib)"
Say "primary-runtime: $(Exists (Join-Path $runtime 'primary-runtime'))"
Say "package-cache: $(Exists (Join-Path $runtime 'package-cache'))"

Say ''
Say "===== 3. 用户数据目录（真正决定列表里有什么） ====="
$userData = Join-Path $env:APPDATA 'PoliceAssistant'
Say "userData: $userData ($(Exists $userData))"
$envReady = Join-Path $userData '.workdsh-env-ready'
if (Test-Path -LiteralPath $envReady) { Say "环境就绪标记: $((Get-Content -LiteralPath $envReady -Raw).Trim())" } else { Say "环境就绪标记: 缺失" }
$dshHome = Join-Path $userData 'dsh-home'
$agentsSkills = Join-Path $dshHome 'agents\skills'
Say "dsh-home: $(Exists $dshHome)"
Say "agents\skills 下的技能: $(Count-Items $agentsSkills)"
if (Test-Path -LiteralPath $agentsSkills) {
  Say ("  技能名: " + ((Get-ChildItem -LiteralPath $agentsSkills -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name) -join ', '))
}
$stateSkills = Join-Path $dshHome 'agents\.workdsh-state\skills'
Say "state 目录: $(Exists $stateSkills)"
foreach ($f in @('client-builtin-reconcile.json', 'market-installs.json')) {
  $p = Join-Path $stateSkills $f
  if (Test-Path -LiteralPath $p) { Say "  $f : $((Get-Content -LiteralPath $p -Raw) -replace '\s+', ' ')" } else { Say "  $f : 缺失" }
}
$profileManifest = Join-Path $dshHome 'profiles\workdsh\package.json'
if (Test-Path -LiteralPath $profileManifest) {
  Say "home profile package.json 存在；bundles: $(try { ((Get-Content -LiteralPath $profileManifest -Raw | ConvertFrom-Json).dsh.profile.bundles -join ',') } catch { '解析失败' })"
} else { Say "home profile package.json: 缺失" }
Say "home profile node_modules: $(Exists (Join-Path $dshHome 'profiles\workdsh\node_modules'))"

Say ''
Say "===== 4. Host 日志里的失败线索 ====="
$logs = Join-Path $userData 'logs'
if (Test-Path -LiteralPath $logs) {
  $files = Get-ChildItem -LiteralPath $logs -Filter 'host-output*.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
  if ($files) {
    Say "最新日志: $($files[0].FullName)"
    Say "--- 关键行 ---"
    Select-String -LiteralPath $files[0].FullName -Pattern 'skipping profile bundle|skill provider|fatal load failure|技能|plugin' -ErrorAction SilentlyContinue |
      ForEach-Object { Say $_.Line }
    Say "--- 末 15 行 ---"
    Get-Content -LiteralPath $files[0].FullName -Tail 15 -ErrorAction SilentlyContinue | ForEach-Object { Say $_ }
  } else { Say "未找到 host-output*.log" }
} else { Say "logs 目录缺失" }

Say ''
Say "===== 5. 其它安装位置对照 ====="
$registryRoots = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)
foreach ($rootKey in $registryRoots) {
  Get-ChildItem $rootKey -ErrorAction SilentlyContinue | ForEach-Object {
    $item = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
    if ($item.DisplayName -like '*警务助手*' -or $item.DisplayName -like '*PoliceAssistant*') {
      Say "注册表安装记录: $($item.DisplayName) $($item.DisplayVersion) -> $($item.InstallLocation)"
    }
  }
}

$lines | Set-Content -LiteralPath $report -Encoding UTF8
Write-Host ""
Write-Host "诊断结果已保存: $report"
