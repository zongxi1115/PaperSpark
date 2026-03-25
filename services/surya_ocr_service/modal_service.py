# encoding: utf-8
from __future__ import annotations

import os
import sys
from pathlib import Path

import modal


SERVICE_DIR = Path(__file__).resolve().parent
REMOTE_SERVICE_PARENT = "/root"
REMOTE_SERVICE_DIR = f"{REMOTE_SERVICE_PARENT}/surya_service"

APP_NAME = os.environ.get("SURYA_MODAL_APP_NAME", "paperspark-surya")
DATA_VOLUME_NAME = os.environ.get("SURYA_MODAL_DATA_VOLUME", "paperspark-surya-data")
MODEL_CACHE_VOLUME_NAME = os.environ.get("SURYA_MODAL_MODEL_CACHE_VOLUME", "paperspark-surya-model-cache")
DATA_ROOT = os.environ.get("SURYA_MODAL_DATA_ROOT", "/vol/paperspark")
MODEL_CACHE_ROOT = os.environ.get("SURYA_MODAL_MODEL_CACHE_ROOT", "/vol/model-cache")
TORCH_CHANNEL = os.environ.get("SURYA_MODAL_TORCH_CHANNEL", "cu126")
TORCH_VERSION = os.environ.get("SURYA_MODAL_TORCH_VERSION", "2.7.1")
TORCHVISION_VERSION = os.environ.get("SURYA_MODAL_TORCHVISION_VERSION", "0.22.1")
TORCHAUDIO_VERSION = os.environ.get("SURYA_MODAL_TORCHAUDIO_VERSION", "2.7.1")
GPU_TYPE = os.environ.get("SURYA_MODAL_GPU", "L4")

WORKER_CPU = int(os.environ.get("SURYA_MODAL_WORKER_CPU", "4"))
WORKER_MEMORY_MB = int(os.environ.get("SURYA_MODAL_WORKER_MEMORY_MB", "16384"))
WORKER_TIMEOUT_SEC = int(os.environ.get("SURYA_MODAL_WORKER_TIMEOUT_SEC", "3600"))
WORKER_MAX_CONTAINERS = int(os.environ.get("SURYA_MODAL_WORKER_MAX_CONTAINERS", "2"))
WORKER_SCALEDOWN_WINDOW_SEC = int(os.environ.get("SURYA_MODAL_WORKER_SCALEDOWN_WINDOW_SEC", "2"))

WEB_CPU = int(os.environ.get("SURYA_MODAL_WEB_CPU", "2"))
WEB_MEMORY_MB = int(os.environ.get("SURYA_MODAL_WEB_MEMORY_MB", "4096"))
WEB_TIMEOUT_SEC = int(os.environ.get("SURYA_MODAL_WEB_TIMEOUT_SEC", "600"))
WEB_SCALEDOWN_WINDOW_SEC = int(os.environ.get("SURYA_MODAL_WEB_SCALEDOWN_WINDOW_SEC", "2"))

SHARED_ENV = {
    "PYTHONUNBUFFERED": "1",
    "SURYA_DATA_ROOT": DATA_ROOT,
    "SURYA_MAX_WORKERS": "1",
    "SURYA_EXECUTION_BACKEND": os.environ.get("SURYA_EXECUTION_BACKEND", "python"),
    "HF_HOME": f"{MODEL_CACHE_ROOT}/huggingface",
    "TORCH_HOME": f"{MODEL_CACHE_ROOT}/torch",
    "TRANSFORMERS_CACHE": f"{MODEL_CACHE_ROOT}/huggingface",
    "XDG_CACHE_HOME": MODEL_CACHE_ROOT,
    # Use a slightly reduced batch profile so L4 stays well below the 24 GB ceiling.
    "LAYOUT_BATCH_SIZE": os.environ.get("SURYA_MODAL_LAYOUT_BATCH_SIZE", "24"),
    "DETECTOR_BATCH_SIZE": os.environ.get("SURYA_MODAL_DETECTOR_BATCH_SIZE", "24"),
    "RECOGNITION_BATCH_SIZE": os.environ.get("SURYA_MODAL_RECOGNITION_BATCH_SIZE", "384"),
}

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("curl")
    .run_commands(
        "python -m pip install --no-cache-dir --upgrade pip setuptools wheel",
        (
            "python -m pip install --no-cache-dir "
            f"torch=={TORCH_VERSION} "
            f"torchvision=={TORCHVISION_VERSION} "
            f"torchaudio=={TORCHAUDIO_VERSION} "
            f"--index-url https://download.pytorch.org/whl/{TORCH_CHANNEL}"
        ),
    )
    .pip_install_from_requirements(str(SERVICE_DIR / "requirements.txt"))
    .pip_install("modal")
    .add_local_dir(
        local_path=str(SERVICE_DIR),
        remote_path=REMOTE_SERVICE_DIR,
    )
)

app = modal.App(APP_NAME)
data_volume = modal.Volume.from_name(DATA_VOLUME_NAME, create_if_missing=True)
model_cache_volume = modal.Volume.from_name(MODEL_CACHE_VOLUME_NAME, create_if_missing=True)


def _prepare_import_path() -> None:
    if REMOTE_SERVICE_PARENT not in sys.path:
        sys.path.insert(0, REMOTE_SERVICE_PARENT)


def _commit_volumes() -> None:
    data_volume.commit()
    model_cache_volume.commit()


def _reload_volumes() -> None:
    data_volume.reload()
    model_cache_volume.reload()


def _load_service_module():
    _prepare_import_path()
    from surya_service import main as service_main

    return service_main


@app.function(
    image=image,
    gpu=GPU_TYPE,
    cpu=WORKER_CPU,
    memory=WORKER_MEMORY_MB,
    timeout=WORKER_TIMEOUT_SEC,
    scaledown_window=WORKER_SCALEDOWN_WINDOW_SEC,
    max_containers=WORKER_MAX_CONTAINERS,
    env=SHARED_ENV,
    volumes={
        DATA_ROOT: data_volume,
        MODEL_CACHE_ROOT: model_cache_volume,
    },
)
def process_job_remote(job_id: str) -> None:
    service_main = _load_service_module()
    service_main.configure_runtime(
        persistence_committer=_commit_volumes,
        persistence_reloader=_reload_volumes,
        job_submitter=None,
    )
    service_main.process_job(job_id)


@app.function(
    image=image,
    cpu=WEB_CPU,
    memory=WEB_MEMORY_MB,
    timeout=WEB_TIMEOUT_SEC,
    scaledown_window=WEB_SCALEDOWN_WINDOW_SEC,
    max_containers=1,
    env=SHARED_ENV,
    volumes={
        DATA_ROOT: data_volume,
        MODEL_CACHE_ROOT: model_cache_volume,
    },
)
@modal.asgi_app()
def web_app():
    service_main = _load_service_module()
    service_main.configure_runtime(
        persistence_committer=_commit_volumes,
        persistence_reloader=_reload_volumes,
        job_submitter=process_job_remote.spawn,
    )
    return service_main.app


@app.local_entrypoint()
def main() -> None:
    print("Recommended deployment:")
    print("  python -m modal deploy services/surya_ocr_service/modal_service.py")
    print("")
    print("After deployment, point these env vars at the Modal web endpoint URL:")
    print("  SURYA_OCR_SERVICE_URL")
    print("  SURYA_SERVICE_URL")
    print("  NEXT_PUBLIC_SURYA_SERVICE_URL")
