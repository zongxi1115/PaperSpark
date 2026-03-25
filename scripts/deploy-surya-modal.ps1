param(
  [ValidateSet("deploy", "serve")]
  [string]$Mode = "deploy",

  [string]$Python = "D:\miniconda\python.exe",
  [string]$AppName = "paperspark-surya",
  [string]$DataVolume = "paperspark-surya-data",
  [string]$ModelCacheVolume = "paperspark-surya-model-cache",
  [string]$Gpu = "L4"
)

$projectRoot = Split-Path -Parent $PSScriptRoot
$modulePath = Join-Path $projectRoot "services\surya_ocr_service\modal_service.py"

if (-not (Test-Path $Python)) {
  throw "Python 不存在: $Python"
}

if (-not (Test-Path $modulePath)) {
  throw "Modal 部署入口不存在: $modulePath"
}

$env:SURYA_MODAL_APP_NAME = $AppName
$env:SURYA_MODAL_DATA_VOLUME = $DataVolume
$env:SURYA_MODAL_MODEL_CACHE_VOLUME = $ModelCacheVolume
$env:SURYA_MODAL_GPU = $Gpu

Write-Host "使用 Python: $Python" -ForegroundColor Cyan
Write-Host "部署模式: $Mode" -ForegroundColor Cyan
Write-Host "Modal App: $AppName" -ForegroundColor Cyan
Write-Host "数据卷: $DataVolume" -ForegroundColor Cyan
Write-Host "模型缓存卷: $ModelCacheVolume" -ForegroundColor Cyan
Write-Host "GPU: $Gpu" -ForegroundColor Cyan
Write-Host ""
Write-Host "提示: 首次运行前请先在 base 环境安装 modal：" -ForegroundColor Yellow
Write-Host "  $Python -m pip install -r services/surya_ocr_service/requirements-modal.txt" -ForegroundColor Yellow
Write-Host ""

& $Python -m modal $Mode $modulePath
exit $LASTEXITCODE
