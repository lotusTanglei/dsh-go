# S2/S3/S4 runtime probes — partial acceptance with a role-matrix conflict

## Latest actual child test

The user explicitly allowed real model probes. Current package entry is `activation.cjs`: one actual spawn with Worker preset, completed with PROBE_OK. `runtime-activation-root-result.json` records S2 success, narrow S3 negative checks passing on the actual child, and real executor refusal after both activation result completion and explicit dispose. Exact message: `session "<id>" is not live in this store`, with no structured code. Both parent and child are no longer live; temporary bundle was removed.

S3 full matrix remains unresolved: Host-global mutation tools still appear in both presets. No guard/restrict fallback was implemented. Live domain Assignment-ended gating remains a P2 proof requirement. See `../RESULTS.md` for the stop condition and two options.

## Earlier local-only run (historical)

The user authorized temporary local Desktop installation/execution, no real model calls. `index.cjs` is a one-shot runner; `router.cjs` provides harmless channel sentinels; `worker.cjs` provides harmless report sentinel. Actual native bash/fs registrations are mounted, but no shell/write operation is invoked. All deployment values are in the bundle patch. No product code exists.

## Actual execution

- First install failed because CLI-only DSH_INSTALL_DIR was absent in the Host process. Fixed by explicit installation-path config; no core changes.
- First successful run omitted preset mount: meta.agentPreset alone did not compose tools. Raw result is retained as `runtime-result.json`; it is a failed probe setup, not evidence that preset isolation fails.
- Corrected run mounts the declared preset in Agent setup. `runtime-mounted-result.json` contains actual Agent-scoped tool tables and executor results.

## Observed results

- Declaration + real idle Agent composition: succeeded. Actual bound ids are superagent-probe-router and superagent-probe-worker.
- S3 local matrix: Router read/channel_reply/human_ask present, bash/write/edit/apply_patch absent; Worker bash/write/edit/report_progress present, channel_reply/human_ask absent. Extra Host-global tools remain visible; therefore this is not proof of an exact allowlisted product matrix.
- S4 lifecycle subcase: real report_progress execution succeeded before AgentHandle.dispose; afterward same real executor returned isError=true, error.message=`session "<id>" is not live in this store`, no structured code. This does NOT test domain Assignment end while Agent remains live or actual activation.dispose.
- S2 startActivation with agentPreset: NOT RUN. No waking input or real model call was performed. Local composition success is not a full S2 pass.

## Cleanup

Both temporary bundles (S1 and S234) were removed using Plugin Manager with application=applied, package exitCode=0. Runtime report confirms liveProbeAgentsRemaining=0. Post-cleanup list_plugins returned 220 entries and no temporary probe rows. Persisted empty session histories may remain under DSH's normal persistence; no undocumented deletion API was used.

`index.js`, `start-activation-shape.js`, and `tool-gates.js` are earlier unused sketches, not the executable entry or acceptance evidence. No tests in this directory establish product typecheck/test/build gates.
