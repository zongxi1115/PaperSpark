# ============================================
# PaperSpark Docker 镜像构建与发布脚本
# ============================================
#
# 使用方式：
#   .\scripts\publish-docker.ps1 -DockerHubUsername yourname
#   .\scripts\publish-docker.ps1 -DockerHubUsername yourname -BuildGpu
#
# ============================================

param(
    [Parameter(Mandatory=$true)]
    [string]$DockerHubUsername,

    [string]$Version = "latest",

    # 是否构建 GPU 版本
    [switch]$BuildGpu = $false,

    # GPU CUDA 版本
    [string]$CudaVersion = "cu126"
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "PaperSpark Docker 镜像构建与发布" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查 Docker 是否运行
Write-Host "[1/5] 检查 Docker 环境..." -ForegroundColor Yellow
try {
    docker info | Out-Null
    Write-Host "  Docker 运行正常" -ForegroundColor Green
} catch {
    Write-Host "  错误: Docker 未运行，请先启动 Docker Desktop" -ForegroundColor Red
    exit 1
}

# 登录 Docker Hub
Write-Host ""
Write-Host "[2/5] 登录 Docker Hub..." -ForegroundColor Yellow
docker login
if ($LASTEXITCODE -ne 0) {
    Write-Host "  登录失败，请检查用户名和密码" -ForegroundColor Red
    exit 1
}
Write-Host "  登录成功" -ForegroundColor Green

# 构建前端镜像
Write-Host ""
Write-Host "[3/5] 构建 Next.js 前端镜像..." -ForegroundColor Yellow
Set-Location $PSScriptRoot\..
docker build -f Dockerfile.next -t "${DockerHubUsername}/paperspark-nextjs:${Version}" .
if ($LASTEXITCODE -ne 0) {
    Write-Host "  前端构建失败" -ForegroundColor Red
    exit 1
}
Write-Host "  前端构建完成: ${DockerHubUsername}/paperspark-nextjs:${Version}" -ForegroundColor Green

# 构建 OCR 后端镜像
Write-Host ""
Write-Host "[4/5] 构建 Surya OCR 后端镜像..." -ForegroundColor Yellow

# CPU 版本
Write-Host "  构建 CPU 版本..." -ForegroundColor Gray
docker build `
    --build-arg TORCH_CHANNEL=cpu `
    -f services/surya_ocr_service/Dockerfile `
    -t "${DockerHubUsername}/paperspark-surya:cpu" `
    -t "${DockerHubUsername}/paperspark-surya:${Version}-cpu" `
    services/surya_ocr_service

if ($LASTEXITCODE -ne 0) {
    Write-Host "  CPU 版本构建失败" -ForegroundColor Red
    exit 1
}
Write-Host "  CPU 版本构建完成" -ForegroundColor Green

# GPU 版本（可选）
if ($BuildGpu) {
    Write-Host "  构建 GPU 版本 (CUDA ${CudaVersion})..." -ForegroundColor Gray
    docker build `
        --build-arg TORCH_CHANNEL=$CudaVersion `
        -f services/surya_ocr_service/Dockerfile `
        -t "${DockerHubUsername}/paperspark-surya:gpu-${CudaVersion}" `
        -t "${DockerHubUsername}/paperspark-surya:${Version}-gpu-${CudaVersion}" `
        services/surya_ocr_service

    if ($LASTEXITCODE -ne 0) {
        Write-Host "  GPU 版本构建失败" -ForegroundColor Red
        exit 1
    }
    Write-Host "  GPU 版本构建完成" -ForegroundColor Green
}

# 推送镜像
Write-Host ""
Write-Host "[5/5] 推送镜像到 Docker Hub..." -ForegroundColor Yellow

Write-Host "  推送前端镜像..." -ForegroundColor Gray
docker push "${DockerHubUsername}/paperspark-nextjs:${Version}"

Write-Host "  推送 OCR CPU 镜像..." -ForegroundColor Gray
docker push "${DockerHubUsername}/paperspark-surya:cpu"
docker push "${DockerHubUsername}/paperspark-surya:${Version}-cpu"

if ($BuildGpu) {
    Write-Host "  推送 OCR GPU 镜像..." -ForegroundColor Gray
    docker push "${DockerHubUsername}/paperspark-surya:gpu-${CudaVersion}"
    docker push "${DockerHubUsername}/paperspark-surya:${Version}-gpu-${CudaVersion}"
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "发布完成！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "镜像列表:" -ForegroundColor White
Write-Host "  - ${DockerHubUsername}/paperspark-nextjs:${Version}" -ForegroundColor Gray
Write-Host "  - ${DockerHubUsername}/paperspark-surya:cpu" -ForegroundColor Gray
if ($BuildGpu) {
    Write-Host "  - ${DockerHubUsername}/paperspark-surya:gpu-${CudaVersion}" -ForegroundColor Gray
}
Write-Host ""
Write-Host "用户使用方法:" -ForegroundColor White
Write-Host "  1. 下载 deploy 目录" -ForegroundColor Gray
Write-Host "  2. 修改 docker-compose.yml 中的镜像名为你的镜像" -ForegroundColor Gray
Write-Host "  3. docker-compose up -d" -ForegroundColor Gray
