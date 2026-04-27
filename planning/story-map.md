# planning/story-map.md

## Epic CHAN: Slack Channel Plugin for Claude Code

**Goal**: Port du plugin Discord channel vers Slack — Claude Code reçoit et répond aux messages Slack via `claude --channels plugin:slack@nestor`
**Business Value**: Remplacement natif de slack-claude-bot (polling) par une intégration MCP first-class, avec permission relay, threading, réactions et pièces jointes. Cohérent avec l'architecture Hermes/nestor.

```
CHAN: claude-channel-slack
├── CHAN1: Scaffold — structure plugin prête (medium)
│   └── Tous les fichiers à leur forme finale, compile, git init
├── CHAN2: DM bidirectionnel — inbound + reply (large)
│   ├── Socket Mode connexion + event routing
│   ├── Pairing flow (code 6 hex, expiry 1h)
│   └── reply tool (text + threading + typing indicator)
├── CHAN3: Access control — pairing + allowlist (medium)
│   ├── dmPolicy: pairing / allowlist / disabled
│   ├── allowFrom par user_id Slack
│   └── skills/access SKILL.md (pair, allow, remove, policy)
├── CHAN4: Réactions emoji (small)
│   └── react tool → reactions.add
├── CHAN5: Édition de messages (small)
│   └── edit_message tool → chat.update
├── CHAN6: Historique des messages (small)
│   └── fetch_messages tool → conversations.history
├── CHAN7: Pièces jointes (medium)
│   ├── download_attachment tool
│   └── Slack url_private → bearer auth download
├── CHAN8: Permission relay Block Kit (large)
│   ├── permission_request → Block Kit message avec boutons Allow/Deny
│   ├── block_actions handler → notification MCP
│   └── Text fallback : "y/n <code>" pour permission relay
└── CHAN9: Déploiement headless 24/7 tanuki (medium)
    ├── LaunchDaemon ou tmux + launchd
    └── --permission-mode acceptEdits + settings allowlist
```

**Statut actuel**: CHAN1 en cours
**Note technique**: Files.uploadV2 Slack (3 étapes) est plus complexe que Discord multipart direct — prévoir CHAN2 décomposé si besoin.
