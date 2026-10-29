# Herdr Matrix

Herdr plugin that publishes agent updates to encrypted Matrix rooms and receives commands from the owner's chat.

Status: version 0.25.7. See `CHANGELOG.md` for what is verified and what is pending, and `docs/` for the design of each phase.

License: GNU GPL v3 (see `LICENSE`).

## Requirements

- Herdr 0.9.5 or later, on Linux or macOS.
- Node.js 22 or later.
- A Matrix server (Synapse) with HTTPS. One user for the bot and another for the owner.

## Installation

```
npm ci --ignore-scripts
herdr plugin link /path/to/herdr-matrix
```

`npm ci` installs the versions pinned in `package-lock.json`. `--ignore-scripts` prevents third-party scripts from running.

Alternative with a script (macOS and Linux). It checks Node and Herdr, installs dependencies and links the plugin. It always relinks, so Herdr registers the current manifest:

```
scripts/install.sh            # installs and links
scripts/install.sh --setup    # also runs the interactive setup
```

To uninstall. It revokes the session on the server, unlinks the plugin and keeps the configuration:

```
scripts/uninstall.sh          # keeps config.json
scripts/uninstall.sh --purge  # also deletes configuration and state
```

The scripts do not start the bridge. If it is running, `uninstall.sh` refuses to continue. It warns if directories from a previous version remain (`~/.config/herdr-matrix`, `~/.local/state/herdr-matrix`); you can delete them by hand.

## Configuration

Run `setup` from a terminal inside the plugin directory. Herdr's `setup` action has no interactive terminal.

```
node src/index.mjs setup
```

It asks for the server URL, the bot's user and password (without echo), and the owner's MXID. It creates the encrypted control room and invites the owner. The bot device is new on every `setup`.

Then verify the bot's device from the owner's client:

```
node src/index.mjs verify
```

The bridge sends a verification request to the control room. The owner accepts it in Element and compares the emojis shown in the console. If the bot has no cross-signing keys, `verify` creates them and asks for the bot's password (without echo; it is only kept in memory). Do not run the bridge while running `verify`.

If the bot's device stops working (for example, `Failed to process outgoing request ... already exists` in the log), see `docs/19-recuperar-dispositivo-bot.md`.

## Usage

```
node src/index.mjs run
```

Runs the bridge until SIGINT or SIGTERM. If Herdr's subscription closes or there is a transient failure, it retries with increasing waits (1 s, 2 s, 4 s… up to 60 s). After 5 consecutive failures it exits with an error. An invalid configuration exits without retrying.

When Herdr starts, the manifest's `[[startup]]` runs `node src/index.mjs startup`. That command starts the bridge in the background and exits. Its output goes to `state/bridge.log`. Without a configuration, or with the bridge already running, it does nothing.

Each Herdr workspace has its own encrypted room. It is created when the workspace appears, renamed when the workspace is renamed, and archived (read-only) when it closes. Each tab of a workspace also has its own room, named `workspace-tab` (for example `herdr-matrix-rama-beta`). If the tab label has no valid characters, the tab number is used instead. Tab rooms are created one at a time, with a pause if the server rate-limits them.

**Before using the chat, the project must be started.** The chat answers only through the agent of its own workspace or tab (Claude Code or opencode). Open the agent in the pane before writing in its room. With opencode, the chat does not open without an open agent. For Claude Code, see the next section.

Chat rules:

- From a workspace room, a workspace with more than one agent does not open the chat.
- From a tab room, the chat goes to the agent of that tab, even if the workspace has several agents. A tab without an agent does not open the chat, and the bridge does not start one there.
- Messages from a room reach only the agent of its workspace or tab. No agent from another workspace, or from another tab of the same workspace, answers in that room.
- opencode runs in the workspace's directory, not the bridge's directory.
- Before each message, the bridge checks that the workspace's agent is still the type the session was opened with. If it changed (for example, from Claude Code to opencode), nothing is sent: the session pauses and the room says so. Write `salir`, then open the session again with the new agent's type.

### Chat with Claude Code

Write `chat claude` in the workspace's room and confirm with `confirmar`. The bridge:

1. Looks for the workspace's agent. If there is one, it uses its pane. If there is none, it starts Claude Code in the workspace's main pane (`w1:p1`) and waits up to 90 s for it to be ready.
2. Asks the agent to reply in plain, brief text suitable for chat.
3. Writes each room message into the pane with `agent.prompt`, and the bridge waits until the agent is idle again (up to 15 min). The reply is read from the Claude Code transcript and posted to the room, in chunks of at most 3500 characters.

