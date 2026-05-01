# `--channels` with third-party plugins — investigation log

**Date** : 2026-04-30 → 2026-05-01
**Outcome** : `--channels` mode is not viable today for third-party MCP plugins on a headless LaunchDaemon. The agent loop never fires on inbound notifications even when every other piece of the chain is verified working. Workaround paths require either a binary patch, an Anthropic-side allowlist addition, or an architectural pivot away from `--channels`.

## What we wanted

Run `claude-channel-slack@nestor` (our custom MCP plugin, this repo) as a long-running LaunchDaemon (`com.jasquier.claude-channel-slack`). On Slack message arrival, the bun MCP server pushes a `notifications/claude/channel` to the Claude Code session, the agent runs a turn, calls `mcp__hermes__messages_read` for context if needed, and replies via `mcp__slack__reply`.

## What we observed

Across multiple daemon restarts, with and without bypass flags, with manual and programmatic dialog acceptance, with permission wildcards in place :

1. Slack message arrives at the bun MCP server (Socket Mode, verified via `lsof` TCP ESTABLISHED to AWS Slack endpoint)
2. `handleInbound` runs, `markEngaged` writes to `~/.claude/channels/slack/engaged-threads.json` (verified by mtime + entry presence)
3. `ackReaction` posts the eye emoji on the inbound message (verified via Slack API `reactions` field)
4. `mcp.notification({ method: 'notifications/claude/channel', params: { content, meta } })` is called
5. **Claude Code drops the notification silently.** Session `~/.claude/sessions/<pid>.json` `status` stays `idle`. No new jsonl in the project dir. No spinner / Cogitating / tool calls in the TUI pane.

## Why — root cause in the binary

Decompiled strings from `/opt/homebrew/bin/claude` (versions 2.1.123 and 2.1.126 both checked) :

```js
function YJ_(H, _, q) {
  if (!_?.experimental?.["claude/channel"]) return {action:"skip", kind:"capability", ...};
  if (!UZH()) return {action:"skip", kind:"disabled", ...};   // tengu_harbor flag
  if (!wq()?.accessToken) return {action:"skip", kind:"auth", ...};
  let K = N7(),                                                // tier (user/team/enterprise)
      O = K==="team"||K==="enterprise",
      T = O ? v6("policySettings") : void 0;
  if (O && T?.channelsEnabled !== !0) return {action:"skip", kind:"policy", ...};
  let A = gZH(H, wj());                                        // find this server's entry in the channel list
  if (!A) return {action:"skip", kind:"session", ...};
  if (A.kind === "plugin") {
    let $ = q ? M9(q).marketplace : void 0;
    if ($ !== A.marketplace) return {action:"skip", kind:"marketplace", ...};
    if (!A.dev) {
      let {entries: z, source: Y} = nL8(K, T?.allowedChannelPlugins);
      if (!z.some((w) => w.plugin === A.name && w.marketplace === A.marketplace))
        return {action:"skip", kind:"allowlist", reason: `... not on the approved channels allowlist (use --dangerously-load-development-channels for local dev)`};
    }
  }
  return {action:"register"};
}

function nL8(H, _) {
  if ((H==="team"||H==="enterprise") && _) return {entries: _, source: "org"};
  return {entries: GT6(), source: "ledger"};
}

function GT6() {
  let H = X_("tengu_harbor_ledger", []);
  let _ = as5().safeParse(H);
  return _.success ? _.data : [];
}
```

For user-tier accounts (Pro/Max), `nL8` reads from `cachedGrowthBookFeatures.tengu_harbor_ledger` in `~/.claude.json` — a server-controlled feature-flag fetched from Anthropic's GrowthBook on session start. Currently contains 4 entries :

```json
[
  {"marketplace": "claude-plugins-official", "plugin": "discord"},
  {"marketplace": "claude-plugins-official", "plugin": "telegram"},
  {"marketplace": "claude-plugins-official", "plugin": "fakechat"},
  {"marketplace": "claude-plugins-official", "plugin": "imessage"}
]
```

`{marketplace: "nestor", plugin: "claude-channel-slack"}` is not on the list. For team/enterprise tiers, `T?.allowedChannelPlugins` (from `policySettings`) would be used — but for Pro/Max the GrowthBook ledger wins regardless of `~/.claude/settings.json allowedChannelPlugins` content.

## What we tried

### A. Forge the GrowthBook cache

```bash
jq '.cachedGrowthBookFeatures.tengu_harbor_ledger += [{"marketplace":"nestor","plugin":"claude-channel-slack"}]' \
  ~/.claude.json > /tmp/x && mv /tmp/x ~/.claude.json
```

**Result** : entry survives until next session start, then GrowthBook refreshes the cache wholesale and our entry is dropped before YJ_ runs. Confirmed by reading the ledger after restart : back to 4 official entries.

### B. `--dangerously-load-development-channels plugin:claude-channel-slack@nestor --channels plugin:claude-channel-slack@nestor`

The dev flag's purpose is to bypass the allowlist check by setting `A.dev = true` on the channel entry. The binary's `ie([...Yj(), ...T.map(D => ({...D, dev: !0}))])` adds the dev entries to `d_.allowedChannels` after the React `DevChannelsDialog` `onAccept` fires.

**Result** : daemon accepts the dialog (verified via `expect` blind-Enter and via manual Enter from `tmux attach`). Banner prints "Listening for channel messages from: plugin:claude-channel-slack@nestor". Status stays idle on inbound. Same skip behavior as without the flag.

