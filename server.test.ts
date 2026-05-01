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

// --- isMentionedPure tests ---
// Pure decision logic copied from server.ts (kept in sync manually, like engaged helpers above).

function isMentionedPure(
  text: string,
  parentUserId: string | undefined,
  botUserId: string,
  botName: string,
  threadEngaged: boolean,
  extraPatterns?: string[],
): boolean {
  if (botUserId && text.includes(`<@${botUserId}>`)) return true
  if (text.includes('*Sent using* Claude')) return false
  if (botName && new RegExp(`\\b${botName}\\b`, 'i').test(text)) return true
  if (parentUserId && botUserId && parentUserId === botUserId) return true
  if (threadEngaged) return true
  for (const pat of extraPatterns ?? []) {
    try { if (new RegExp(pat, 'i').test(text)) return true } catch {}
  }
  return false
}

const BOT_ID = 'U0BOT'
const BOT = 'claude'

test('isMentionedPure: explicit <@bot> tag triggers, even in engaged thread with Claude composer marker', () => {
  // Explicit invocation always wins over the composer skip rule
  expect(isMentionedPure('<@U0BOT> please help *Sent using* Claude', undefined, BOT_ID, BOT, true)).toBe(true)
})

test('isMentionedPure: Claude composer marker skips response in engaged thread (anti Claude-on-Claude doublon)', () => {
  expect(isMentionedPure('picking up the cron run *Sent using* Claude', undefined, BOT_ID, BOT, true)).toBe(false)
})

test('isMentionedPure: Claude composer marker skips even with bot name in text', () => {
  // Composer-rendered text mentioning "Claude" by name is still a Claude voice — skip
  expect(isMentionedPure('Hey Claude, can you check this *Sent using* Claude', undefined, BOT_ID, BOT, false)).toBe(false)
})

test('isMentionedPure: bot name without tag triggers (case-insensitive word boundary)', () => {
  expect(isMentionedPure('Claude, peux-tu m\'aider ?', undefined, BOT_ID, BOT, false)).toBe(true)
  expect(isMentionedPure('hey CLAUDE help', undefined, BOT_ID, BOT, false)).toBe(true)
})

test('isMentionedPure: bot name as substring does not trigger (word boundary respected)', () => {
  // "claudette" should not match "claude"
  expect(isMentionedPure('claudette is a name', undefined, BOT_ID, BOT, false)).toBe(false)
})

test('isMentionedPure: human in engaged thread without tag triggers (regression — engagement preserved)', () => {
  expect(isMentionedPure('any update on this?', undefined, BOT_ID, BOT, true)).toBe(true)
})

test('isMentionedPure: another bot in engaged thread without Claude marker triggers (non-Claude bots not skipped)', () => {
  // Cronjob Response from Jaskier in engaged thread — bot may decide to weigh in
  expect(isMentionedPure('Cronjob Response: openrouter_spend_monitor', undefined, BOT_ID, BOT, true)).toBe(true)
})

test('isMentionedPure: parent_user_id pointing to bot triggers (replies to bot message)', () => {
  expect(isMentionedPure('thanks', BOT_ID, BOT_ID, BOT, false)).toBe(true)
})

test('isMentionedPure: extraPatterns regex matches', () => {
  expect(isMentionedPure('hey assistant please help', undefined, BOT_ID, BOT, false, ['\\bassistant\\b'])).toBe(true)
})

test('isMentionedPure: empty BOT_USER_ID and BOT_NAME falls through to thread engagement', () => {
  // Boot edge case: auth.test() not yet resolved
  expect(isMentionedPure('hello', undefined, '', '', true)).toBe(true)
  expect(isMentionedPure('hello', undefined, '', '', false)).toBe(false)
})

// --- hermesSessionKey tests ---
// Pure helper copied from server.ts. Format matches ~/.hermes/sessions/sessions.json keys.

function hermesSessionKey(channelType: string, chatId: string, threadId: string): string {
  const kind = channelType === 'im' ? 'dm' : 'group'
  return `agent:main:slack:${kind}:${chatId}:${threadId}`
}

test('hermesSessionKey: DM produces dm-prefixed key', () => {
  expect(hermesSessionKey('im', 'D0ASEN09U5A', '1777265600.962049'))
    .toBe('agent:main:slack:dm:D0ASEN09U5A:1777265600.962049')
})

test('hermesSessionKey: channel/group produces group-prefixed key', () => {
  expect(hermesSessionKey('channel', 'C0AV95P4E91', '1777428105.503689'))
    .toBe('agent:main:slack:group:C0AV95P4E91:1777428105.503689')
  expect(hermesSessionKey('group', 'C0ASNC6UE4R', '1775975623.730469'))
    .toBe('agent:main:slack:group:C0ASNC6UE4R:1775975623.730469')
})

test('hermesSessionKey: unknown channelType defaults to group (matches Hermes convention for non-DM)', () => {
  expect(hermesSessionKey('mpim', 'G123', '1700000000.000000'))
    .toBe('agent:main:slack:group:G123:1700000000.000000')
})

// --- Claude session continuity (per Slack thread) ---
// Pure logic copied from server.ts. Same TTL/key conventions as engaged-threads.

const CLAUDE_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

type ClaudeSession = { sessionId: string; expiresAt: number }
type ClaudeSessions = Record<string, ClaudeSession>

