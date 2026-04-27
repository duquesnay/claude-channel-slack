---
name: access
description: Manage Slack channel access — approve pairings, edit allowlists, set DM policy. Use when the user asks to pair, approve someone, check who's allowed, or change access policy.
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Bash(ls *)
  - Bash(mkdir *)
  - Bash(cat *)
---

# /slack:access

Manage access control for the Slack channel plugin.

**State file**: `~/.claude/channels/slack/access.json`

## Commands

| Command | Effect |
| --- | --- |
| `/slack:access` | Show current state: policy, allowlist, pending pairings |
| `/slack:access pair <code>` | Approve pairing — adds user to allowFrom, sends Slack confirmation |
| `/slack:access deny <code>` | Discard a pending code |
| `/slack:access allow <user_id>` | Add a Slack user ID (U...) directly |
| `/slack:access remove <user_id>` | Remove from allowlist |
| `/slack:access policy allowlist` | Set dmPolicy: pairing / allowlist / disabled |
| `/slack:access group add <channel_id>` | Enable a Slack channel (C...). Flags: `--no-mention`, `--allow U1,U2` |
| `/slack:access group rm <channel_id>` | Disable a channel |
| `/slack:access set <key> <value>` | Set config: ackReaction, replyToMode, textChunkLimit, chunkMode, mentionPatterns |

## DM policies

| Policy | Behavior |
| --- | --- |
| `pairing` (default) | Reply with a pairing code. Approve with `/slack:access pair <code>` |
| `allowlist` | Drop silently |
| `disabled` | Drop everything |

## User IDs

Slack user IDs look like `U04AB1CD2EF`. Find yours:
- Slack profile → three-dot menu → Copy member ID
- Or: Preferences → Advanced → enable "Always show member ID in member profile"

## Pairing implementation

When the user runs `/slack:access pair <code>`:
1. Read `~/.claude/channels/slack/access.json`
2. Find the matching entry in `pending`
3. Move `senderId` to `allowFrom`, remove from `pending`
4. Write `chatId` (DM channel D...) to `~/.claude/channels/slack/approved/<senderId>`
5. Save `access.json`

The server polls `approved/` every 5s and sends "Paired! Say hi to Claude." confirmation.

## Config keys (via `/slack:access set`)

| Key | Values | Default |
| --- | --- | --- |
| `ackReaction` | emoji name without colons, e.g. `eyes` | none |
| `replyToMode` | `first` / `all` / `off` | `first` |
| `textChunkLimit` | integer ≤ 3000 | 3000 |
| `chunkMode` | `length` / `newline` | `length` |
| `mentionPatterns` | JSON array of regex strings | none |

## access.json schema

```jsonc
{
  "dmPolicy": "pairing",
  "allowFrom": ["U04AB1CD2EF"],
  "groups": {
    "C04AB1CD2EF": { "requireMention": true, "allowFrom": [] }
  },
  "ackReaction": "eyes",
  "replyToMode": "first",
  "textChunkLimit": 3000,
  "chunkMode": "newline"
}
```
