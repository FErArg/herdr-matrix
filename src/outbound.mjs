// Salida Herdr → Matrix. Los eventos del socket son señales: al recibir una, se vuelve a leer
// agent.list y se compara con el estado guardado. No se reproducen eventos perdidos.

import { createRateLimiter, diffAgents, formatMessage, snapshotOf } from "./notifier.mjs";

export const SUBSCRIPTION_TYPES = [
  "pane.created",
  "pane.closed",
  "pane.exited",
  "pane.updated",
  "pane.agent_detected",
  "workspace.created",
  "workspace.renamed",
  "workspace.closed",
  "tab.created",
  "tab.closed",
  "tab.renamed",
];
export const DEFAULT_NOTIFY_EVENTS = ["blocked", "done", "exited"];
const CLOSING_KINDS = ["done", "idle", "exited"];
const PANEL_LINES = 20;
const TURN_TIMEOUT_MS = 5_000;
const DEBOUNCE_MS = 300;
const SAFETY_RECONCILE_MS = 30_000;

// Sala destino: la sala activa de la pestaña si tiene una (src/tab-rooms.mjs); si no, la del workspace.
// Sin sala activa, null: el evento se descarta. La sala de control no recibe notificaciones.
export function routeRoom(config, workspaceId, tabId = null) {
  const tabRoom = tabId
    ? (config.tab_rooms ?? []).find((room) => room.workspace_id === workspaceId && room.tab_id === tabId && room.status === "active")
    : null;
  if (tabRoom) return tabRoom.room_id;
  const mapped = (config.rooms ?? []).find((room) => room.workspace_id === workspaceId && room.status === "active");
  return mapped?.room_id ?? null;
}

// rooms: gestor de salas por workspace (src/rooms.mjs), o null para no crear salas.
// tabRooms: gestor de salas por pestaña (src/tab-rooms.mjs), o null para no crearlas.
// chats: gestor de sesiones de chat (src/chat.mjs). cards: tarjetas de tarea (src/cards.mjs).
// La tarjeta solo existe con sesión de chat abierta en su workspace.
export function createOutbound({
  herdr,
  sender,
  rooms = null,
  tabRooms = null,
  chats = null,
  cards = null,
  config,
  snapshot,
  saveSnapshot,
  log,
  rateLimitMs = 10_000,
  now = () => Date.now(),
}) {
  const notifyKinds = new Set(config.notify_events?.length ? config.notify_events : DEFAULT_NOTIFY_EVENTS);
  const limiter = createRateLimiter({ windowMs: rateLimitMs, now });
  // null: aún no hay línea base. La primera lectura solo registra estado y no notifica.
  let panes = snapshot?.panes ?? null;
  let timer = null;
  let interval = null;

  async function run() {
    const { agents } = await herdr.request("agent.list", {});
    const { workspaces } = await herdr.request("workspace.list", {});
    if (rooms) await rooms.sync(workspaces);
    if (tabRooms) await syncTabRooms(workspaces);
    const labels = new Map(workspaces.map((workspace) => [workspace.workspace_id, workspace.label]));

    if (panes === null) {
      panes = snapshotOf(agents);
      await saveSnapshot({ panes });
      log("línea base registrada; sin notificaciones en la primera lectura");
      return { sent: 0, dropped: 0, failed: 0 };
    }

    const transitions = diffAgents(panes, agents);
    panes = snapshotOf(agents);
    await saveSnapshot({ panes });

    const result = { sent: 0, dropped: 0, failed: 0 };
    for (const { kind, agent } of transitions) {
      await followCard(kind, agent);
      if (!notifyKinds.has(kind)) continue;
      const roomId = routeRoom(config, agent.workspace_id, agent.tab_id);
      if (!roomId || !limiter.allow(agent.pane_id)) {
        result.dropped++;
        continue;
      }
      const text = formatMessage({
        label: labels.get(agent.workspace_id) ?? agent.workspace_id,
        tabId: agent.tab_id,
        paneId: agent.pane_id,
        kind,
        agent: agent.agent,
      });
      try {
        await sender.sendText(roomId, text);
        result.sent++;
      } catch (error) {
        result.failed++;
        log(`mensaje no enviado (${kind} en ${agent.pane_id}): ${error.message}`);
        continue;
      }
    }
    return result;
  }

  // Las pestañas se leen workspace a workspace. Si una lectura falla, no se sincroniza nada:
  // una lista incompleta archivaría salas de pestañas que sí existen.
  async function syncTabRooms(workspaces) {
    const tabs = [];
    try {
      for (const workspace of workspaces) {
        const { tabs: listed } = await herdr.request("tab.list", { workspace_id: workspace.workspace_id });
        for (const tab of listed) {
          tabs.push({
            tab_id: tab.tab_id,
            label: tab.label,
            number: tab.number,
            workspace_id: workspace.workspace_id,
            workspace_label: workspace.label,
          });
        }
      }
    } catch (error) {
      log(`pestañas no leídas; no se sincronizan salas de pestaña: ${error.message}`);
      return;
    }
    await tabRooms.sync(tabs);
  }

  // Turno del agente con límite de tiempo. Sin sesión de chat o si no responde a tiempo, null.
  async function turnOf(workspaceId, tabId) {
    const session = chats?.findByWorkspace(workspaceId, tabId);
    if (!session) return null;
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), TURN_TIMEOUT_MS);
    });
    try {
      return await Promise.race([session.turn().catch(() => null), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function readPanel(paneId) {
    const result = await herdr.request("pane.read", {
      pane_id: paneId, source: "recent", lines: PANEL_LINES, format: "text", strip_ansi: true,
    });
    return result.read?.text ?? "";
  }

  // Tarjeta de la tarea: abre al empezar, muestra la decisión pendiente y cierra al terminar.
  // Un fallo aquí no detiene los avisos de estado.
  async function followCard(kind, agent) {
    if (!cards) return;
    const { pane_id: paneId, workspace_id: workspaceId, tab_id: tabId } = agent;
    try {
      if (kind === "started") {
        const session = chats?.findByWorkspace(workspaceId, tabId);
        if (!session) return;
        const turn = await turnOf(workspaceId, tabId);
        await cards.open({ roomId: session.roomId, workspaceId, paneId, task: turn?.request ?? null });
      } else if (kind === "blocked") {
        if (cards.get(paneId)) await cards.decide({ paneId, lines: await readPanel(paneId) });
      } else if (CLOSING_KINDS.includes(kind)) {
        if (cards.get(paneId)) await cards.close({ paneId, kind, turn: await turnOf(workspaceId, tabId) });
      }
    } catch (error) {
      log(`tarjeta (${kind} en ${paneId}): ${error.message}`);
    }
  }

  // Las reconciliaciones van una a una: una señal no se solapa con otra en curso.
  let queue = Promise.resolve();
  function reconcile() {
    const next = queue.then(run);
    queue = next.catch(() => {});
    return next;
  }

  function signal() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      reconcile().catch((error) => log(`reconciliación fallida: ${error.message}`));
    }, DEBOUNCE_MS);
  }

  function start() {
    interval = setInterval(signal, SAFETY_RECONCILE_MS);
    return reconcile();
  }

  function stop() {
    clearTimeout(timer);
    clearInterval(interval);
  }

  return { reconcile, signal, start, stop };
}
