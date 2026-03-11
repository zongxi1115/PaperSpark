param(
  [int]$Port = 8765,
  [string]$ListenHost = "127.0.0.1"
)

$ErrorActionPreference = "Stop"

conda activate base
$env:PYTHONIOENCODING = "utf-8"

uvicorn services.surya_ocr_service.main:app --host $ListenHost --port $Port --reload
