# Slack — Access & Delivery

The default policy is **pairing**. An unknown sender gets a code in reply; you approve with `/slack:access pair <code>`. Once approved, their messages pass through.

## At a glance

| | |
| --- | --- |
| Default policy | `pairing` |
| Sender ID | Slack user ID (e.g. `U04AB1CD2EF`) |
| Channel key | Slack channel ID (C... or D... for DMs) |
| Config file | `~/.claude/channels/slack/access.json` |

## DM policies

| Policy | Behavior |
| --- | --- |
| `pairing` (default) | Reply with a pairing code. Approve with `/slack:access pair <code>` |
| `allowlist` | Drop silently. Use once everyone is on the list |
| `disabled` | Drop everything |

## User IDs

Slack user IDs look like `U04AB1CD2EF`. Find yours via your profile → three-dot menu → Copy member ID.

## Channel groups

Off by default. Opt in per channel ID:

```
/slack:access group add C04AB1CD2EF
```

With the default `requireMention: true`, the bot only responds when @mentioned or replied to.
Pass `--no-mention` to respond to every message in the channel.

## Delivery config

Set via `/slack:access set <key> <value>`:

| Key | Default | Description |
| --- | --- | --- |
| `ackReaction` | none | Emoji name (no colons) to react on receipt, e.g. `eyes` |
| `replyToMode` | `first` | Threading on chunked replies: `first`, `all`, `off` |
| `textChunkLimit` | 3000 | Max chars before splitting |
| `chunkMode` | `length` | Split strategy: `length` or `newline` |

## access.json schema

```jsonc
{
  "dmPolicy": "pairing",
  "allowFrom": ["U04AB1CD2EF"],
  "groups": {
    "C04AB1CD2EF": { "requireMention": true, "allowFrom": [] }
  },
  "mentionPatterns": ["^hey claude\\b"],
  "ackReaction": "eyes",
  "replyToMode": "first",
  "textChunkLimit": 3000,
  "chunkMode": "newline"
}
```
