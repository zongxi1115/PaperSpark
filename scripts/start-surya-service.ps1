param(
  [int]$Port = 8765,
  [string]$ListenHost = "127.0.0.1",
  [switch]$Reload
)

$ErrorActionPreference = "Stop"

conda activate base
$env:PYTHONIOENCODING = "utf-8"

$args = @(
  "-X", "utf8",
  "-m", "uvicorn",
  "services.surya_ocr_service.main:app",
  "--host", $ListenHost,
  "--port", $Port
)

if ($Reload) {
  $args += "--reload"
}

python @args
