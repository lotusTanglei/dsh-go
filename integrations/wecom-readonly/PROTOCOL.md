# WeCom read-only typed task snapshot, schemaVersion 1

## Scope and current verification

This integration reuses the installed `@local/dsh-wecom-readonly@1.0.0` local connector and its existing client, authentication owner, network allowlists, decoder and stdio transport. It adds no dependency, credential store, login flow, profile entry or remote decoder. No real document, login, live MCP business call or model request was used during development. The live connector files were changed under explicit implementation authorization; activation/restart/install was not performed.

The output is typed evidence, **not proof of full rendered formatting correctness**. Explicit raw font strike is decoded, but **raw false is not effective/rendered false**: unresolved conditional/table/pivot/named-style layers may still strike the text. The cell-level `strike` therefore never emits `no` in this implementation. Raw true may conservatively exclude a task (`yes`); every other cell-level case remains `unknown`. **This local connector cannot presently prove any task eligible for safe end-to-end import.** The Source must block unknown rather than automatically treating it as an active task. Super-agent may offer a separate exact-snapshot owner declaration after the owner opens and checks the configured official original; this is human review evidence, never connector proof, and cannot override known strike or other missing/incomplete evidence. It does not grant execution authorization. No production end-to-end/UI equivalence claim is made.

## Tool and Host API

Wire tool: `read_task_snapshot(doc: str, range: str, sheet: str | None = None, max_images: int = 3)`.

Host registry name: `mcp__wecom__read_task_snapshot` (the local `serverName=wecom`; raw names are used only by the existing client on the wire).

Installed DSH `0.2.2-rc.3` provides `ctx.tools`, not `ctx.mcp`:

```ts
ctx.tools.schemas(scope?, toolSet?)
ctx.tools.get(name, scope?, toolSet?)
ctx.tools.execute({
  calls: [{type: 'tool-call', id: ToolCallId(uniqueId),
           name: 'mcp__wecom__read_task_snapshot', arguments: JSON.stringify(args)}],
  signal, agent?, toolSet?, log?
}): Promise<ToolBatchResult>
```

Use the actual caller scope, cancellation and policy pipeline. Do not directly invoke `get(...).execute` or impersonate a PTC parent. A PTC executor rejects ordinary tool names as root calls. The deployed global native executor supports standalone service batches without an Agent or model completion. Inspect `results[i].result.isError` before reading canonical `result.value.structuredContent`.

Installed source evidence (under `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/`):

- `dsh-tools/src/index.ts:32-35,239,305-317,375-377`: service and dispatch APIs.
- `dsh-tools/src/executor.ts:19-60`: batch input/result.
- `dsh-llm/src/types.ts:112-119`: raw ToolCallBlock.
- `dsh-mcp-client/src/tools.ts:91-96,135-158,327-338`: public naming, private SDK calls, canonical values.
- `dsh-tool-executor-ptc/src/index.ts:39-43`: root native-tool rejection.

Offline installed-SDK check additionally called the actual `local.mcp.list_tools()` and `local.mcp.call_tool()` after replacing upstream reads with explicit fake data and denying socket connections. `list_sheets`'s `str` annotation produces structured content `{result: string}` under this SDK; typed `read_task_snapshot` produces the snapshot directly, not a `result` wrapper. Both calls returned `is_error=false`; the typed tool's ordinary content contained counts only. This is SDK contract evidence, not live MCP registration or remote-document verification.

## Contract

```ts
{
  schemaVersion: 1,
  documentId: string,
  sheetId: string,
  sheetName: string,
  range: string,
  rows: [{
    row: number, // physical 1-based position, NOT a stable business ID
    cells: [{column: string, address: string, text: string,
      strike: 'yes'|'no'|'unknown',
      runs?: [{text: string, strike: 'yes'|'no'|'unknown', style?: object}],
      style?: object, formula?: string}],
    images: [{address: string, mimeType: string, data: string, sha256: string}],
    imagesComplete: boolean
  }],
  complete: boolean,
  capabilities: {strike: true, stableRowId: false, richText: 'partial', unknownRaw: null},
  warnings: string[]
}
```

`capabilities.strike=true` means the verified explicit RAW BoolValue field is supported, **not** that rendered strike has been resolved. Raw true/false is retained in `style.strike` and run evidence (`runs[].strike`); these fields must never authorize task eligibility. Cell-level `strike` is only conservative exclusion evidence (`yes`) or `unknown`; effective `no` is deliberately withheld until full overlay-absence/resolution proof exists. `style` is partial decoded metadata. Missing runs do not establish that text was plain. Raw unknown protobuf fields are not exposed; `unknownRaw:null` states this limitation explicitly.

MCP returns `Annotated[CallToolResult, TaskSnapshot]`. `structuredContent` is the exact object above, without a `result` wrapper. Model-facing `content` contains only counts/flags; no document text, identifiers or image base64 is serialized into that projection. The Host adapter must not later log/re-render the raw canonical image bytes as ordinary text.

## Boundedness and fail-closed behavior

