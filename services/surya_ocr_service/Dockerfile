# ============================================
# Surya OCR 服务 Dockerfile
# 支持 CPU 和 GPU 两种构建模式
# ============================================

# 构建参数：选择 torch 版本
# docker build --build-arg TORCH_VERSION=cpu .        # CPU 版本
# docker build --build-arg TORCH_VERSION=cu118 .      # CUDA 11.8
# docker build --build-arg TORCH_VERSION=cu121 .      # CUDA 12.1
ARG TORCH_VERSION=cpu

# ==========================================
# CPU 版本基础镜像（已包含 Python 3.11）
# ==========================================
FROM python:3.11-slim AS base-cpu

# ==========================================
# GPU 版本基础镜像（需要安装 Python）
# ==========================================
FROM nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04 AS base-cu118
FROM nvidia/cuda:12.1.0-cudnn8-runtime-ubuntu22.04 AS base-cu121

# ==========================================
# CPU 版本构建
# ==========================================
FROM base-cpu AS build-cpu

WORKDIR /app

# 安装系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 复制依赖文件
COPY requirements.txt .

# 安装 CPU 版本 PyTorch 和依赖
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt

# 复制应用代码
COPY . .

# 创建输出目录
RUN mkdir -p /app/out/surya_jobs /app/out/chroma_db

# 暴露端口
EXPOSE 8765

# 环境变量
ENV PYTHONUNBUFFERED=1 \
    SURYA_MAX_WORKERS=2

# 启动命令
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8765"]

# ==========================================
# GPU 版本构建（CUDA 11.8）
# ==========================================
FROM base-cu118 AS build-cu118

WORKDIR /app

# 安装 Python 和系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 \
    python3.11-venv \
    python3-pip \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.11 /usr/bin/python \
    && ln -sf /usr/bin/pip3 /usr/bin/pip

# 复制依赖文件
COPY requirements.txt .

# 安装 CUDA 11.8 版本 PyTorch 和依赖
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cu118 \
    && pip install --no-cache-dir -r requirements.txt

# 复制应用代码
COPY . .

# 创建输出目录
RUN mkdir -p /app/out/surya_jobs /app/out/chroma_db

# 暴露端口
EXPOSE 8765

# 环境变量
ENV PYTHONUNBUFFERED=1 \
    SURYA_MAX_WORKERS=4 \
    CUDA_VISIBLE_DEVICES=all

# 启动命令
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8765"]

# ==========================================
# GPU 版本构建（CUDA 12.1）
# ==========================================
FROM base-cu121 AS build-cu121

WORKDIR /app

# 安装 Python 和系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 \
    python3.11-venv \
    python3-pip \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.11 /usr/bin/python \
    && ln -sf /usr/bin/pip3 /usr/bin/pip

# 复制依赖文件
COPY requirements.txt .

# 安装 CUDA 12.1 版本 PyTorch 和依赖
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cu121 \
    && pip install --no-cache-dir -r requirements.txt

# 复制应用代码
COPY . .

# 创建输出目录
RUN mkdir -p /app/out/surya_jobs /app/out/chroma_db

# 暴露端口
EXPOSE 8765

# 环境变量
ENV PYTHONUNBUFFERED=1 \
    SURYA_MAX_WORKERS=4 \
    CUDA_VISIBLE_DEVICES=all

# 启动命令
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8765"]

# ==========================================
# 最终镜像选择（根据 TORCH_VERSION 参数）
# ==========================================
FROM build-${TORCH_VERSION} AS runtime