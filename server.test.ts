import { test, expect } from 'bun:test'
import { join, sep } from 'path'
import { readFileSync, writeFileSync, mkdirSync, renameSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'

// --- Unit tests for pure logic extracted from server.ts ---
// We test the logic directly without starting the MCP or Bolt servers.

const STATE_DIR_TEST = tmpdir()

function assertSendable_CURRENT(f: string): void {
  let real: string, stateReal: string
  try { real = realpathSync(f); stateReal = realpathSync(STATE_DIR_TEST) } catch { return } // BUG: returns on error
  const inbox = join(stateReal, 'inbox')
  if (real.startsWith(stateReal + sep) && !real.startsWith(inbox + sep)) {
    throw new Error(`refusing to send channel state: ${f}`)
  }
}

function assertSendable_FIXED(f: string): void {
  let real: string, stateReal: string
  try { real = realpathSync(f); stateReal = realpathSync(STATE_DIR_TEST) } catch { throw new Error(`cannot resolve path: ${f}`) } // FIX: throws
  const inbox = join(stateReal, 'inbox')
  if (real.startsWith(stateReal + sep) && !real.startsWith(inbox + sep)) {
    throw new Error(`refusing to send channel state: ${f}`)
  }
}

function scrubTokens(msg: string): string {
  return msg.replace(/(xox[a-z]-|xapp-)[A-Za-z0-9-]+/g, '[REDACTED]')
}

// BUG 1: assertSendable should throw on non-existent path, not silently allow
test('assertSendable CURRENT: silently allows non-existent path (demonstrates bug)', () => {
  expect(() => assertSendable_CURRENT('/nonexistent/path/that/does/not/exist')).not.toThrow()
})

test('assertSendable FIXED: throws on non-existent path', () => {
  expect(() => assertSendable_FIXED('/nonexistent/path/that/does/not/exist')).toThrow()
})

test('assertSendable FIXED: allows normal files outside state dir', () => {
  expect(() => assertSendable_FIXED(tmpdir())).not.toThrow()
})

// BUG 2: token patterns should be scrubbed from error messages
test('scrubTokens: removes xoxb- tokens from error messages', () => {
  const msg = 'Request failed: xoxb-1234567890-abcdef-ghijk invalid_auth'
  expect(scrubTokens(msg)).not.toContain('xoxb-')
  expect(scrubTokens(msg)).toContain('[REDACTED]')
})

test('scrubTokens: removes xapp- tokens from error messages', () => {
  const msg = 'Socket Mode error: xapp-1-A0AT-abcdef12345 connection failed'
  expect(scrubTokens(msg)).not.toContain('xapp-')
  expect(scrubTokens(msg)).toContain('[REDACTED]')
})

test('scrubTokens: leaves normal error messages unchanged', () => {
  const msg = 'channel not_found: channel does not exist'
  expect(scrubTokens(msg)).toBe(msg)
})

// --- Engaged-threads pure logic (copied from server.ts to avoid importing the server) ---
// These are identical to the exported functions in server.ts. Kept in sync manually.

type EngagedThreads = Record<string, number>

const ENGAGED_THREAD_TTL_MS = 7 * 24 * 60 * 60 * 1000

function engagedKey(channelId: string, threadRootTs: string): string {
  return `${channelId}:${threadRootTs}`
}

function pruneEngaged(threads: EngagedThreads, now: number): boolean {
  let changed = false
  for (const key of Object.keys(threads)) {
    if (threads[key] <= now) { delete threads[key]; changed = true }
  }
  return changed
}

function markEngagedIn(threads: EngagedThreads, channelId: string, threadRootTs: string, now: number): void {
  threads[engagedKey(channelId, threadRootTs)] = now + ENGAGED_THREAD_TTL_MS
}

function isEngagedIn(threads: EngagedThreads, channelId: string, threadRootTs: string, now: number): boolean {
  const key = engagedKey(channelId, threadRootTs)
  const expiresAt = threads[key]
  return expiresAt !== undefined && expiresAt > now
}

// --- Engaged-threads: fs round-trip helpers (mirrors server.ts writeEngaged/readEngaged) ---

function writeEngagedTo(file: string, threads: EngagedThreads): void {
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(threads) + '\n', { mode: 0o600 })
  renameSync(tmp, file)
}

