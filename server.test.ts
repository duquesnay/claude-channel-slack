import { test, expect } from 'bun:test'
import { join, sep } from 'path'
import { realpathSync } from 'fs'
import { tmpdir } from 'os'

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
