---
name: access
description: Manage Slack channel access — approve pairings, edit allowlists, set DM policy. Use when the user asks to pair, approve someone, check who's allowed, or change access policy.
user-invocable: true
allowed-tools:
  - Read
  - Bash(ls *)
  - Bash(mkdir *)
  - Bash(cat *)
  - Bash(curl *)
  - Bash(python3 *)
---

# /slack:access

Manage access control for the Slack channel plugin.

**State file**: `~/.claude/channels/slack/access.json`

## Implementation — IMPORTANT

**DO NOT use MCP tools or shell commands.** Use only `Read` and `Write` tools on the state file directly.

When invoked with no arguments: Read `~/.claude/channels/slack/access.json` and display a formatted summary (policy, allowFrom list, pending pairings count, groups). If the file doesn't exist, say "No access.json — default policy: pairing, no users allowlisted."

**IMPORTANT — writing access.json**: Always use `Bash(python3 ...)` to write `access.json`, never the `Write` tool (blocked outside project dir). Pattern:
```bash
python3 -c "
import json
with open('$HOME/.claude/channels/slack/access.json') as f: d = json.load(f)
# ... modify d ...
with open('$HOME/.claude/channels/slack/access.json', 'w') as f: json.dump(d, f, indent=2)
"
```

## Commands

| Command | Effect |
| --- | --- |
| `/slack:access` | Show current state: policy, allowlist, pending pairings |
| `/slack:access pair <code>` | Approve pairing — adds user to allowFrom, sends Slack confirmation |
| `/slack:access deny <code>` | Discard a pending code |
| `/slack:access allow <user_id or name>` | Add by Slack user ID (U...) directly, or resolve by name |
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

## User lookup by name (`/slack:access allow <name>`)

When the argument does NOT start with `U` (i.e. it's a name, not a user_id):

1. Read the BOT_TOKEN from `~/.claude/channels/slack/.env`
2. Call the Slack API:
   ```bash
   curl -s "https://slack.com/api/users.list?limit=200" \
     -H "Authorization: Bearer <BOT_TOKEN>"
   ```
3. Filter members where `display_name`, `real_name`, or `name` contains the search term (case-insensitive). Exclude bots and deleted users.
4. If 0 matches: say "No user found matching '<name>'."
5. If 1 match: show `real_name (user_id)` and ask for confirmation before adding to allowFrom.
6. If multiple matches: list all candidates with their user_ids and ask which one to add.
7. After confirmation: add the chosen `user_id` to `allowFrom` in `access.json` and save.

**Never add to allowFrom without explicit user confirmation.**

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
