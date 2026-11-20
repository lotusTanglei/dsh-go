"""Typed evidence over the existing reader, with no transport/auth ownership.

Only explicit, schema-verified strike BoolValues become yes/no. Missing font,
null/inherited strike and unverified run inheritance remain unknown.
"""
from __future__ import annotations

import base64
from dataclasses import asdict
import hashlib
import json
import math
import re
from typing import Annotated, Literal, NotRequired, TypedDict

from mcp.types import CallToolResult, TextContent

from mcp.server.mcpserver.exceptions import ToolError
from wecom_excel_mcp import server as upstream
from wecom_excel_mcp.table import col_letter, parse_range

MAX_ROWS = 500
MAX_COLUMNS = 100
MAX_IMAGES = 5
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_TEXT_BYTES = 1024 * 1024
_A1_RECT = re.compile(r"\$?[A-Za-z]+\$?[1-9]\d*(?::\$?[A-Za-z]+\$?[1-9]\d*)?\Z")
Strike = Literal["yes", "no", "unknown"]


class SnapshotRun(TypedDict):
    text: str
    strike: Strike
    style: NotRequired[dict[str, str | int | float | bool | None]]


class SnapshotCell(TypedDict):
    column: str
    address: str
    text: str
    strike: Strike
    runs: NotRequired[list[SnapshotRun]]
    style: NotRequired[dict[str, str | int | float | bool | None]]
    formula: NotRequired[str]


class SnapshotImage(TypedDict):
    address: str
    mimeType: str
    data: str
    sha256: str


class SnapshotRow(TypedDict):
    row: int
    cells: list[SnapshotCell]
    images: list[SnapshotImage]
    imagesComplete: bool


class SnapshotCapabilities(TypedDict):
    strike: Literal[True]
    stableRowId: Literal[False]
    richText: Literal["partial"]
    unknownRaw: None


class TaskSnapshot(TypedDict):
    schemaVersion: Literal[1]
    documentId: str
    sheetId: str
    sheetName: str
    range: str
    rows: list[SnapshotRow]
    complete: bool
    capabilities: SnapshotCapabilities
    warnings: list[str]


def _bounded_range(value: str):
    value = value.strip()
    if len(value) > 80 or not _A1_RECT.fullmatch(value):
        raise ToolError("read_task_snapshot requires a bounded A1 rectangle, e.g. A1:L100")
    rng = parse_range(value)
    assert rng.r1 is not None and rng.c1 is not None
    if rng.r1 - rng.r0 + 1 > MAX_ROWS or rng.c1 - rng.c0 + 1 > MAX_COLUMNS:
        raise ToolError("snapshot range exceeds 500 rows or 100 columns; request a narrower range")
    return value, rng


def _inside(rng, key):
    r, c = key
    return rng.r0 <= r <= rng.r1 and rng.c0 <= c <= rng.c1


def _json_bytes(value) -> int:
    return len(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode())


def _coverage_verified(meta, rng) -> bool:
    # The pinned reader returns the first chunk's metadata. Never infer coverage
    # from the last non-empty cell or accept a mixed/unknown revision as complete.
    values = [meta.get("max_row"), meta.get("end_row_index"), meta.get("rev")]
    if any(isinstance(v, bool) or not isinstance(v, int) for v in values):
        return False
    max_row, end_row, revision = values
    return max_row >= 0 and revision >= 0 and end_row >= min(rng.r1, max_row - 1)


def _strike(style) -> Strike:
    value = getattr(style, "strike", None)
    return "yes" if value is True else "no" if value is False else "unknown"


def _cell_strike(style, runs) -> Strike:
    # Raw font false is not effective/rendered false: unresolved conditional,
    # named/table/pivot styles can still apply strike. Never authorize import
    # from it. Explicit true is only conservative exclusion evidence.
    if runs is not None:
        values = {_strike(run_style) for text, run_style in runs if text}
        return "yes" if values == {"yes"} else "unknown"
    return "yes" if _strike(style) == "yes" else "unknown"


def _text(value) -> str:
    if isinstance(value, float) and not math.isfinite(value):
        raise ToolError("snapshot contains a non-finite cell value; refusing lossy evidence")
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


