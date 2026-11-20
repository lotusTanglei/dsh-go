"""Generate a minimal connector patch from exact in-session literal changes.

This is NOT an independently preserved original or a git baseline. The old
contents below are the exact literals read before their in-session replacements.
Only the owned integration artifact directory is written. The live connector is
read but never patched by this script. patch verification uses TemporaryDirectory.
"""
from __future__ import annotations

import difflib
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

SOURCE = Path("/Users/dundundebaba/Documents/deepseek-harness/default-workspace/dsh-wecom-readonly")
OUT = Path(__file__).resolve().parent


def once(text, new, old):
    assert text.count(new) == 1, f"ambiguous inverse literal: {new[:80]!r}"
    return text.replace(new, old, 1)


def sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


def main():
    changed = ["server.py", "package.json", "vendor/src/wecom_excel_mcp/decoder.py", "vendor/src/wecom_excel_mcp/formatting.py"]
    added = ["task_snapshot.py", "tests/test_task_snapshot.py", "tests/test_task_snapshot_protocol.py"]
    current = {name: (SOURCE / name).read_text() for name in changed + added}
    before = {}
    before["package.json"] = once(current["package.json"], '"server.py", "task_snapshot.py",', '"server.py",')
    before[changed[3]] = once(current[changed[3]],
        "    # Explicit CTFont strike BoolValue only; absent/inherit/invalid stays unknown.\n    strike: bool | None = None\n", "")
    server = once(current["server.py"],
        "from typing import Annotated, Literal\nfrom mcp.types import CallToolResult\nfrom task_snapshot import TaskSnapshot, read_task_snapshot_tool as _read_task_snapshot\n",
        "from typing import Literal\n")
    server = once(server,
        '@mcp.tool(annotations=READ_ONLY)\nasync def read_task_snapshot(doc: str, range: str, sheet: str | None = None,\n                             max_images: int = 3, ctx: Context = None) -> Annotated[CallToolResult, TaskSnapshot]:\n    """读取有界A1范围的版本化任务证据。复用本机读取器；仅显式删除线有已知值，继承/缺失保持未知。最多500行、100列、5张原图。"""\n    return await _read_task_snapshot(doc=doc, sheet=sheet, range=range,\n                                     max_images=max_images, ctx=ctx)\n\n\n', "")
    before["server.py"] = server
    decoder = current[changed[2]]
    inverses = [
        ("    # Unlike HTML's runs, evidence keeps uniform runs and unresolved font inheritance.\n    evidence_runs: dict[tuple[int, int], list[tuple[str, Style]]] = field(default_factory=dict)\n", ""),
        ("        self.evidence_runs.update(other.evidence_runs)\n", ""),
        ("    rich_evidence: list[list[tuple[str, Style]]] = field(default_factory=list)\n", ""),
        ("    strike = None\n    invalid_strike = False\n    # Official static schema initial_ultrabuf.80dabae0fc44bd60.js:\n    # CTFont(type620) field11=BoolValue(type98), field12=strikeI(bool).\n    # BoolValue defaults its missing inner field1 to false; CTFont itself has\n    # NO default strike. strikeI=true is the higher decoder's explicit null.\n", ""),
        ("        if f == 11:\n            strike = None\n            if wt == _LENDELIM:\n                values = list(_fields(buf, *v))\n                if not values:\n                    strike = False\n                elif len(values) == 1 and values[0][0:2] == (1, _VARINT):\n                    strike = bool(values[0][2])\n            continue\n        if f == 12:\n            invalid_strike = invalid_strike or wt != _VARINT or bool(v)\n            continue\n", ""),
        ('    if strike is not None and not invalid_strike:\n        font["strike"] = strike\n', ""),
        ("            t.rich_evidence.append(runs)\n", ""),
        ("            if depth == 0 and 0 <= idx < len(t.rich_evidence):\n                self.out.evidence_runs[(row, col)] = t.rich_evidence[idx]\n", ""),
    ]
    for new, old in inverses:
        decoder = once(decoder, new, old)
    before[changed[2]] = decoder
    chunks = []
    for name in changed:
        chunks.extend(difflib.unified_diff(before[name].splitlines(True), current[name].splitlines(True),
                                           fromfile="a/" + name, tofile="b/" + name))
    for name in added:
        chunks.extend(difflib.unified_diff([], current[name].splitlines(True), fromfile="/dev/null", tofile="b/" + name))
    patch = "".join(chunks)
    patch_path = OUT / "connector.patch"
    refresh = sys.argv[1:] == ["--refresh"]
    assert not sys.argv[1:] or refresh, "only --refresh is accepted"
    if patch_path.exists():
        assert refresh, "existing artifacts require explicit --refresh"
        old_receipt = json.loads((OUT / "patch-receipt.json").read_text())
        assert sha(patch_path.read_text()) == old_receipt["patchSha256"], "prior patch changed unexpectedly"
        for item in old_receipt["files"]:
            name = item["path"]
            assert item["beforeSha256"] == (sha(before[name]) if name in before else None), "baseline drift: " + name
            if name in added:
                assert sha((OUT / name).read_text()) == item["afterSha256"], "prior artifact drift: " + name
    patch_path.write_text(patch)
    for name in added:
        dest = OUT / name
        assert refresh or not dest.exists(), str(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(current[name])
    with tempfile.TemporaryDirectory(prefix="wecom-snapshot-patch-proof-") as temp:
        root = Path(temp)
        for name, content in before.items():
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        # The baseline has an empty tests directory for the new test-file patch.
        (root / "tests").mkdir()
        dry = subprocess.run(["patch", "--dry-run", "-p1", "-i", str(patch_path)], cwd=root,
                             check=True, capture_output=True, text=True)
        applied = subprocess.run(["patch", "-p1", "-i", str(patch_path)], cwd=root,
                                 check=True, capture_output=True, text=True)
        for name, content in current.items():
            assert (root / name).read_text() == content, name
    receipt = {
        "baselineKind": "reconstructed by reversing exact read-before-edit literals, not independent backup or git",
        "source": str(SOURCE), "patchSha256": sha(patch), "dryRun": "passed", "temporaryApplyAndHashes": "passed",
        "files": [{"path": name, "beforeSha256": sha(before[name]) if name in before else None,
                   "afterSha256": sha(current[name])} for name in changed + added],
    }
    (OUT / "patch-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print("PATCH_DRY_RUN_AND_TEMP_APPLY_EXACT_HASHES_OK")
    print("changed=4 added=3; no live/profile/install mutation performed by generator")


if __name__ == "__main__":
    main()