function readEngagedFrom(file: string): EngagedThreads {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as EngagedThreads
  } catch {
    return {}
  }
}

// --- Engaged-threads tests ---

test('engaged: markEngagedIn then isEngagedIn returns true within TTL', () => {
  const threads: EngagedThreads = {}
  const now = Date.now()
  markEngagedIn(threads, 'C123', '1700000000.000000', now)
  expect(isEngagedIn(threads, 'C123', '1700000000.000000', now)).toBe(true)
})

test('engaged: isEngagedIn returns false past TTL even if entry exists', () => {
  const threads: EngagedThreads = {}
  const pastNow = Date.now() - ENGAGED_THREAD_TTL_MS - 1000
  // Mark at pastNow so the entry expires at pastNow + TTL, which is <= real now
  markEngagedIn(threads, 'C123', '1700000000.000000', pastNow)
  // Check at current time — the entry should be expired
  expect(isEngagedIn(threads, 'C123', '1700000000.000000', Date.now())).toBe(false)
})

test('engaged: pruneEngaged removes entries at or before now, leaves future ones', () => {
  const now = Date.now()
  const threads: EngagedThreads = {
    'C1:T1': now - 1,     // expired (expiresAt <= now)
    'C1:T2': now,         // expired (expiresAt <= now, boundary)
    'C1:T3': now + 1000,  // still valid
  }
  const changed = pruneEngaged(threads, now)
  expect(changed).toBe(true)
  expect(Object.keys(threads)).toEqual(['C1:T3'])
})

test('engaged: pruneEngaged returns false when nothing to remove', () => {
  const now = Date.now()
  const threads: EngagedThreads = {
    'C1:T1': now + 60_000,
  }
  const changed = pruneEngaged(threads, now)
  expect(changed).toBe(false)
  expect(Object.keys(threads)).toHaveLength(1)
})

test('engaged: key isolates by channelId — different channel is not engaged', () => {
  const threads: EngagedThreads = {}
  const now = Date.now()
  markEngagedIn(threads, 'C111', '1700000000.000000', now)
  expect(isEngagedIn(threads, 'C222', '1700000000.000000', now)).toBe(false)
})

test('engaged: key isolates by threadTs — different thread in same channel is not engaged', () => {
  const threads: EngagedThreads = {}
  const now = Date.now()
  markEngagedIn(threads, 'C123', '1700000000.000000', now)
  expect(isEngagedIn(threads, 'C123', '1700000001.000000', now)).toBe(false)
})

test('engaged: round-trip write then read preserves all entries', () => {
  const stateDir = join(tmpdir(), `engaged-test-${randomBytes(4).toString('hex')}`)
  mkdirSync(stateDir, { recursive: true })
  const file = join(stateDir, 'engaged-threads.json')

  const threads: EngagedThreads = {}
  const now = Date.now()
  markEngagedIn(threads, 'C111', 'T111', now)
  markEngagedIn(threads, 'C222', 'T222', now)

  writeEngagedTo(file, threads)
  const loaded = readEngagedFrom(file)

  expect(loaded[engagedKey('C111', 'T111')]).toBe(threads[engagedKey('C111', 'T111')])
  expect(loaded[engagedKey('C222', 'T222')]).toBe(threads[engagedKey('C222', 'T222')])
})

test('engaged: atomic write — uses .tmp file then rename (no corrupt partial state)', () => {
  const stateDir = join(tmpdir(), `engaged-test-${randomBytes(4).toString('hex')}`)
  mkdirSync(stateDir, { recursive: true })
  const file = join(stateDir, 'engaged-threads.json')

  const threads: EngagedThreads = {}
  markEngagedIn(threads, 'C1', 'T1', Date.now())

  // Write succeeds; verify no .tmp file remains (rename completed)
  writeEngagedTo(file, threads)
  expect(() => readFileSync(file + '.tmp')).toThrow()
  // Main file is valid JSON
  expect(() => JSON.parse(readFileSync(file, 'utf8'))).not.toThrow()
})

test('engaged: readEngagedFrom returns empty map for missing file', () => {
  const result = readEngagedFrom('/nonexistent/path/engaged-threads.json')
  expect(result).toEqual({})
})
