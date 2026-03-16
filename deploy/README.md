# PaperSpark 部署指南

## 快速开始

### 1. 安装 Docker

- [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/)
- [Docker Engine for Linux](https://docs.docker.com/engine/install/)

### 2. 下载部署文件

```bash
# 克隆或下载 deploy 目录
git clone https://github.com/你的用户名/paperspark.git
cd paperspark/deploy
```

### 3. 配置环境变量

```bash
# 复制配置模板
cp .env.example .env

# 编辑 .env 文件，填写你的 API Key
```

### 4. 启动服务

```bash
# CPU 版本（默认）
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

### 5. 访问应用

打开浏览器访问 http://localhost:3000

---

## GPU 版本部署

### 前提条件

1. 服务器有 NVIDIA GPU
2. 安装 [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html)
3. 验证 GPU 可用：

```bash
docker run --gpus all nvidia/cuda:12.1-base nvidia-smi
```

### 启动 GPU 版本

```bash
docker-compose -f docker-compose.yml -f docker-compose.gpu.yml up -d
```

---

## 镜像版本说明

| 镜像标签 | 说明 |
|---------|------|
| `paperspark/paperspark-nextjs:latest` | Next.js 前端 |
| `paperspark/paperspark-surya:cpu` | OCR 后端（CPU 版本） |
| `paperspark/paperspark-surya:gpu-cu118` | OCR 后端（CUDA 11.8） |
| `paperspark/paperspark-surya:gpu-cu121` | OCR 后端（CUDA 12.1，推荐） |

---

## 环境变量说明

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `NEXT_PUBLIC_SMALL_MODEL_*` | 小模型配置（快速响应） | OpenRouter 免费模型 |
| `NEXT_PUBLIC_LARGE_MODEL_*` | 大模型配置（高质量） | GPT-4o |
| `NEXT_PUBLIC_EMBEDDING_*` | 嵌入模型配置 | text-embedding-3-small |
| `SURYA_MAX_WORKERS` | OCR 并发数 | CPU: 2, GPU: 4 |

---

## 常见问题

### Q: 服务启动后访问不了？

```bash
# 检查服务状态
docker-compose ps

# 查看日志
docker-compose logs nextjs
docker-compose logs surya-ocr
```

### Q: OCR 服务健康检查失败？

OCR 服务首次启动需要下载模型，可能需要 1-2 分钟。等待后重试：

```bash
docker-compose logs surya-ocr
```

### Q: 如何更新到最新版本？

```bash
docker-compose pull
docker-compose up -d
```

### Q: 数据会丢失吗？

数据存储在 Docker 卷中，容器重启不会丢失。如需备份：

```bash
docker run --rm -v paperspark_chroma-data:/data -v $(pwd):/backup alpine tar czf /backup/chroma-backup.tar.gz /data
```

---

## 高级配置

### 使用私有镜像仓库

```bash
# .env 文件中设置
DOCKER_REGISTRY=registry.example.com
```

### 自定义端口

修改 `docker-compose.yml` 中的 ports 配置：

```yaml
services:
  nextjs:
    ports:
      - "8080:3000"  # 改为 8080 端口
```

### 生产环境部署建议

1. 使用 HTTPS（配置反向代理如 Nginx）
2. 设置资源限制
3. 配置日志收集
4. 定期备份数据卷
