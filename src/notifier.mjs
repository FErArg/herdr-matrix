// Lógica pura de notificaciones: detectar cambios, formatear y limitar frecuencia.
// No hace E/S: recibe datos y devuelve decisiones.

export const KIND_TEXT = {
  blocked: "requiere atención",
  done: "terminó",
  exited: "panel cerrado",
};

const MAX_TEXT_LENGTH = 200;

// Quita caracteres de control y colapsa espacios. Nunca deja saltos de línea en el mensaje.
export function sanitize(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

// Tipo de aviso para un cambio de estado. Herdr marca "done" solo en algunos casos; un agente que pasa
// de working a idle también ha terminado, así que se avisa como "done".
export function kindOf(before, agent) {
  if (before?.agent_status === "working" && agent.agent_status === "idle") return "done";
  return agent.agent_status;
}

// Compara el estado anterior (por pane_id) con la lista actual de agent.list.
// Devuelve transiciones { kind, pane }. Un panel que desaparece produce kind "exited".
export function diffAgents(previous, agents) {
  const transitions = [];
  const seen = new Set();

  for (const agent of agents) {
    seen.add(agent.pane_id);
    const before = previous[agent.pane_id];
    const changed = !before
      || before.agent_status !== agent.agent_status
      || before.state_change_seq !== agent.state_change_seq;
    if (changed) {
      transitions.push({ kind: kindOf(before, agent), agent });
    }
  }

  for (const [paneId, before] of Object.entries(previous)) {
    if (!seen.has(paneId)) {
      transitions.push({ kind: "exited", agent: { ...before, pane_id: paneId } });
    }
  }

  return transitions;
}

export function snapshotOf(agents) {
  const panes = {};
  for (const agent of agents) {
    panes[agent.pane_id] = {
      agent_status: agent.agent_status,
      state_change_seq: agent.state_change_seq,
      workspace_id: agent.workspace_id,
      tab_id: agent.tab_id,
      agent: agent.agent ?? null,
    };
  }
  return panes;
}

// Formato: [workspace/tab/panel] estado: texto corto
export function formatMessage({ label, tabId, paneId, kind, agent }) {
  const where = [label, tabId, paneId].map(sanitize).join("/");
  const what = sanitize(agent ? `${agent} ${KIND_TEXT[kind] ?? kind}` : (KIND_TEXT[kind] ?? kind));
  return `[${where}] ${sanitize(kind)}: ${what}`;
}

// Como máximo un mensaje por clave en cada ventana. Lo que cae dentro de la ventana se descarta.
export function createRateLimiter({ windowMs, now = () => Date.now() }) {
  const last = new Map();
  return {
    allow(key) {
      const current = now();
      const previous = last.get(key);
      if (previous !== undefined && current - previous < windowMs) return false;
      last.set(key, current);
      return true;
    },
  };
}