async def read_task_snapshot(doc: str, sheet: str | None, range: str,
                             max_images: int = 3, ctx=None) -> TaskSnapshot:
    """Return bounded evidence; missing/inherited strike metadata remains unknown."""
    requested, rng = _bounded_range(range)
    if isinstance(max_images, bool) or not isinstance(max_images, int) or not 0 <= max_images <= MAX_IMAGES:
        raise ToolError("max_images must be an integer from 0 to 5")
    upstream._use_caller_cookie(ctx)
    info, tab, data, _meta = await upstream._load(doc, sheet, rng.r0, rng.r1)
    keys = {k for mapping in (data.cells, data.formulas, data.styles, data.runs, data.images)
            for k in mapping if _inside(rng, k)}
    row_numbers = sorted({r for r, _ in keys})
    rows: list[SnapshotRow] = []
    by_row: dict[int, SnapshotRow] = {}
    for r in row_numbers:
        cells: list[SnapshotCell] = []
        for c in sorted(c for rr, c in keys if rr == r):
            key = r, c
            runs = data.evidence_runs.get(key, data.runs.get(key))
            cell: SnapshotCell = {
                "address": f"{col_letter(c)}{r + 1}", "column": col_letter(c),
                "text": _text(data.cells.get(key)), "strike": _cell_strike(data.styles.get(key), runs),
            }
            if runs is not None:
                cell["runs"] = [{"text": text, "style": asdict(style), "strike": _strike(style)}
                                for text, style in runs]
            if key in data.styles:
                cell["style"] = asdict(data.styles[key])
            if key in data.formulas:
                cell["formula"] = data.formulas[key]
            cells.append(cell)
        row: SnapshotRow = {"row": r + 1, "cells": cells, "images": [], "imagesComplete": True}
        rows.append(row)
        by_row[r] = row

    warnings = [
        "raw strike BoolValues are evidence only; effective no is never emitted without resolved style overlays; unknown blocks safe import",
        "row numbers and A1 addresses are physical snapshot positions, not stable row IDs",
        "richText/style is partial decoded evidence; missing runs do not prove plain text; unknownRaw is unavailable",
    ]
    complete = not bool(data.unknown_types) and _coverage_verified(_meta, rng)
    if not _coverage_verified(_meta, rng):
        warnings.append("range coverage/revision cannot be verified from the pinned reader metadata; snapshot is incomplete")
    if data.unknown_types:
        warnings.append("undecoded cell types: " + ", ".join(f"{k}:{n}" for k, n in data.unknown_types.items()))
    result: TaskSnapshot = {
        "schemaVersion": 1, "documentId": info.pad_id, "sheetId": tab.id, "sheetName": tab.name,
        "range": requested, "rows": rows, "complete": complete, "warnings": warnings,
        "capabilities": {"strike": True, "stableRowId": False, "richText": "partial", "unknownRaw": None},
    }
    # Check before any image downloads. No truncated/invalid JSON is returned.
    if _json_bytes(result) > MAX_TEXT_BYTES:
        raise ToolError("snapshot text exceeds 1 MiB; request a narrower range")
    pictures = sorted((r, c, img) for (r, c), img in data.images.items() if _inside(rng, (r, c)))
    client = upstream._client_or_fail() if pictures and max_images else None
    image_bytes = 0
    for index, (r, c, img) in enumerate(pictures):
        row = by_row[r]
        address = f"{col_letter(c)}{r + 1}"
        if index >= max_images:
            row["imagesComplete"] = False
            warnings.append(f"image at {address} omitted: max_images limit; request a narrower range")
            continue
        try:
            # The mounted local client owns CDN/redirect/pixel/download safety.
            # Never create a new client, transport, auth flow, or download path.
            body, mime = await client.fetch_image(img.original_url)
            if mime not in {"image/png", "image/jpeg", "image/webp", "image/gif"}:
                raise ValueError("unsupported image MIME")
            if image_bytes + len(body) > MAX_IMAGE_BYTES:
                row["imagesComplete"] = False
                warnings.append(f"image at {address} omitted: 8 MiB snapshot image budget")
                continue
            image_bytes += len(body)
            row["images"].append({"address": address, "mimeType": mime,
                                  "data": base64.b64encode(body).decode("ascii"),
                                  "sha256": hashlib.sha256(body).hexdigest()})
        except Exception:
            # No upstream error/URL/header can leak into the evidence envelope.
            row["imagesComplete"] = False
            warnings.append(f"image at {address} unavailable from the existing local connector")
    return result


async def read_task_snapshot_tool(doc: str, range: str, sheet: str | None = None,
                                  max_images: int = 3, ctx=None) -> Annotated[CallToolResult, TaskSnapshot]:
    """Keep typed canonical evidence separate from the safe model-facing summary."""
    result = await read_task_snapshot(doc=doc, sheet=sheet, range=range, max_images=max_images, ctx=ctx)
    images = sum(len(row["images"]) for row in result["rows"])
    summary = {"schemaVersion": 1, "rows": len(result["rows"]), "images": images,
               "complete": result["complete"], "strikeSupported": result["capabilities"]["strike"]}
    return CallToolResult(content=[TextContent(type="text", text=json.dumps(summary, separators=(",", ":")))],
                          structured_content=result)
