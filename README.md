# claude-channel-slack

Connect a Slack workspace to your Claude Code with an MCP server.

When the bot receives a DM (or an @mention in an opted-in channel), the MCP server forwards the message to Claude and provides tools to reply, react, and edit messages.

## Prerequisites

- [Bun](https://bun.sh) — `curl -fsSL https://bun.sh/install | bash`
- A Slack app with Socket Mode enabled (two tokens required — see `/slack:configure`)

## Quick setup

**1.** Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps) with Socket Mode enabled.
Run `/slack:configure` for the full setup walkthrough.

**2.** Launch Claude Code with the channel flag:

```sh
claude --channels plugin:slack@nestor
```

**3.** DM your bot on Slack — it replies with a pairing code. In Claude Code:

```
/slack:access pair <code>
/slack:access policy allowlist
```

## Tools

| Tool | Purpose |
| --- | --- |
| `reply` | Send a message. `reply_to` (message ts) for threading |
| `react` | Add emoji reaction (name without colons: `thumbsup`) |
| `edit_message` | Edit a previously sent message (progress updates) |
| `fetch_messages` | Fetch recent channel history |
| `download_attachment` | Download Slack file attachments to local inbox |

## Access control

See **ACCESS.md** and `/slack:access` for policy management.
Tokens are stored in `~/.claude/channels/slack/.env` (mode 0600).

## State

All state lives in `~/.claude/channels/slack/`:
- `access.json` — policy, allowlist, pending pairings
- `inbox/` — downloaded attachments
- `approved/` — inter-process pairing confirmation

Override with `SLACK_STATE_DIR` to run multiple instances.
