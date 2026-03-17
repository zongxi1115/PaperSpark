# Surya OCR FastAPI Service

## Start

```bash
cd /path/to/paper_reader
python scripts/start_surya_service.py
```

macOS/Linux 可使用 shell 包装脚本：

```bash
cd /path/to/paper_reader
chmod +x scripts/start-surya-service.sh
./scripts/start-surya-service.sh
```

该启动器是跨平台脚本（Windows/macOS/Linux），运行后会交互提示：

- 是否安装/更新依赖
- 选择 CPU 或 GPU
- GPU 模式下选择 CUDA 通道

安装阶段使用 `uv`，并逐步实时输出日志，然后启动 FastAPI（`uvicorn`）。

如需无交互启动，可使用：

```bash
python scripts/start_surya_service.py --accelerator cpu
# 或
python scripts/start_surya_service.py --accelerator gpu --cuda cu121
# 仅启动服务，不安装依赖
python scripts/start_surya_service.py --accelerator skip-install

# shell 包装脚本同样支持参数透传
./scripts/start-surya-service.sh --accelerator gpu --cuda cu121
```

保留原有 PowerShell 脚本 `scripts/start-surya-service.ps1` 供兼容使用。

Default URL: `http://127.0.0.1:8765`

If you want the Next.js side to proxy requests to this service, set:

```env
SURYA_OCR_SERVICE_URL=http://127.0.0.1:8765
```

## Health Check

```powershell
Invoke-RestMethod http://127.0.0.1:8765/health
```

## Parse A PDF

```powershell
$form = @{
  file = Get-Item .\data\example.pdf
  keep_outputs = "true"
  output_name = "example"
}

Invoke-RestMethod `
  -Uri http://127.0.0.1:8765/parse `
  -Method Post `
  -Form $form
```

## Response

The service returns:

- `full_text`: merged document text across pages
- `pages`: per-page structured regions
- `layout_regions`: Surya layout boxes with OCR text assigned back into each region
- `structure_counts`: counts by region label
- `artifacts`: saved Surya raw JSON paths when `keep_outputs=true`

## Notes

- The service calls `surya_layout` and `surya_ocr` CLI directly.
- `PageHeader` and `PageFooter` are kept in structure output, but excluded from `full_text`.
- OCR lines that do not match any layout region are returned as `unassigned_lines`.

## Next.js Proxy

This repo also exposes a proxy route at `POST /api/pdf/surya`.

It accepts `multipart/form-data` with:

- `file`
- `pageRange` (optional)
- `keepOutputs=true|false` (optional)
- `outputName` (optional)
- `includeSummary=true|false` (optional)
- `includeMetadata=true|false` (optional)
- `modelConfig` as JSON string when summary or metadata is requested
