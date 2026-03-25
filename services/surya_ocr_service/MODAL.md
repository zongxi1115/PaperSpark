# Surya OCR on Modal

## 架构

当前仓库里的 Surya 微服务已经改成可同时支持两种运行方式：

- 本地模式：继续沿用 `FastAPI + ThreadPoolExecutor`
- Modal 模式：改为 `FastAPI Web App (CPU) + GPU Worker + Modal Volume`

Modal 下保留原来的 HTTP 协议：

- `POST /jobs`
- `GET /jobs/{job_id}`
- `GET /jobs/{job_id}/result`
- `/rag/*`
- `/convert/docx-to-pdf`

所以 Next.js 侧只需要把服务 URL 指向 Modal 暴露出来的 Web Endpoint。

默认执行后端是 `python`，也就是直接调用 Surya predictor，而不是每次都起 `surya_layout` / `surya_ocr` CLI 子进程。
如果要临时回退旧链路，可设置：

```env
SURYA_EXECUTION_BACKEND=cli
```

## 推荐配置

推荐默认配置如下：

- GPU: `L4`
- Worker CPU: `4`
- Worker Memory: `16384 MB`
- Worker Max Containers: `2`
- Worker Scaledown Window: `2s`
- Web CPU: `2`
- Web Memory: `4096 MB`
- Web Max Containers: `1`
- Web Scaledown Window: `2s`
- Batch: `LAYOUT_BATCH_SIZE=24`、`DETECTOR_BATCH_SIZE=24`、`RECOGNITION_BATCH_SIZE=384`

这样选的原因：

- Surya OCR 的识别批量默认很吃显存，直接冲满默认批量时 16 GB 卡会比较紧张。
- `L4` 有 24 GB 显存，价格通常又比更大的卡友好，整体性价比比 `T4` 更稳，也比 `A10` 更划算。
- Web 入口单独跑在 CPU 容器上，状态轮询不会平白占一张 GPU。
- 模型缓存放进独立 Volume，避免每次冷启动都重新下载权重。
- 当前默认把空闲保温压到 Modal 允许的最小值 `2s`，尽量避免请求结束后继续空转计费。

## 需要的 Volume

部署脚本会默认使用两个 Volume 名称：

- `paperspark-surya-data`
- `paperspark-surya-model-cache`

前者保存任务状态、结果和 Chroma 数据，后者保存 Hugging Face / Torch 模型缓存。

## 部署

先在 conda `base` Python 里安装 Modal：

```powershell
D:\miniconda\python.exe -m pip install -r services/surya_ocr_service/requirements-modal.txt
```

然后部署：

```powershell
.\scripts\deploy-surya-modal.ps1
```

如果要本地联调 Modal Web App：

```powershell
.\scripts\deploy-surya-modal.ps1 -Mode serve
```

也可以直接运行：

```powershell
D:\miniconda\python.exe -m modal deploy services/surya_ocr_service/modal_service.py
```

## 前端环境变量

部署完成后，把 Modal 返回的 Web Endpoint URL 写进 `.env.local`：

```env
SURYA_OCR_SERVICE_URL=https://your-modal-web-endpoint
SURYA_SERVICE_URL=https://your-modal-web-endpoint
NEXT_PUBLIC_SURYA_SERVICE_URL=https://your-modal-web-endpoint
NEXT_PUBLIC_SURYA_OCR_SERVICE_URL=https://your-modal-web-endpoint
```

仓库里现在已经兼容 `SURYA_OCR_SERVICE_URL` 和 `SURYA_SERVICE_URL` 两套命名，但实际使用时最好都指向同一个地址，避免解析与 RAG 落到不同后端。
