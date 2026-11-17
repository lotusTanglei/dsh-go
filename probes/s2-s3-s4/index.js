// Non-executable evidence marker, not a runnable DSH plugin.
// Preset registration is not specified in docs/008-dsh-api-map.md.
// Do not implement it until the user resolves that contract gap.
export const probeStatus = {
  s2: 'unverified: preset-registration contract missing from docs/008',
  s3: 'unverified: no live tool-isolation experiment',
  s4: 'unverified: no post-assignment tool-call experiment',
}
