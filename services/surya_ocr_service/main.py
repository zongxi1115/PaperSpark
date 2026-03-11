from __future__ import annotations

import html
import json
import re
import shutil
import subprocess
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
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


class OCRLine(BaseModel):
    text: str
    confidence: float | None = None
    bbox: list[float]
    polygon: list[list[float]]


class LayoutRegion(BaseModel):
    label: str
    confidence: float | None = None
    position: int
    bbox: list[float]
    polygon: list[list[float]]
    line_count: int
    text: str
    lines: list[OCRLine]


class ParsedPage(BaseModel):
    page: int
    image_bbox: list[float]
    full_text: str
    structure_counts: dict[str, int]
    layout_regions: list[LayoutRegion]
    unassigned_lines: list[OCRLine]


class ParseResponse(BaseModel):
    document_name: str
    page_count: int
    full_text: str
    structure_counts: dict[str, int]
    pages: list[ParsedPage]
    artifacts: dict[str, str] | None = None


app = FastAPI(
    title="Surya OCR Service",
    version="0.1.0",
    description="Parse PDF layout and OCR text with Surya, then return normalized structure and full text.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def ensure_cli(name: str) -> str:
    executable = shutil.which(name)
    if not executable:
        raise HTTPException(status_code=500, detail=f"Missing CLI: {name}")
    return executable


def load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise HTTPException(status_code=500, detail=f"Missing results file: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def result_json_path(output_dir: Path, input_path: Path) -> Path:
    return output_dir / input_path.stem / "results.json"


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


def build_ocr_line(line: dict[str, Any]) -> OCRLine:
    text = html.unescape(str(line.get("text", "")).strip())
    text = re.sub(r"</?b>", "", text)
    text = re.sub(r"</?i>", "", text)

    return OCRLine(
        text=text.strip(),
        confidence=line.get("confidence"),
        bbox=[float(v) for v in line.get("bbox", [])],
        polygon=[[float(point[0]), float(point[1])] for point in line.get("polygon", [])],
    )


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
            region_text = "\n".join(line.text for line in matched_lines).strip()
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
                    lines=matched_lines,
                )
            )

            page_counter[label] += 1
            structure_counter[label] += 1

            if region_text and label in TEXTUAL_LABELS:
                page_text_parts.append(region_text)

        unassigned_lines = [build_ocr_line(line) for line in remaining_lines if str(line.get("text", "")).strip()]
        if unassigned_lines:
            page_text_parts.extend(line.text for line in unassigned_lines)
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
                unassigned_lines=unassigned_lines,
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
        raise HTTPException(status_code=500, detail=stderr) from exc


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "surya_layout": bool(shutil.which("surya_layout")),
        "surya_ocr": bool(shutil.which("surya_ocr")),
    }


@app.post("/parse", response_model=ParseResponse)
async def parse_pdf(
    file: UploadFile = File(...),
    page_range: str | None = Form(default=None),
    keep_outputs: bool = Form(default=False),
    output_name: str | None = Form(default=None),
) -> ParseResponse:
    ensure_cli("surya_layout")
    ensure_cli("surya_ocr")

    suffix = Path(file.filename or "document.pdf").suffix or ".pdf"
    document_name = Path(file.filename or "document.pdf").stem

    with tempfile.TemporaryDirectory(prefix="surya_service_") as temp_dir:
        work_dir = Path(temp_dir)
        input_path = work_dir / f"input{suffix}"
        input_path.write_bytes(await file.read())

        layout_output_dir = work_dir / "layout_out"
        ocr_output_dir = work_dir / "ocr_out"

        layout_cmd = ["surya_layout", str(input_path), "--output_dir", str(layout_output_dir)]
        ocr_cmd = ["surya_ocr", str(input_path), "--output_dir", str(ocr_output_dir)]
        if page_range:
            layout_cmd.extend(["--page_range", page_range])
            ocr_cmd.extend(["--page_range", page_range])

        run_surya_command(layout_cmd, work_dir)
        run_surya_command(ocr_cmd, work_dir)

        layout_json = result_json_path(layout_output_dir, input_path)
        ocr_json = result_json_path(ocr_output_dir, input_path)
        layout_data = load_json(layout_json)
        ocr_data = load_json(ocr_json)

        parsed = normalize_pages(layout_data, ocr_data, input_path.stem)

        if keep_outputs:
            target_name = output_name or document_name
            persisted_dir = Path("out") / "surya_service" / target_name
            persisted_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(layout_json, persisted_dir / "layout.results.json")
            shutil.copy2(ocr_json, persisted_dir / "ocr.results.json")
            parsed.artifacts = {
                "layout_json": str((persisted_dir / "layout.results.json").resolve()),
                "ocr_json": str((persisted_dir / "ocr.results.json").resolve()),
            }

        return parsed