function pruneClaudeSessions(sessions: ClaudeSessions, now: number): boolean {
  let changed = false
  for (const key of Object.keys(sessions)) {
    if (sessions[key]!.expiresAt <= now) { delete sessions[key]; changed = true }
  }
  return changed
}

function setClaudeSession(sessions: ClaudeSessions, chatId: string, threadRootTs: string, sessionId: string, now: number): void {
  sessions[engagedKey(chatId, threadRootTs)] = { sessionId, expiresAt: now + CLAUDE_SESSION_TTL_MS }
}

function getClaudeSession(sessions: ClaudeSessions, chatId: string, threadRootTs: string, now: number): string | undefined {
  const e = sessions[engagedKey(chatId, threadRootTs)]
  return e && e.expiresAt > now ? e.sessionId : undefined
}

test('claudeSessions: setClaudeSession then getClaudeSession returns the id within TTL', () => {
  const s: ClaudeSessions = {}
  const now = Date.now()
  setClaudeSession(s, 'C1', 'T1', 'uuid-1', now)
  expect(getClaudeSession(s, 'C1', 'T1', now)).toBe('uuid-1')
})

test('claudeSessions: getClaudeSession returns undefined past TTL', () => {
  const s: ClaudeSessions = {}
  const past = Date.now() - CLAUDE_SESSION_TTL_MS - 1000
  setClaudeSession(s, 'C1', 'T1', 'uuid-1', past)
  expect(getClaudeSession(s, 'C1', 'T1', Date.now())).toBeUndefined()
})

test('claudeSessions: pruneClaudeSessions removes expired entries', () => {
  const now = Date.now()
  const s: ClaudeSessions = {
    'C1:T1': { sessionId: 'old',     expiresAt: now - 1 },
    'C1:T2': { sessionId: 'fresh',   expiresAt: now + 60_000 },
  }
  expect(pruneClaudeSessions(s, now)).toBe(true)
  expect(Object.keys(s)).toEqual(['C1:T2'])
})

test('claudeSessions: per-thread isolation — different thread, different session', () => {
  const s: ClaudeSessions = {}
  const now = Date.now()
  setClaudeSession(s, 'C1', 'T1', 'uuid-A', now)
  setClaudeSession(s, 'C1', 'T2', 'uuid-B', now)
  expect(getClaudeSession(s, 'C1', 'T1', now)).toBe('uuid-A')
  expect(getClaudeSession(s, 'C1', 'T2', now)).toBe('uuid-B')
})

// --- scrubTokens ---

function scrubTokens_inline(s: string): string {
  return s.replace(/(xox[a-z]-|xapp-)[A-Za-z0-9-]+/g, '[REDACTED]')
}

test('scrubTokens: redacts xoxb tokens in error strings', () => {
  expect(scrubTokens_inline('failed: xoxb-1234-abcd-token bad'))
    .toBe('failed: [REDACTED] bad')
})

test('scrubTokens: redacts xapp tokens too', () => {
  expect(scrubTokens_inline('Socket Mode: xapp-1-A-deadbeef'))
    .toBe('Socket Mode: [REDACTED]')
})

test('scrubTokens: leaves non-token strings untouched', () => {
  expect(scrubTokens_inline('plain message no secrets'))
    .toBe('plain message no secrets')
})

// --- Prompt construction ---

type RunMeta = { chat_id: string; thread_id: string; user_id: string; hermes_session_key: string }

function buildClaudePrompt(content: string, meta: RunMeta, attachments: string[]): string {
  const lines = [
    `[slack chat_id=${meta.chat_id} thread_id=${meta.thread_id} user_id=${meta.user_id}]`,
    `[hermes_session_key=${meta.hermes_session_key}]`,
  ]
  if (attachments.length > 0) lines.push(`[attachments: ${attachments.join('; ')}]`)
  lines.push('', content)
  return lines.join('\n')
}

test('buildClaudePrompt: includes meta header and content', () => {
  const meta: RunMeta = {
    chat_id: 'C0AV95P4E91',
    thread_id: '1777524940.159289',
    user_id: 'U0ASEMZU50C',
    hermes_session_key: 'agent:main:slack:group:C0AV95P4E91:1777524940.159289',
  }
  const out = buildClaudePrompt('hello', meta, [])
  expect(out).toContain('chat_id=C0AV95P4E91')
  expect(out).toContain('thread_id=1777524940.159289')
  expect(out).toContain('user_id=U0ASEMZU50C')
  expect(out).toContain('hermes_session_key=agent:main:slack:group:')
  expect(out.endsWith('hello')).toBe(true)
})

test('buildClaudePrompt: includes attachments line when present', () => {
  const meta: RunMeta = { chat_id: 'C1', thread_id: 'T1', user_id: 'U1', hermes_session_key: 'k' }
  const out = buildClaudePrompt('hi', meta, ['photo.png (image/png, 100KB)'])
  expect(out).toContain('[attachments: photo.png (image/png, 100KB)]')
})

test('buildClaudePrompt: no attachments line when empty', () => {
  const meta: RunMeta = { chat_id: 'C1', thread_id: 'T1', user_id: 'U1', hermes_session_key: 'k' }
  const out = buildClaudePrompt('hi', meta, [])
  expect(out).not.toContain('[attachments')
})
