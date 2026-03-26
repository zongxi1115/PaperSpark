# ============================================
# Surya OCR 服务 Dockerfile
# 统一 CPU / GPU 依赖栈，避免与主线运行时漂移
# ============================================
#
# 使用方式：
#   docker build --build-arg TORCH_CHANNEL=cpu   -t paperspark-surya:cpu .
#   docker build --build-arg TORCH_CHANNEL=cu126 -t paperspark-surya:gpu-cu126 .
#
# 说明：
# - CPU 版本可用于 linux/amd64 和 linux/arm64
# - GPU 版本面向 linux/amd64 + NVIDIA Container Toolkit
# ============================================

FROM python:3.11-slim

ARG TORCH_CHANNEL=cpu
ARG TORCH_VERSION=2.7.1
ARG TORCHVISION_VERSION=0.22.1
ARG TORCHAUDIO_VERSION=2.7.1

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    SURYA_MAX_WORKERS=2 \
    SURYA_EXECUTION_BACKEND=python

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libglib2.0-0 \
    libgl1 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./

RUN python -m pip install --upgrade pip setuptools wheel

RUN python -m pip install \
    torch==${TORCH_VERSION} \
    torchvision==${TORCHVISION_VERSION} \
    torchaudio==${TORCHAUDIO_VERSION} \
    --index-url https://download.pytorch.org/whl/${TORCH_CHANNEL}

RUN python -m pip install -r requirements.txt

COPY . ./

RUN mkdir -p /app/out/surya_jobs /app/out/chroma_db /app/out/surya_service

EXPOSE 8765

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8765"]
