# encoding: utf-8
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path


def echo_step(title: str) -> None:
    print(f"\n=== {title} ===", flush=True)


def run_stream(cmd: list[str], cwd: Path | None = None, env: dict[str, str] | None = None) -> int:
    display = " ".join(cmd)
    print(f"$ {display}", flush=True)
    process = subprocess.Popen(
        cmd,
        cwd=str(cwd) if cwd else None,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    assert process.stdout is not None
    for line in process.stdout:
        print(line, end="", flush=True)
    process.wait()
    return process.returncode


def ask_choice(prompt: str, options: list[str], default: str) -> str:
    options_text = "/".join(options)
    while True:
        val = input(f"{prompt} ({options_text}) [{default}]: ").strip().lower()
        if not val:
            return default
        if val in options:
            return val
        print(f"无效选项: {val}")


def ask_yes_no(prompt: str, default: bool = True) -> bool:
    hint = "Y/n" if default else "y/N"
    val = input(f"{prompt} [{hint}]: ").strip().lower()
    if not val:
        return default
    return val in {"y", "yes"}


def ensure_uv() -> None:
    if shutil.which("uv"):
        return
    echo_step("安装 uv")
    rc = run_stream([sys.executable, "-m", "pip", "install", "-U", "uv"])
    if rc != 0:
        raise RuntimeError("安装 uv 失败，请检查 Python/pip 环境")


def install_requirements(service_dir: Path) -> None:
    echo_step("安装服务依赖 requirements.txt")
    rc = run_stream(["uv", "pip", "install", "-r", "requirements.txt"], cwd=service_dir)
    if rc != 0:
        raise RuntimeError("安装 requirements 失败")


def install_torch(accel: str, cuda: str | None) -> None:
    echo_step("安装 PyTorch")
    if accel == "cpu":
        index_url = "https://download.pytorch.org/whl/cpu"
    else:
        if not cuda:
            raise RuntimeError("GPU 模式需要 CUDA 通道")
        index_url = f"https://download.pytorch.org/whl/{cuda}"

    cmd = [
        "uv",
        "pip",
        "install",
        "--upgrade",
        "torch",
        "torchvision",
        "torchaudio",
        "--index-url",
        index_url,
    ]
    rc = run_stream(cmd)
    if rc != 0:
        raise RuntimeError("安装 PyTorch 失败")


def start_uvicorn(project_root: Path, host: str, port: int, reload: bool) -> int:
    echo_step("启动 Surya OCR FastAPI")
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"

    cmd = [
        sys.executable,
        "-X",
        "utf8",
        "-m",
        "uvicorn",
        "services.surya_ocr_service.main:app",
        "--host",
        host,
        "--port",
        str(port),
    ]
    if reload:
        cmd.append("--reload")

    return run_stream(cmd, cwd=project_root, env=env)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="跨平台启动 Surya OCR 服务")
    parser.add_argument("--host", default="127.0.0.1", help="监听地址")
    parser.add_argument("--port", type=int, default=8765, help="监听端口")
    parser.add_argument("--reload", action="store_true", help="启用 uvicorn 自动重载")
    parser.add_argument(
        "--accelerator",
        choices=["interactive", "cpu", "gpu", "skip-install"],
        default="interactive",
        help="安装模式: interactive/cpu/gpu/skip-install",
    )
    parser.add_argument(
        "--cuda",
        choices=["cu118", "cu121", "cu124", "cu126"],
        default=None,
        help="GPU 模式下的 CUDA 通道",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    project_root = Path(__file__).resolve().parents[1]
    service_dir = project_root / "services" / "surya_ocr_service"

    if not service_dir.exists():
        print(f"服务目录不存在: {service_dir}")
        return 1

    print("后端微服务快速启动", flush=True)
    print(f"项目目录: {project_root}", flush=True)

    accelerator = args.accelerator
    cuda_channel = args.cuda
    should_install = True

    if accelerator == "interactive":
        should_install = ask_yes_no("是否先安装/更新依赖（推荐）", True)
        if should_install:
            accelerator = ask_choice("选择运行版本", ["cpu", "gpu"], "cpu")
            if accelerator == "gpu" and not cuda_channel:
                cuda_channel = ask_choice("选择 CUDA 通道", ["cu118", "cu121", "cu124", "cu126"], "cu121")
    elif accelerator == "skip-install":
        should_install = False

    try:
        if should_install:
            ensure_uv()
            install_requirements(service_dir)
            install_torch(accelerator, cuda_channel)

        print("\n服务即将启动，按 Ctrl+C 可停止。", flush=True)
        rc = start_uvicorn(project_root, args.host, args.port, args.reload)
        return rc
    except KeyboardInterrupt:
        print("\n已中断。")
        return 130
    except Exception as exc:
        print(f"\n启动失败: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