Hypothesis : race between MCP server registration (which calls YJ_) and the async `ie(...)` that adds dev entries. By the time the bun MCP server announces its `experimental.claude/channel` capability, the dev entries aren't yet in `d_.allowedChannels`, so YJ_ returns skip. Once skipped, the verdict sticks for the session — no retry.

### C. `--dangerously-load-development-channels plugin:... ` only (no `--channels`)

Tried in case the duplicate entries (one with `dev:false` from `--channels`, one with `dev:true` from the dev flag) caused `gZH` to find the wrong one. With dev flag alone the banner still prints "Listening" and bun spawns, but the registration check still skips. Same result.

### D. Removed `mcpServers.slack` from `~/.claude.json` (kept only the plugin marketplace install)

Theory : double registration of the same bun server (once via user-scope mcpServers, once via plugin) was confusing YJ_. Confirmed via `ps` that we had 2 bun children pre-cleanup, 1 post-cleanup. **No effect** on YJ_ verdict.

### E. Permission wildcards `mcp__slack__*`, `mcp__hermes__*` + `--permission-mode acceptEdits`

In case the agent was firing but blocked on permission prompts to call `reply` or `messages_read`. Permissions added globally via `~/.claude/settings.local.json` `permissions.allow`. **No effect** — the agent never tries any tool because it never starts a turn.

### F. Tried `--permission-mode bypassPermissions`

Triggers a secondary React dialog with default option "No, exit". A blind-Enter exits the daemon. Not viable for headless without another expect prompt handler.

## Bypass paths remaining

1. **Binary patch** — locate the YJ_ skip-allowlist branch and replace `if (!A.dev)` with `if (false)` so allowlist check is always skipped. Risky : reapplied every Claude Code update, and reverse-engineering the minified bundle correctly requires care to not break unrelated checks.

2. **Anthropic-side fix** — file an issue requesting (a) `claude-channel-slack@nestor` (or any nestor plugin) added to the GrowthBook ledger, or (b) a non-interactive bypass like `CLAUDE_ACCEPT_DEV_CHANNELS=1` env var or persisted ack file. Long lead time, low probability for an arbitrary third-party plugin.

3. **Architectural pivot — drop `--channels`** — bun MCP server stays standalone (no parent claude --channels session needed). On inbound, bun spawns `claude -p` per message with the Hermès MCP available via user-scope `~/.claude.json` and the `hermes-bridge` skill. Use `--resume <session_id>` per Slack thread for continuity. Loses the long-running session model (each message = fresh agent boot, ~3-5 s overhead), but completely sidesteps the YJ_ gate. This is the legacy `slack-claude-bot/poll.mjs` pattern, modernized.

## What still works

The architectural pieces around `--channels` are sound and useful even if `--channels` itself isn't :
- Hermès MCP bridge wired into `~/.claude.json mcpServers.hermes` — validated end-to-end (`mcp__hermes__messages_read` returns real content from any non-channels session)
- `hermes_session_key` in inbound notification meta (commit `dc21a5d`)
- Skill `~/.claude/skills/hermes-bridge/SKILL.md` documenting the read-only bridge pattern
- Anti-Claude-on-Claude `isMentioned` patch (commit `240e558`) — applies regardless of trigger mechanism
- Engaged-threads persistence (existing, pre-investigation)

These ride along on whichever trigger mechanism we end up using.

## Decision (2026-05-01)

Hold the `--channels` path. Restart the daemon in its pre-investigation configuration (no dev flag, original `script -q /dev/null` wrap), accept that channel notifications are silently dropped, and add the streaming UX (eye → thinking → progressive edit_message → final) directly in `bun server.ts` so the bot at least signals presence even without the agent firing. Open an Anthropic issue in parallel.

## Files of interest

- `/opt/homebrew/bin/claude` — the binary (YJ_, nL8, GT6, ie functions)
- `~/.claude.json` — `cachedGrowthBookFeatures.tengu_harbor_ledger`, `mcpServers`
- `~/.claude/settings.json` & `settings.local.json` — `allowedChannelPlugins` (ignored for user tier), `permissions.allow`
- `~/.claude/sessions/<pid>.json` — `status` field (always `idle` for our daemon)
- `~/.claude/projects/-Users-jasquier/<sessionId>.jsonl` — would be created on first agent turn (never created for our daemon)
- `~/.claude/channels/slack/engaged-threads.json` — bun-side write, confirms inbound reaches bun
- `/Users/jasquier/dev/nestor/claude-channel-slack/server.ts` — the bun MCP server
- `/Users/jasquier/dev/nestor/claude-channel-slack/run-with-dev-channels.expect` — wrapper that auto-accepts the dev dialog (kept on main, useful if Anthropic ever flips the gate)

## Reproduction

```bash
# Confirm ledger state
jq '.cachedGrowthBookFeatures.tengu_harbor_ledger' ~/.claude.json

# Confirm bun receives messages (eye reaction fires)
# Send a message to the bot in DM or @mention in #test-channel
curl -s -H "Authorization: Bearer $(grep SLACK_BOT_TOKEN ~/.claude/channels/slack/.env | cut -d= -f2-)" \
  "https://slack.com/api/conversations.history?channel=<chat>&limit=3" | jq '.messages[].reactions'

# Confirm Claude Code session never goes busy
watch -n 1 "jq '.status, .updatedAt' ~/.claude/sessions/<daemon_pid>.json"
```
