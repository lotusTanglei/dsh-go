#!/usr/bin/env bash
# Run only in this repository. Never install dependencies or alter the profile.
set -euo pipefail
root="$(pwd -P)"
label="${1:?unique evidence label required}"
[[ "$label" =~ ^[a-zA-Z0-9-]+$ ]] || exit 2
out="$root/probes/kanban/$label"
if [[ -e "$out" ]]; then printf 'Refusing stale evidence: %s\n' "$out" >&2; exit 2; fi
mkdir -p "$out"
: "${DSH_NODE_EXECUTABLE:?installed Node24 runtime required}"
shim="$root/.probe/kanban-20261118-200717"
chmod u+x "$shim/node"
export PATH="$shim:$PATH"
export ELECTRON_RUN_AS_NODE=1
{
  date '+%Y-%m-%dT%H:%M:%S%z'
  printf 'cwd=%s\n' "$root"
  git rev-parse HEAD
  node --version
  pnpm --version
  node -e 'const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(":memory:"); console.log(db.prepare("select sqlite_version() version").get());db.close()'
} 2>&1 | tee "$out/environment.log"
for gate in typecheck test build; do
  printf '\n$ pnpm run %s\n' "$gate" | tee "$out/$gate.log"
  set +e
  pnpm run "$gate" 2>&1 | tee -a "$out/$gate.log"
  codes=("${PIPESTATUS[@]}")
  set -e
  printf '[exit code: %s] [tee exit code: %s]\n' "${codes[0]}" "${codes[1]}" | tee -a "$out/$gate.log"
  if [[ "${codes[0]}" != 0 || "${codes[1]}" != 0 ]]; then exit 1; fi
done
printf '[exit code: 0]\n'