While the agent is working, messages keep their order. Write `salir` to close the session.

### Chat with opencode

Write `chat opencode` in the workspace's room or in a tab room and confirm with `confirmar`. The bridge:

1. Looks for the workspace's agent (or the tab's agent, from a tab room). It must be opencode and have a project directory. If it cannot find one, it does not open the session.
2. Each room message is sent through the API of the opencode background service (`opencode api`), in a session of the workspace's project directory. The first message creates the session; the next ones go to the same session.
3. The bridge waits for the turn to finish and posts the reply to the room. With `chat.opencode_auto` (on by default), permission requests are approved once. With it off, the room shows each request and the owner answers `permitir` (once) or `rechazar`; without an answer in 3 min, the turn fails and the room is told.

The TUI and the chat share the same opencode session, so messages from the room appear in the TUI. If the TUI is busy with another task, the message waits or fails on timeout. From a workspace room, a workspace with two agents does not open the chat.

### Opening a tab

From the room of a workspace or of one of its tabs, write `new-tab` to open a new tab in that workspace. The bot asks which agent to start in it: `1` opencode, `2` claude, `3` tab only, or `cancelar`. Answer within 60 s. You can also write `new-tab opencode` or `new-tab claude`, which asks for `confirmar` instead.

The new tab takes its directory from an agent that is already open in the workspace. If there is none, the bridge does not create the tab and says so. The owner's message never sets the directory. At most three new tabs per workspace in ten minutes. If the agent does not start, the tab stays open and the room says so. The new tab's room appears by itself.

### Task card

When an agent with an open chat session starts working on a task (from Herdr or from the room), the bridge posts a task card in the workspace room and edits it as the task progresses:

- `Estado: trabajando` when the task starts.
- `Estado: necesita decisión` with the last lines of the pane and the command to answer (`enviar <panel> <texto>`, then `confirmar`).
- `Estado: terminó`, `error`, `sin resultado` or `interrumpida` when it ends, with the final reply, the files edited by Claude Code (`Cambios`) and tool errors (`Problemas`). For opencode, `Cambios` lists the files written by its `write` tool, and `Problemas` lists its failed tool calls. Both come from the API of the background service.

Without an open chat session, no card is created; the usual status alerts still arrive. Secrets are redacted before anything is posted.

While a chat session is open, `detalle`, `ver`, `cambios` and `cancelar` are read as orders and are not sent to the agent. Any other message still goes to the agent. Without a chat session, these words are ignored.

### Bridge restart

If the bridge restarts with a chat session open, the session is kept in `chats.json`. Messages that were not sent do not go out on their own: the bridge reports it in the room and waits for `confirmar` (send them) or `descartar` (discard them).

## Commands

They are sent from a room. Only the owner can send them.

| Command | Where | What it does |
|---|---|---|
| `estado` (also `estados`, `status`, `agentes`, `lista`, `listar`) | Control room, or a workspace or tab room | Lists the agents in scope |
| `leer <panel>` (also `lee`, `read`, `mostrar`, `salida`) | Control room, or a workspace or tab room of the pane's workspace | Last 20 lines of the pane |
| `enviar <panel> <texto>` (also `envia`, `escribir`, `send`) | A workspace room or a tab room of the pane's workspace | Types text into the pane, after confirmation |
| `enter <panel>` (also `intro`, `pulsar`, `return`) | A workspace room or a tab room of the pane's workspace | Presses Enter in the pane, after confirmation |
| `new-tab [claude\|opencode]` | Room of a workspace or of one of its tabs | Opens a new tab in the workspace, optionally starting that agent in it. Without a type, the bot asks: 1 opencode, 2 claude, 3 tab only. Up to 3 per workspace every 10 minutes |
| `chat <claude\|opencode>` | A workspace room or a tab room | Opens a chat session with the agent of the workspace (or of the tab), after confirmation |
| `salir` | Room with an open chat session | Closes the chat session |
| `confirmar` (also `confirma`, `confirmo`, `si`, `ok`) | Same room as the command | Runs the pending command (60 s) |
| `descartar` | Room with pending chat messages | Deletes queued messages after a bridge restart |
| `detalle [n]` | Room with an open chat session | Last n tool actions of the current turn (default 10, max 30) |
| `ver` | Room with an open chat session | Full reply of the current turn, in chunks |
| `cambios` | Room with an open chat session | Uncommitted files and diff summary of the project (`git`) |
| `cancelar` | Room with an open chat session | Sends Escape to the agent's pane, or interrupts the opencode turn through its API, after confirmation |
| `permitir` / `rechazar` | Room with an open chat session and a pending opencode permission | Approves once or rejects the permission request. Approvals are never saved (`always` is not offered) |

