# PaperSpark 部署指南

这份文档按“第一次接触 Docker”的方式来写，跟着命令一步步执行即可。

## 0. 先确认你要做哪件事

1. 只想使用现成镜像部署应用：看「A. 拉取镜像并部署」。
2. 想把你自己的镜像自动发布到 Docker Hub：看「B. 云端自动构建并推送镜像」。

---

## A. 拉取镜像并部署（新手推荐）

### A1. 安装 Docker

- Windows/macOS: [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- Linux: [Docker Engine](https://docs.docker.com/engine/install/)

安装后先执行一次命令，确认 Docker 正常：

```bash
docker --version
docker compose version
```

### A2. 下载项目并进入部署目录

```bash
git clone https://github.com/zongxi1115/paperspark.git
cd paperspark/deploy
```

### A3. 配置环境变量

```bash
# Linux/macOS
cp .env.example .env

# Windows PowerShell
Copy-Item .env.example .env
```

然后打开 .env 文件，至少填好以下几组配置：

1. NEXT_PUBLIC_SMALL_MODEL_* 
2. NEXT_PUBLIC_LARGE_MODEL_* 
3. NEXT_PUBLIC_EMBEDDING_*

如果你要使用仓库默认镜像，可保持以下默认值：

```env
DOCKER_REGISTRY=docker.io
DOCKER_USER=xiaozongxi
VERSION=latest
SURYA_VERSION=cpu
```

### A4. 启动服务

```bash
# CPU 版本（默认）
docker compose up -d
```

### A5. 检查服务是否启动成功

```bash
docker compose ps
docker compose logs -f nextjs
docker compose logs -f surya-ocr
```

浏览器打开：http://localhost:3000

### A6. 常用维护命令

```bash
# 停止
docker compose down

# 更新镜像后重新启动
docker compose pull
docker compose up -d
```



## B. 用户如何选择 CPU 或 GPU

前端镜像始终是同一个：`xiaozongxi/paperspark-nextjs:latest`。

是否使用 GPU，只影响 OCR 服务（`xiaozongxi/paperspark-surya:*` 标签与 compose 启动方式）。

### B1. 先看一眼怎么选

| 场景 | 推荐 | 原因 |
|------|------|------|
| 普通电脑、无 NVIDIA 显卡 | CPU | 兼容性最高，直接可跑 |
| 有 NVIDIA 显卡、已装容器工具链 | GPU | OCR 更快，长文档体验更好 |

### B2. 选择 CPU（默认）

在 `.env` 中设置：

```env
SURYA_VERSION=cpu
```

然后启动：

```bash
docker compose pull
docker compose up -d
```

### B3. 选择 GPU（CUDA 12.1）

前提条件：

1. 主机有 NVIDIA GPU。
2. 已安装 NVIDIA 驱动。
3. 已安装 NVIDIA Container Toolkit。

可先验证：

```bash
docker run --gpus all nvidia/cuda:12.1-base nvidia-smi
```

在 `.env` 中设置：

```env
SURYA_GPU_VERSION=gpu-cu121
SURYA_MAX_WORKERS=4
```

然后启动（注意要叠加 gpu compose 文件）：

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml pull
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d
```

### B4. CPU 与 GPU 相互切换

从 CPU 切 GPU，或 GPU 切 CPU，按这个顺序即可：

```bash
docker compose down
# 修改 .env 中 SURYA_VERSION 或 SURYA_GPU_VERSION
docker compose pull
docker compose up -d
```

如果你要切到 GPU，请使用带 `-f docker-compose.gpu.yml` 的命令。

### B5. 如何确认当前跑的是哪个版本

```bash
docker compose ps
docker compose logs -f surya-ocr
```

如果是 GPU 模式，日志里通常会出现 CUDA 相关信息；也可以执行：

```bash
docker compose exec surya-ocr python -c "import torch; print('cuda=', torch.cuda.is_available())"
```

输出 `cuda= True` 表示已正确使用 GPU。

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
| `xiaozongxi/paperspark-nextjs:latest` | Next.js 前端 |
| `xiaozongxi/paperspark-surya:cpu` | OCR 后端（CPU 版本） |
| `xiaozongxi/paperspark-surya:gpu-cu121` | OCR 后端（CUDA 12.1，推荐） |

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

### Q: Actions 里提示 unauthorized: authentication required？

一般是 Docker Hub 凭据问题，按顺序检查：

1. DOCKERHUB_USERNAME 是否是 Docker Hub 用户名（不是邮箱）。
2. DOCKERHUB_TOKEN 是否是 Access Token（不是账号密码）。
3. token 是否仍然有效（过期或撤销后会失败）。
4. Secrets 名称是否完全一致：DOCKERHUB_USERNAME 和 DOCKERHUB_TOKEN。

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
