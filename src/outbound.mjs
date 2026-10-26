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
];
export const DEFAULT_NOTIFY_EVENTS = ["blocked", "done", "exited"];
const DEBOUNCE_MS = 300;
const SAFETY_RECONCILE_MS = 30_000;

// Sala destino: la sala activa del workspace. Sin sala activa, null: el evento se descarta.
// Las notificaciones solo van a la sala de su proyecto; la sala de control no las recibe.
export function routeRoom(config, workspaceId) {
  const mapped = (config.rooms ?? []).find((room) => room.workspace_id === workspaceId && room.status === "active");
  return mapped?.room_id ?? null;
}

// rooms: gestor de salas por workspace (src/rooms.mjs), o null para no crear salas.
export function createOutbound({
  herdr,
  sender,
  rooms = null,
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
      if (!notifyKinds.has(kind)) continue;
      const roomId = routeRoom(config, agent.workspace_id);
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
      }
    }
    return result;
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
