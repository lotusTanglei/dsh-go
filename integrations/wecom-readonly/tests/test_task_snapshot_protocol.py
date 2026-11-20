"""Synthetic protobuf evidence, not captured document data or guessed wire fields.

Official descriptor source (static text, never executed):
https://docs.gtimg.com/sheet/js/initial_ultrabuf.80dabae0fc44bd60.js
CTFont type620: 11=strike(BoolValue type98),12=strikeI(basic bool).
BoolValue type98 field1=bool; its absent inner value defaults false. CTFont's
absent outer strike has NO such default; inheritance is deliberately unknown.
"""
import asyncio
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "vendor" / "src"))

import task_snapshot as snapshot
from wecom_excel_mcp import decoder
from wecom_excel_mcp.formatting import Style


def varint(value):
    out = bytearray()
    while value > 127:
        out.append((value & 127) | 128)
        value >>= 7
    return bytes(out + bytes([value]))


def v(number, value):
    return varint(number << 3) + varint(value)


def m(number, *parts):
    body = b"".join(parts)
    return varint(number << 3 | 2) + varint(len(body)) + body


def s(number, text):
    return m(number, text.encode())


def decode(font=b"", runs=None, style_index=0):
    styles = m(4, m(1, m(9)), m(3, font))
    values = m(5, m(1, s(1, "task")))
    kind = 4
    if runs is not None:
        values = m(5, m(2, *(m(3, m(1, m(1, f)), m(3, s(1, text))) for text, f in runs)))
        kind = 6
    cell = m(6, v(1, 1), m(3, v(1, kind), m(2), m(4, v(1, style_index))))
    raw = m(1, m(5, v(1, 18), m(19, m(3, s(1, "T")), styles, values, cell)))
    # Tests deliberately cover the pure-Python decoder used by the local connector.
    return decoder._decode_python(raw, "T", None)


def strike(data):
    return snapshot._cell_strike(data.styles.get((1, 0)), data.evidence_runs.get((1, 0)))


@pytest.mark.parametrize("font,expected", [
    (m(11, v(1, 1)), "yes"),
    (m(11, v(1, 0)), "no"),
    (m(11), "no"),  # Present empty BoolValue has its own false default.
    (b"", "unknown"),
    (m(7, v(1, 1)), "unknown"),
    (m(11, v(1, 1)) + v(12, 1), "unknown"),
    (v(12, 1) + m(11, v(1, 1)), "unknown"),
    (m(11, v(1, 1)) + v(12, 0), "yes"),
    (m(11, m(1)), "unknown"),  # Wrong inner wire kind cannot be false.
    (v(11, 1), "unknown"),
])
def test_exact_schema_font_bytes(font, expected):
    data = decode(font)
    assert snapshot._strike(data.styles.get((1, 0))) == expected
    assert strike(data) == ("yes" if expected == "yes" else "unknown")


def test_unknown_font_reference_is_not_default_false():
    assert strike(decode(m(11, v(1, 0)), style_index=200)) == "unknown"


@pytest.mark.parametrize("runs,expected", [
    ([("all", m(11, v(1, 1)))], "yes"),
    ([("not", m(11, v(1, 0)))], "unknown"),
    ([("a", m(11, v(1, 1))), ("b", m(11, v(1, 1)))], "yes"),
    ([("a", m(11, v(1, 1))), ("b", m(11, v(1, 0)))], "unknown"),
    ([("a", b"")], "unknown"),
    ([("a", m(11, v(1, 1)) + v(12, 1))], "unknown"),
])
def test_uniform_mixed_and_unresolved_rich_runs_are_preserved(runs, expected):
    data = decode(m(11, v(1, 1)), runs=runs)
    assert strike(data) == expected
    assert len(data.evidence_runs[(1, 0)]) == len(runs)
    assert data.cells[(1, 0)] == "".join(text for text, _ in runs)


def test_native_or_existing_unannotated_styles_remain_unknown():
    assert snapshot._strike(Style()) == "unknown"
    assert snapshot._strike(None) == "unknown"


def test_explicit_font_survives_typed_snapshot(monkeypatch):
    data = decode(m(11, v(1, 0)))
    async def load(*args):
        return SimpleNamespace(pad_id="D"), SimpleNamespace(id="T", name="Tasks"), data, {
            "max_row": 2, "end_row_index": 1, "rev": 1,
        }
    monkeypatch.setattr(snapshot.upstream, "_load", load)
    monkeypatch.setattr(snapshot.upstream, "_use_caller_cookie", lambda ctx: None)
    got = asyncio.run(snapshot.read_task_snapshot("D", "T", "A1:D2", max_images=0))
    assert got["capabilities"]["strike"] is True
    cell = got["rows"][0]["cells"][0]
    assert cell["style"]["strike"] is False  # Known RAW evidence survives.
    assert cell["strike"] == "unknown"  # No complete overlay-resolution proof.
    assert got["complete"] is True  # Range coverage is separate from style proof.


def test_explicit_false_with_unresolved_style_never_authorizes_import():
    data = decode(m(11, v(1, 0)))
    # Conditional/named/table/pivot layers are intentionally not resolved here.
    assert data.styles[(1, 0)].strike is False
    assert snapshot._cell_strike(data.styles[(1, 0)], None) == "unknown"
    assert snapshot._cell_strike(Style(strike=False), [("task", Style(strike=False))]) == "unknown"
    assert snapshot._strike(Style(strike=False)) == "no"  # Raw run evidence only.
