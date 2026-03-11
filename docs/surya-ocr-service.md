# Surya OCR FastAPI Service

## Start

```powershell
cd d:\vibe_projs\paper_reader
.\scripts\start-surya-service.ps1
```

The script activates `conda base` first, then starts FastAPI with `uvicorn`.

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
