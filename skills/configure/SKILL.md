---
name: configure
description: Set up the Slack channel — save the bot tokens and review access policy. Use when the user pastes Slack tokens or asks to configure Slack.
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Bash(ls *)
  - Bash(mkdir *)
---

# /slack:configure

Configure the Slack channel plugin with your bot tokens.

## Usage

```
/slack:configure <SLACK_BOT_TOKEN> <SLACK_APP_TOKEN>
```

Both tokens are required:
- **SLACK_BOT_TOKEN** (`xoxb-...`) — Bot OAuth token
- **SLACK_APP_TOKEN** (`xapp-...`) — App-level token for Socket Mode

## Slack app setup

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → Create New App → From scratch
2. Enable **Socket Mode** (Settings → Socket Mode) — generates the `xapp-` token with `connections:write` scope
3. Add **Bot Token Scopes** (OAuth & Permissions):
   `chat:write`, `im:history`, `im:write`, `channels:history`, `groups:history`,
   `mpim:history`, `app_mentions:read`, `reactions:write`, `users:read`, `files:read`
4. Enable **Event Subscriptions** and subscribe to:
   `message.im`, `message.channels`, `message.groups`, `message.mpim`
5. Enable **Interactivity** (required for permission relay buttons)
6. Install app to workspace → copy the `xoxb-` Bot Token

## Implementation

Write tokens to `~/.claude/channels/slack/.env` (mode 0600):

```
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
```

Create directory if needed (mode 0700). After writing, instruct the user to restart
the `claude --channels` session so the server picks up the new tokens.