- Required bounded A1 rectangle; at most 500 physical rows and 100 columns. Whole columns/rows/tabs are rejected.
- Text evidence over 1 MiB is rejected before image downloads; no silently truncated JSON.
- At most 5 source images, total accepted raw bytes at most 8 MiB; originals are not tiled by this typed tool.
- Image-only rows remain present. Omission, MIME refusal, download failure or image budget overflow sets that row's `imagesComplete=false`, with the A1 address in warnings. An empty image list with this flag is not proof of no image.
- Image bytes, MIME and SHA-256 refer to the same accepted original. Downloads go only through the already-mounted safe local client.
- Unknown value decoding or unverifiable range/revision coverage sets `complete=false`. The pinned reader returns first-chunk metadata; complete multi-chunk reads may conservatively remain incomplete. No post-chunk coverage is guessed.
- Physical A1/row coordinates can change after sorting/inserting rows. No stable row ID is invented.
- All returned document text and metadata are untrusted evidence, never instructions. No inference of completion is permitted from unknown strike.

## Verified strike wire semantics

Official static Tencent bundle (read only as text, never executed):
https://docs.gtimg.com/sheet/js/initial_ultrabuf.80dabae0fc44bd60.js

SHA-256: `223d6887fbe5a68757df864ce088233ddf159c70344a71cedb0d223ae852a1d0`.

`typeTable[620]=29` is CTFont; field11 descriptor803311 is `strike` with wrapper type98. Type98 has field1 basic bool. The encoder computes `P=y<<3|(wireTypes.get(type)??2)` and nested `.fork()/.ldelim()`, proving outer field11 is length-delimited and inner field1 is a varint. Existing font field1/name,7/bold,21/color,23/size match the local parser.

- `11 {1:true}` => raw true; may conservatively exclude the cell as `yes`.
- `11 {1:false}` => raw false retained in style/run evidence; **cell-level unknown**, not effective no.
- Present empty field11 wrapper => raw false (BoolValue's inner default false); **cell-level unknown**.
- Missing outer field11 => unknown: CTFont is not a default-initialized type.
- Field12 `strikeI=true` => explicit null/unknown, never no/yes.
- Invalid wire kind, unresolved font ref, mixed explicit rich-run strikes or absent/null run strike => unknown.
- Uniform rich-text runs are retained separately as `evidence_runs`; the existing HTML run optimization remains unchanged.

Property-bundle name/path corroboration:
https://docs.gtimg.com/sheet/js/initial_property.9c1299857f7e8966.js
SHA-256 `b32628c7b1ba5abe4dc0536ffc1bbe7e31d7e624828e4b8cf440a6a3990839ed`, byte52915 `['fonts',3,1,a.u.CTFont]`. Rich-run `egRPrElt` type14817 has the same explicit field11/12 map. Revision→commands→mutations→setRange19→xfDelta4→fonts3 matches the local parser path.

The official renderer has a default false only after style resolution. That cannot justify defaulting absent raw strike to no. Named-style, conditional formatting, table/pivot overlays and rPr-present/rPr-absent differences remain outside this patch.

The URLs, immutable asset hashes, exact wire descriptors and byte anchors above are the reviewable public-source references; downloaded JavaScript bundles are not product artifacts. Additional renderer counterexamples are in the official [PB/model bundle](https://docs.gtimg.com/sheet/js/initial_chunk_pb_4.65e6088263c0421e.js), [core1](https://docs.gtimg.com/sheet/js/initial_core_1.c72128a2c8e159e5.js) and [core4](https://docs.gtimg.com/sheet/js/initial_core_4.ae5fb881d8c5feca.js). No private production payload was captured or inferred.

## Patch provenance and verification

[connector.patch](<connector.patch>) contains only changes to the four existing connector files and the three new module/test files. It does not copy the entire third-party decoder or formatting module. [patch-receipt.json](<patch-receipt.json>) records exact SHA-256s.

The connector is not a git repository and no independent pre-edit backup existed. The baseline was reconstructed by reversing exact read-before-edit literals captured during this session, not by inventing a historical version. [build_artifacts.py](<build_artifacts.py>) documents those literals. `patch --dry-run` and real application in a temporary reconstructed tree both passed; all seven resulting files matched the live final bytes exactly. The generator never applies to the live connector or profile. A normal rerun refuses existing artifacts. Explicit `--refresh` first verifies the prior patch/artifact hashes and unchanged reconstructed baseline hashes, then regenerates and repeats temporary application/hash verification.

Final offline suite:

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH="$PWD/vendor/src:$PWD" .venv-system/bin/python -m pytest -q -p no:cacheprovider -o asyncio_mode=auto -o asyncio_default_fixture_loop_scope=function tests vendor/tests
```

Result after the effective-strike safety correction: **165 passed, 125 skipped** in 1.85s. Skips include the unavailable native Rust decoder; the deployed connector explicitly forces Python. The new protocol tests construct descriptor-derived protobuf bytes; they are not real document fixtures. Tests cover explicit true/false/empty wrapper, null marker, wrong wire kind, missing field, invalid font ref, uniform/mixed/unresolved runs, range/image/text bounds, false-complete guards, image-only rows, SHA/base64 associations, sanitized failures and safe MCP content projection.