Words are case-insensitive and ignore accents. Words of 5 or more letters tolerate one letter of typo, but only for read commands (`estado`, `leer`); a typo never runs a command that changes something.

Answers in the control room, when the bot asks about inviting someone after creating a workspace room: `no` closes the question; a Matrix ID (`@user:server`) that exists is invited. The question expires after 10 minutes.

Panels use the format `w1:p1`. A message of any other type, or a verb not in the list, does nothing. Any message other than the expected answer cancels a pending command. For `new-tab` without a type, the expected answers are `1`, `2`, `3` or `cancelar`.

While a chat session is open, everything you write in that room goes to the agent, except `salir`. If the bridge restarts with queued messages, they are not sent until you reply `confirmar` (send them) or `descartar` (discard them).

## Recent improvements

Summary of the features added in 0.25.x. Details and verification status are in `CHANGELOG.md`.

- Tab rooms: each tab has its own room, created and archived with the tab, with rate limits against Matrix 429 errors.
- Chat per tab: a tab room talks to its tab's agent, even when the workspace has several agents.
- `new-tab`: opens a tab from a room, optionally starting Claude Code or opencode in it. Asks which agent when no type is given. Limited to 3 per workspace in 10 minutes.
- Verification of the bot's device by emojis only.
- Transcript path fix: Claude Code transcripts are found in any directory name, including macOS temporary folders.

## Files

Herdr starts the plugin with its own directories, and `setup`, `verify` and `run` use the same ones. That is why `install.sh` and `uninstall.sh` export them before acting. If you run `node src/index.mjs` by hand, export `HERDR_PLUGIN_CONFIG_DIR` and `HERDR_PLUGIN_STATE_DIR` with the same values (`install.sh` prints them). If they are not set, `~/.config/herdr-matrix` and `~/.local/state/herdr-matrix` are used.

Configuration directory (`HERDR_PLUGIN_CONFIG_DIR`, usually `~/.config/herdr/plugins/config/herdr-matrix`):

- `config.json`: URL, owner, control room, rooms per workspace and per tab. No secrets.

State directory (`HERDR_PLUGIN_STATE_DIR`, usually `~/.local/state/herdr/plugins/herdr-matrix`), all with 0600 permissions:

- `session.json`: access token and the bot's device.
- `crypto/store.bin` and `crypto/store.key`: cryptographic store, encrypted with the side key.
- `herdr-snapshot.json`: latest state of the agents.
- `chats.json`: open chat sessions, per room.
- `cards.json`: open task cards.
- `pending-invites.json`: pending invitation questions.
- `herdr-snapshot.json`: last known state of the agents (used to detect changes).
- `audit.log`: one line per command. The text of `enviar` is not logged.
- `bridge.log`: bridge output when Herdr started it.
- `bridge.lock`: single-instance lock.

`audit.log` and `bridge.log` rotate when they exceed 10 MB or when the day changes. The archived copies are compressed with gzip (`bridge.log.<date>.gz`).

## Known risks

- **Key next to the store.** `store.key` is in the same directory as `store.bin`. Anyone who can read that directory can decrypt it.
- **`leer` shows pane output in the room.** If a pane shows a secret, it appears in Matrix. Use `leer` only on panes that can be shown.
- **Metadata on the server.** The server cannot read the encrypted content, but it sees who writes, when, and in which room.
- **Names on the server.** Workspace and tab names are sent to the server unencrypted, because the server needs them to create the room. They reveal project and branch names.
- **opencode approves permissions once.** With `chat.opencode_auto` on (the default), each permission request in a chat session is approved once. Approvals are never saved.

## Rotation

- **Bot password:** change it on the server, then run `node src/index.mjs setup --logout` and `setup` again. This creates a new device.
- **Session:** `node src/index.mjs setup --logout` revokes the token and deletes `session.json` and the cryptographic store. The configuration is kept.
- **Compromised device:** `setup --logout` and then `setup`. The previous device is revoked on the server.

## Tests

```
npm test
```

The tests use simulated servers and clients. They do not need Herdr or Synapse.
