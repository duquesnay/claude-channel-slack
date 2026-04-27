# planning/user-stories.md

### CHAN1: Developer scaffolds claude-channel-slack plugin

**User**: Développeur contribuant au plugin (jasquier)
**Outcome**: Structure complète du plugin créée — tous les fichiers existent avec leur forme finale, le projet builder, et le développement itératif des features peut commencer sans refactoring de structure
**Context**: Aucun projet existant sous ~/dev/nestor/claude-channel-slack/ — le plugin Discord (claude-plugins-official) sert de référence architecturale

**Acceptance Criteria**:
- `~/dev/nestor/claude-channel-slack/` contient : `server.ts`, `package.json`, `bun.lock`, `.mcp.json`, `.npmrc`, `README.md`, `ACCESS.md`, `.claude-plugin/plugin.json`, `skills/access/SKILL.md`, `skills/configure/SKILL.md`
- `package.json` déclare `@modelcontextprotocol/sdk` et `@slack/bolt` comme dépendances
- `bun install` s'exécute sans erreur
- `server.ts` compile sans erreur TypeScript (vérifié via `bun --check server.ts` ou `tsc --noEmit`)
- Le plugin est initialisé en git repo avec un premier commit
- Le `.mcp.json` lance correctement le server via `bun run start`
- Les skills `access` et `configure` sont présents (contenu stub acceptable pour CHAN1)

**Implementation Notes**:
- Stack : Bun + `@modelcontextprotocol/sdk@^1.0.0` + `@slack/bolt@^3` (Socket Mode)
- Architecture identique au plugin Discord : MCP server stdio, `claude/channel` capability, tools reply/react/edit_message/fetch_messages/download_attachment
- Mapping Discord → Slack : `discord.js` Client → `@slack/bolt` App + Socket Mode ; snowflakes → user IDs (U…) / channel IDs (C…, D…) ; `message.content` → `event.text` ; DM `ChannelType.DM` → `event.channel_type === 'im'` ; `msg.react()` → `reactions.add` ; `ch.send()` → `chat.postMessage` ; `msg.edit()` → `chat.update` ; `ch.messages.fetch()` → `conversations.history` ; attachments `url` → `url_private` (bearer auth)
- Permission relay : Discord ActionRow → Slack Block Kit buttons (`block_actions`)
- State dir : `~/.claude/channels/slack/` (miroir exact de `discord`)
- Token Slack : `SLACK_BOT_TOKEN` (xoxb-) + `SLACK_APP_TOKEN` (xapp-, Socket Mode)

**Source**: USER_REQUEST + analyse plugin Discord (server.ts 900 lignes) — session 2026-04-28

---

### CHAN2: Utilisateur reçoit et envoie des DMs Slack à Claude

**User**: Utilisateur Slack (jasquier) envoyant un message en DM au bot
**Outcome**: Le message arrive dans la session Claude Code comme notification `notifications/claude/channel`, Claude répond via le tool `reply` et le message apparaît dans Slack
**Context**: CHAN1 livré — scaffold opérationnel. Actuellement aucune intégration Slack→Claude native (slack-claude-bot fait du polling, Hermes a slack_admin MCP mais différent modèle)

**Acceptance Criteria**:
- Envoyer un DM au bot Slack → Claude reçoit le message dans la session `--channels`
- Claude appelle `reply({chat_id, text})` → le message apparaît dans Slack
- Le bot affiche "est en train de taperet…" (typing indicator) pendant le traitement
- Le threading fonctionne : `reply({reply_to: message_ts})` crée un thread Slack
- Les métadonnées du message sont transmises : `user`, `user_id`, `ts`, `chat_id`

**Source**: USER_REQUEST — port Discord plugin session 2026-04-28

---
