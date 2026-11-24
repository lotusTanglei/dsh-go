/**
 * L2 Seatbelt profile for the Go-owned Worker shell.
 *
 * The promise is write confinement: a Worker process tree can read broadly (tool
 * chains need the host toolchain), but every write is limited to its own Ticket
 * directory. Platform temporary roots are intentionally NOT granted: Ticket
 * directories are kept outside them, and the shared `/tmp` grant is exactly what
 * would let sibling Tickets meet.
 *
 * Network is deliberately NOT restricted. This is disclosed in every result and
 * in the probe receipt; the file boundary does not claim to be a network jail.
 *
 * @module dsh-go/isolation/seatbelt
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

/** Absolute runner path on macOS. A PATH lookup would let a Writer shadow the runner. */
export const SANDBOX_EXEC = '/usr/bin/sandbox-exec'

/** Only macOS ships the Seatbelt runner this boundary is written for. */
export const SUPPORTED_PLATFORM = 'darwin'

/** Network disclosure for every Worker command result. */
export const NETWORK_POLICY = 'unrestricted' as const

/** Version of the receipt/profile contract, bumped whenever a check must be re-run. */
export const ISOLATION_PROBE_VERSION = 1

/**
 * The profile template. `{{WORKDIR}}` is the only substitution, so the template
 * digest is stable across Ticket directories and can bind a probe receipt to the
 * exact profile implementation.
 */
export const SEATBELT_PROFILE_TEMPLATE = '(version 1) (allow default) (deny file-write*) (allow file-write* (literal "/dev/null") (subpath "{{WORKDIR}}"))'

/** Digest of the profile implementation, stored in the probe receipt and rechecked at runtime. */
export function profileTemplateDigest(): string {
  return createHash('sha256').update(SEATBELT_PROFILE_TEMPLATE, 'utf8').digest('hex')
}

/** Quote one path as an SBPL string literal. */
function sbplString(path: string): string {
  return path.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

/** Throw a coded isolation error; callers never need to parse Node's errno text. */
function isolationError(code: string, message: string): Error {
  return Object.assign(new Error(message), { name: 'GoIsolationError', code })
}

/**
 * Canonicalize the Ticket directory used by the profile and the child cwd.
 * `sandbox-exec` matches canonical paths, so a symlinked work root must be
 * resolved once here rather than silently failing every write.
 * @param ticketDir - configured Ticket directory.
 * @returns the canonical directory the boundary grants.
 * @throws GO_WORKDIR_INVALID when the path is not absolute or is not a directory.
 */
export function canonicalTicketDir(ticketDir: string): string {
  if (typeof ticketDir !== 'string' || !ticketDir || !isAbsolute(ticketDir) || ticketDir.includes('\0')) {
    throw isolationError('GO_WORKDIR_INVALID', 'Worker Ticket directory must be an absolute path without NUL bytes')
  }
  const directory = resolve(ticketDir)
  if (!existsSync(directory)) throw isolationError('GO_WORKDIR_INVALID', 'Worker Ticket directory does not exist')
  // Seatbelt matches canonical paths; `/var` vs `/private/var` would silently deny every write.
  const canonical = realpathSync(directory)
  if (!statSync(canonical).isDirectory()) throw isolationError('GO_WORKDIR_INVALID', 'Worker Ticket directory is not a directory')
  return canonical
}

/** Build the exact Seatbelt profile text for one canonical Ticket directory. */
export function buildSeatbeltProfile(ticketDir: string): string {
  const directory = canonicalTicketDir(ticketDir)
  if (!isAbsolute(directory)) throw isolationError('GO_WORKDIR_INVALID', 'Worker Ticket directory must be absolute')
  return SEATBELT_PROFILE_TEMPLATE.replace('{{WORKDIR}}', sbplString(directory))
}

/** Short digest of one generated profile, for receipts and audit rows. */
export function profileDigest(ticketDir: string): string {
  return createHash('sha256').update(buildSeatbeltProfile(ticketDir), 'utf8').digest('hex')
}

/** Environment names safe to inherit: no credentials, tokens, proxies, or Host secrets. */
const ENV_ALLOWLIST = Object.freeze(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TZ', 'SYSTEM_VERSION_COMPAT', 'SDKROOT'])

/** Ticket-local cache directory names, created before the command runs. */
const CACHE_DIRS = Object.freeze(['.go-runtime', '.go-runtime/tmp', '.go-runtime/gocache', '.go-runtime/gopath', '.go-runtime/npm', '.go-runtime/pip', '.go-runtime/xdg-cache', '.go-runtime/xdg-config', '.go-runtime/pycache'])

/**
 * Build a least-privilege environment for a Worker command. Only the allowlist is
 * forwarded; every cache/temp path is redirected inside the Ticket directory so a
 * tool that would normally write `$HOME/.cache` fails closed instead of reaching
 * the user's home.
 * @param ticketDir - canonical Ticket directory.
 * @param baseEnv - environment to filter (defaults to the Host environment).
 * @returns the child environment object.
 */
export function buildIsolatedEnv(ticketDir: string, baseEnv: Readonly<Record<string, string | undefined>> = process.env): Record<string, string> {
  const directory = canonicalTicketDir(ticketDir)
  const env: Record<string, string> = {}
  for (const name of ENV_ALLOWLIST) {
    const value = baseEnv[name]
    if (typeof value === 'string' && value && !value.includes('\0')) env[name] = value
  }
  const runtime = resolve(directory, '.go-runtime')
  env.TMPDIR = resolve(runtime, 'tmp')
  env.TMP = env.TMPDIR
  env.TEMP = env.TMPDIR
  env.GOCACHE = resolve(runtime, 'gocache')
  env.GOPATH = resolve(runtime, 'gopath')
  env.GOMODCACHE = resolve(runtime, 'gopath', 'pkg/mod')
  env.GOTMPDIR = env.TMPDIR
  env.npm_config_cache = resolve(runtime, 'npm')
  env.PIP_CACHE_DIR = resolve(runtime, 'pip')
  env.XDG_CACHE_HOME = resolve(runtime, 'xdg-cache')
  env.XDG_CONFIG_HOME = resolve(runtime, 'xdg-config')
  env.PYTHONPYCACHEPREFIX = resolve(runtime, 'pycache')
  // Shell startup files are never read: they can execute user code and write outside scope.
  env.BASH_ENV = '/dev/null'
  env.ENV = '/dev/null'
  return env
}

/** `<ticket>/.go-runtime` exists only so redirected caches can be created without a prior tool. */
export function isolatedEnvDirectories(ticketDir: string): readonly string[] {
  const directory = canonicalTicketDir(ticketDir)
  return CACHE_DIRS.map(name => resolve(directory, name))
}

/** Digest a file's exact bytes (used to bind a receipt to the installed runner). */
export function fileDigest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}
