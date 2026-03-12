from __future__ import annotations

import html
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import chromadb
from chromadb.config import Settings
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel


TEXTUAL_LABELS = {
    "Text",
    "SectionHeader",
    "Caption",
    "ListItem",
    "Footnote",
    "Formula",
    "Code",
    "Table",
    "Form",
}

JOB_ROOT = Path("out") / "surya_jobs"
JOB_ROOT.mkdir(parents=True, exist_ok=True)


def load_local_env_file() -> None:
    env_path = Path('.env.local')
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding='utf-8').splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue

        key, value = line.split('=', 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_local_env_file()

MAX_WORKERS = max(1, int(os.environ.get("SURYA_MAX_WORKERS", "1")))
JOB_EXECUTOR = ThreadPoolExecutor(max_workers=MAX_WORKERS, thread_name_prefix="surya-job")
JOB_LOCK = threading.Lock()
JOBS: dict[str, dict[str, Any]] = {}


class LayoutRegion(BaseModel):
    label: str
    confidence: float | None = None
    position: int
    bbox: list[float]
    polygon: list[list[float]]
    line_count: int
    text: str


class ParsedPage(BaseModel):
    page: int
    image_bbox: list[float]
    full_text: str
    structure_counts: dict[str, int]
    layout_regions: list[LayoutRegion]


class ParseResponse(BaseModel):
    document_name: str
    page_count: int
    full_text: str
    structure_counts: dict[str, int]
    pages: list[ParsedPage]
    artifacts: dict[str, str] | None = None


class JobSubmissionResponse(BaseModel):
    success: bool = True
    job_id: str
    status: str
    stage: str
    created_at: str
    updated_at: str


class JobStatusResponse(BaseModel):
    success: bool = True
    job_id: str
    status: str
    stage: str
    created_at: str
    updated_at: str
    file_name: str
    output_name: str | None = None
    page_range: str | None = None
    error: str | None = None
    page_count: int | None = None
    full_text_length: int | None = None
    result_available: bool = False


class JobResultResponse(JobStatusResponse):
    parsed: ParseResponse | None = None


app = FastAPI(
    title="Surya OCR Service",
    version="0.2.0",
    description="Queue PDF layout and OCR parsing jobs with Surya and return compact structured results.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_cli(name: str) -> str:
    executable = shutil.which(name)
    if not executable:
        raise HTTPException(status_code=500, detail=f"Missing CLI: {name}")
    return executable


def load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise HTTPException(status_code=500, detail=f"Missing results file: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def model_to_dict(model: BaseModel) -> dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


def result_json_path(output_dir: Path, input_path: Path) -> Path:
    return output_dir / input_path.stem / "results.json"


def job_dir(job_id: str) -> Path:
    return JOB_ROOT / job_id


def job_manifest_path(job_id: str) -> Path:
    return job_dir(job_id) / "job.json"


def job_result_path(job_id: str) -> Path:
    return job_dir(job_id) / "result.json"


def persist_job_record(job_id: str, record: dict[str, Any]) -> None:
    directory = job_dir(job_id)
    directory.mkdir(parents=True, exist_ok=True)
    job_manifest_path(job_id).write_text(
        json.dumps(record, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def load_job_record(job_id: str) -> dict[str, Any] | None:
    manifest = job_manifest_path(job_id)
    if not manifest.exists():
        return None
    return json.loads(manifest.read_text(encoding="utf-8"))


def get_job_record(job_id: str) -> dict[str, Any] | None:
    with JOB_LOCK:
        record = JOBS.get(job_id)
        if record:
            return dict(record)

        disk_record = load_job_record(job_id)
        if not disk_record:
            return None

        JOBS[job_id] = disk_record
        return dict(disk_record)


def update_job_record(job_id: str, **updates: Any) -> dict[str, Any]:
    with JOB_LOCK:
        record = JOBS.get(job_id) or load_job_record(job_id)
        if not record:
            raise KeyError(job_id)

        record.update(updates)
        record["updated_at"] = utc_now_iso()
        JOBS[job_id] = record
        persist_job_record(job_id, record)
        return dict(record)


def build_job_status(record: dict[str, Any]) -> JobStatusResponse:
    return JobStatusResponse(
        job_id=record["job_id"],
        status=record["status"],
        stage=record.get("stage", record["status"]),
        created_at=record["created_at"],
        updated_at=record["updated_at"],
        file_name=record["file_name"],
        output_name=record.get("output_name"),
        page_range=record.get("page_range"),
        error=record.get("error"),
        page_count=record.get("page_count"),
        full_text_length=record.get("full_text_length"),
        result_available=job_result_path(record["job_id"]).exists(),
    )


def bbox_area(bbox: list[float]) -> float:
    return max(0.0, bbox[2] - bbox[0]) * max(0.0, bbox[3] - bbox[1])


def bbox_intersection(a: list[float], b: list[float]) -> float:
    x1 = max(a[0], b[0])
    y1 = max(a[1], b[1])
    x2 = min(a[2], b[2])
    y2 = min(a[3], b[3])
    if x2 <= x1 or y2 <= y1:
        return 0.0
    return (x2 - x1) * (y2 - y1)


def line_matches_region(line_bbox: list[float], region_bbox: list[float]) -> bool:
    center_x = (line_bbox[0] + line_bbox[2]) / 2
    center_y = (line_bbox[1] + line_bbox[3]) / 2
    inside = (
        region_bbox[0] <= center_x <= region_bbox[2]
        and region_bbox[1] <= center_y <= region_bbox[3]
    )
    if inside:
        return True

    overlap = bbox_intersection(line_bbox, region_bbox)
    line_area = bbox_area(line_bbox) or 1.0
    return overlap / line_area >= 0.25


def sort_lines(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        lines,
        key=lambda line: (
            round(float(line["bbox"][1]), 1),
            round(float(line["bbox"][0]), 1),
        ),
    )


def build_ocr_line(line: dict[str, Any]) -> dict[str, Any]:
    text = html.unescape(str(line.get("text", "")).strip())
    text = re.sub(r"</?b>", "", text)
    text = re.sub(r"</?i>", "", text)

    return {
        "text": text.strip(),
        "confidence": line.get("confidence"),
        "bbox": [float(v) for v in line.get("bbox", [])],
        "polygon": [[float(point[0]), float(point[1])] for point in line.get("polygon", [])],
    }


def normalize_pages(layout_data: dict[str, Any], ocr_data: dict[str, Any], document_name: str) -> ParseResponse:
    layout_pages = layout_data.get(document_name, [])
    ocr_pages = ocr_data.get(document_name, [])
    ocr_by_page = {int(page["page"]): page for page in ocr_pages}

    pages: list[ParsedPage] = []
    structure_counter: Counter[str] = Counter()
    full_text_parts: list[str] = []

    for raw_layout_page in layout_pages:
        page_number = int(raw_layout_page["page"])
        raw_ocr_page = ocr_by_page.get(page_number, {})
        text_lines = sort_lines(raw_ocr_page.get("text_lines", []))
        remaining_lines = text_lines.copy()

        layout_regions: list[LayoutRegion] = []
        page_text_parts: list[str] = []
        page_counter: Counter[str] = Counter()

        for region in sorted(raw_layout_page.get("bboxes", []), key=lambda item: int(item.get("position", 0))):
            region_bbox = [float(v) for v in region.get("bbox", [])]
            matched: list[dict[str, Any]] = []
            unmatched: list[dict[str, Any]] = []

            for line in remaining_lines:
                if line_matches_region([float(v) for v in line.get("bbox", [])], region_bbox):
                    matched.append(line)
                else:
                    unmatched.append(line)

            remaining_lines = unmatched
            matched_lines = [build_ocr_line(line) for line in matched if str(line.get("text", "")).strip()]
            region_text = "\n".join(line["text"] for line in matched_lines).strip()
            label = str(region.get("label", "Unknown"))

            layout_regions.append(
                LayoutRegion(
                    label=label,
                    confidence=region.get("confidence"),
                    position=int(region.get("position", 0)),
                    bbox=region_bbox,
                    polygon=[[float(point[0]), float(point[1])] for point in region.get("polygon", [])],
                    line_count=len(matched_lines),
                    text=region_text,
                )
            )

            page_counter[label] += 1
            structure_counter[label] += 1

            if region_text and label in TEXTUAL_LABELS:
                page_text_parts.append(region_text)

        if remaining_lines:
            unassigned_lines = [build_ocr_line(line) for line in remaining_lines if str(line.get("text", "")).strip()]
            page_text_parts.extend(line["text"] for line in unassigned_lines if line["text"])
            if unassigned_lines:
                page_counter["UnassignedText"] += len(unassigned_lines)
                structure_counter["UnassignedText"] += len(unassigned_lines)

        page_full_text = "\n\n".join(part for part in page_text_parts if part).strip()
        if page_full_text:
            full_text_parts.append(f"[Page {page_number}]\n{page_full_text}")

        pages.append(
            ParsedPage(
                page=page_number,
                image_bbox=[float(v) for v in raw_layout_page.get("image_bbox", [])],
                full_text=page_full_text,
                structure_counts=dict(page_counter),
                layout_regions=layout_regions,
            )
        )

    return ParseResponse(
        document_name=document_name,
        page_count=len(pages),
        full_text="\n\n".join(full_text_parts).strip(),
        structure_counts=dict(structure_counter),
        pages=pages,
    )


def run_surya_command(command: list[str], cwd: Path) -> None:
    try:
        subprocess.run(
            command,
            cwd=str(cwd),
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr.strip() or exc.stdout.strip() or "Surya command failed"
        raise RuntimeError(stderr) from exc


def persist_raw_outputs(job_record: dict[str, Any], layout_json: Path, ocr_json: Path) -> dict[str, str]:
    target_name = job_record.get("output_name") or Path(job_record["file_name"]).stem
    persisted_dir = Path("out") / "surya_service" / target_name
    persisted_dir.mkdir(parents=True, exist_ok=True)
    layout_target = persisted_dir / "layout.results.json"
    ocr_target = persisted_dir / "ocr.results.json"
    shutil.copy2(layout_json, layout_target)
    shutil.copy2(ocr_json, ocr_target)
    return {
        "layout_json": str(layout_target.resolve()),
        "ocr_json": str(ocr_target.resolve()),
    }


def process_job(job_id: str) -> None:
    job_record = get_job_record(job_id)
    if not job_record:
        return

    try:
        ensure_cli("surya_layout")
        ensure_cli("surya_ocr")

        update_job_record(job_id, status="processing", stage="layout", error=None)
        input_path = Path(job_record["input_path"])

        with tempfile.TemporaryDirectory(prefix=f"surya_job_{job_id}_") as temp_dir:
            work_dir = Path(temp_dir)
            layout_output_dir = work_dir / "layout_out"
            ocr_output_dir = work_dir / "ocr_out"

            layout_cmd = ["surya_layout", str(input_path), "--output_dir", str(layout_output_dir)]
            ocr_cmd = ["surya_ocr", str(input_path), "--output_dir", str(ocr_output_dir)]
            page_range = job_record.get("page_range")
            if page_range:
                layout_cmd.extend(["--page_range", page_range])
                ocr_cmd.extend(["--page_range", page_range])

            run_surya_command(layout_cmd, work_dir)
            update_job_record(job_id, status="processing", stage="ocr")
            run_surya_command(ocr_cmd, work_dir)
            update_job_record(job_id, status="processing", stage="normalize")

            layout_json = result_json_path(layout_output_dir, input_path)
            ocr_json = result_json_path(ocr_output_dir, input_path)
            layout_data = load_json(layout_json)
            ocr_data = load_json(ocr_json)
            parsed = normalize_pages(layout_data, ocr_data, input_path.stem)

            if job_record.get("keep_outputs"):
                parsed.artifacts = persist_raw_outputs(job_record, layout_json, ocr_json)

            update_job_record(job_id, status="processing", stage="persisting")
            result_path = job_result_path(job_id)
            result_path.write_text(
                json.dumps(model_to_dict(parsed), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

        update_job_record(
            job_id,
            status="completed",
            stage="completed",
            error=None,
            page_count=parsed.page_count,
            full_text_length=len(parsed.full_text),
            result_path=str(result_path.resolve()),
        )
    except Exception as exc:
        update_job_record(
            job_id,
            status="failed",
            stage="failed",
            error=str(exc),
        )


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "surya_layout": bool(shutil.which("surya_layout")),
        "surya_ocr": bool(shutil.which("surya_ocr")),
        "max_workers": MAX_WORKERS,
        "job_root": str(JOB_ROOT.resolve()),
    }


@app.post("/jobs", response_model=JobSubmissionResponse)
async def create_job(
    file: UploadFile = File(...),
    page_range: str | None = Form(default=None),
    keep_outputs: bool = Form(default=False),
    output_name: str | None = Form(default=None),
) -> JobSubmissionResponse:
    ensure_cli("surya_layout")
    ensure_cli("surya_ocr")

    job_id = uuid.uuid4().hex
    directory = job_dir(job_id)
    directory.mkdir(parents=True, exist_ok=True)

    suffix = Path(file.filename or "document.pdf").suffix or ".pdf"
    input_path = directory / f"input{suffix}"
    input_path.write_bytes(await file.read())

    timestamp = utc_now_iso()
    record = {
        "job_id": job_id,
        "status": "queued",
        "stage": "queued",
        "created_at": timestamp,
        "updated_at": timestamp,
        "file_name": file.filename or "document.pdf",
        "output_name": output_name,
        "page_range": page_range,
        "keep_outputs": keep_outputs,
        "input_path": str(input_path.resolve()),
        "error": None,
        "page_count": None,
        "full_text_length": None,
    }

    with JOB_LOCK:
        JOBS[job_id] = record
        persist_job_record(job_id, record)

    JOB_EXECUTOR.submit(process_job, job_id)
    return JobSubmissionResponse(
        job_id=job_id,
        status="queued",
        stage="queued",
        created_at=timestamp,
        updated_at=timestamp,
    )


@app.get("/jobs/{job_id}", response_model=JobStatusResponse)
def get_job_status(job_id: str) -> JobStatusResponse:
    record = get_job_record(job_id)
    if not record:
        raise HTTPException(status_code=404, detail="Job not found")
    return build_job_status(record)


@app.get("/jobs/{job_id}/result", response_model=JobResultResponse)
def get_job_result(job_id: str):
    record = get_job_record(job_id)
    if not record:
        raise HTTPException(status_code=404, detail="Job not found")

    status_payload = build_job_status(record)
    if record["status"] != "completed":
        status_code = 500 if record["status"] == "failed" else 202
        return JSONResponse(
            status_code=status_code,
            content=model_to_dict(JobResultResponse(
                **model_to_dict(status_payload),
                parsed=None,
            )),
        )

    result_path = job_result_path(job_id)
    if not result_path.exists():
        raise HTTPException(status_code=500, detail="Result file missing")

    parsed = ParseResponse(**json.loads(result_path.read_text(encoding="utf-8")))
    return JobResultResponse(
        **model_to_dict(status_payload),
        parsed=parsed,
    )


# ============ ChromaDB 向量存储功能 ============

# ChromaDB 数据目录
CHROMA_ROOT = Path("out") / "chroma_db"
CHROMA_ROOT.mkdir(parents=True, exist_ok=True)

# 初始化 ChromaDB 客户端（嵌入式持久化模式）
_chroma_client: chromadb.ClientAPI | None = None


def get_chroma_client() -> chromadb.ClientAPI:
    global _chroma_client
    if _chroma_client is None:
        _chroma_client = chromadb.PersistentClient(
            path=str(CHROMA_ROOT.resolve()),
            settings=Settings(anonymized_telemetry=False)
        )
    return _chroma_client


class EmbedRequest(BaseModel):
    document_id: str
    texts: list[str]
    block_ids: list[str]
    metadatas: list[dict[str, Any]]
    openai_api_key: str | None = None
    openai_base_url: str | None = None
    embedding_name: str | None = None


class SearchRequest(BaseModel):
    document_id: str
    query: str
    top_k: int = 5
    openai_api_key: str | None = None
    openai_base_url: str | None = None
    embedding_name: str | None = None


class EmbedResponse(BaseModel):
    success: bool
    message: str
    count: int | None = None


class SearchResult(BaseModel):
    block_id: str
    text: str
    score: float
    metadata: dict[str, Any]


class SearchResponse(BaseModel):
    success: bool
    results: list[SearchResult]
    query: str


def get_env_value(*keys: str) -> str:
    for key in keys:
        value = os.environ.get(key)
        if value and value.strip():
            return value.strip()
    return ""


def normalize_api_url(base_url: str, fallback_path: str) -> str:
    trimmed = base_url.strip().rstrip("/")
    if not trimmed:
        return ""
    if trimmed.endswith("/embeddings") or trimmed.endswith("/rerank"):
        return trimmed
    return f"{trimmed}/{fallback_path}"


def sanitize_metadata_value(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return json.dumps(value, ensure_ascii=False)


def sanitize_metadatas(metadatas: list[dict[str, Any]]) -> list[dict[str, Any]]:
    sanitized: list[dict[str, Any]] = []
    for metadata in metadatas:
        sanitized.append({
            key: sanitize_metadata_value(value)
            for key, value in metadata.items()
        })
    return sanitized


async def generate_embeddings(
    texts: list[str],
    api_key: str | None,
    base_url: str | None,
    model_name: str | None,
) -> list[list[float]]:
    """调用 OpenAI API 生成嵌入向量"""
    import httpx

    resolved_api_key = api_key or get_env_value("api_key", "API_KEY")
    resolved_base_url = normalize_api_url(
        base_url or get_env_value("base_url", "BASE_URL") or "https://api.openai.com/v1",
        "embeddings",
    )
    resolved_model_name = model_name or get_env_value("embedding_name", "EMBEDDING_NAME") or "text-embedding-3-small"

    if not resolved_api_key or not resolved_base_url or not resolved_model_name:
        raise HTTPException(status_code=500, detail="Missing embedding provider configuration")

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            resolved_base_url,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {resolved_api_key}",
            },
            json={
                "model": resolved_model_name,
                "input": texts,
            },
        )

        if response.status_code != 200:
            raise HTTPException(
                status_code=500,
                detail=f"OpenAI API error: {response.text}"
            )

        data = response.json()
        return [item["embedding"] for item in data["data"]]


@app.get("/rag/health")
def rag_health() -> dict[str, Any]:
    """检查向量数据库状态"""
    try:
        client = get_chroma_client()
        collections = client.list_collections()
        return {
            "ok": True,
            "chroma_path": str(CHROMA_ROOT.resolve()),
            "collections_count": len(collections),
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/rag/embed", response_model=EmbedResponse)
async def rag_embed(request: EmbedRequest = Body(...)) -> EmbedResponse:
    """生成并存储文档嵌入向量"""
    if not request.texts:
        return EmbedResponse(success=True, message="没有文本需要嵌入", count=0)

    try:
        # 生成嵌入向量
        embeddings = await generate_embeddings(
            request.texts,
            request.openai_api_key,
            request.openai_base_url,
            request.embedding_name,
        )

        # 获取或创建集合
        client = get_chroma_client()
        collection_name = f"doc_{request.document_id.replace('-', '_')}"
        
        try:
            collection = client.get_collection(name=collection_name)
        except Exception:
            collection = client.create_collection(
                name=collection_name,
                metadata={"document_id": request.document_id}
            )

        # 添加向量
        collection.add(
            ids=request.block_ids,
            embeddings=embeddings,
            documents=request.texts,
            metadatas=sanitize_metadatas(request.metadatas),
        )

        return EmbedResponse(
            success=True,
            message=f"成功嵌入 {len(request.texts)} 个文本块",
            count=len(request.texts)
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/rag/search", response_model=SearchResponse)
async def rag_search(request: SearchRequest = Body(...)) -> SearchResponse:
    """语义搜索文档"""
    try:
        # 生成查询嵌入
        query_embeddings = await generate_embeddings(
            [request.query],
            request.openai_api_key,
            request.openai_base_url,
            request.embedding_name,
        )

        # 获取集合并搜索
        client = get_chroma_client()
        collection_name = f"doc_{request.document_id.replace('-', '_')}"
        
        try:
            collection = client.get_collection(name=collection_name)
        except Exception:
            return SearchResponse(
                success=True,
                results=[],
                query=request.query
            )

        results = collection.query(
            query_embeddings=query_embeddings,
            n_results=request.top_k,
        )

        search_results = []
        if results["ids"] and results["ids"][0]:
            for i, block_id in enumerate(results["ids"][0]):
                distance = results["distances"][0][i] if results.get("distances") else 0
                # 距离转相似度 (假设是余弦距离)
                score = 1 - distance if distance <= 1 else 1 / (1 + distance)
                
                search_results.append(SearchResult(
                    block_id=block_id,
                    text=results["documents"][0][i] if results.get("documents") else "",
                    score=score,
                    metadata=results["metadatas"][0][i] if results.get("metadatas") else {},
                ))

        return SearchResponse(
            success=True,
            results=search_results,
            query=request.query
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/rag/{document_id}")
def rag_delete(document_id: str) -> dict[str, Any]:
    """删除文档的向量数据"""
    try:
        client = get_chroma_client()
        collection_name = f"doc_{document_id.replace('-', '_')}"
        
        try:
            client.delete_collection(name=collection_name)
            return {"success": True, "message": f"已删除文档 {document_id} 的向量数据"}
        except Exception:
            return {"success": True, "message": "集合不存在或已删除"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/rag/collections")
def rag_list_collections() -> dict[str, Any]:
    """列出所有向量集合"""
    try:
        client = get_chroma_client()
        collections = client.list_collections()
        return {
            "success": True,
            "collections": [
                {"name": c.name, "count": c.count()}
                for c in collections
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
