// Orden new-tab: abre una pestaña en el workspace de la sala y, si se pide, arranca un agente en ella.
// El directorio sale de un agente que ya existe en ese workspace. Nunca viene del mensaje.
// Sin E/S propia: Herdr entra por `herdr`, así que se prueba con un falso.

export const NEW_TAB_LIMIT = { max: 3, windowMs: 10 * 60_000 };
export const AGENT_START_TIMEOUT_MS = 60_000;

// Respuesta a la pregunta de new-tab sin tipo. { kind } o { kind: null } para solo pestaña;
// "cancel", "hint" (la palabra confirmar no elige nada) o null si no es una respuesta.
const CHOICES = {
  1: { kind: "opencode" }, opencode: { kind: "opencode" },
  2: { kind: "claude" }, claude: { kind: "claude" },
  3: { kind: null }, "solo pestana": { kind: null }, pestana: { kind: null },
  cancelar: "cancel", confirmar: "hint",
};

export function choiceOf(text) {
  const word = String(text ?? "").normalize("NFD").replace(/\p{M}/gu, "").trim().replace(/[.,;:!?]+$/, "").toLowerCase().replace(/\s+/g, " ");
  return Object.hasOwn(CHOICES, word) ? CHOICES[word] : null;
}

// Herdr solo admite minúsculas, dígitos, "-" y "_" (1–32). "w4:tC" no vale: se convierte a "nueva-w4-tc".
export function agentNameOf(tabId) {
  return `nueva-${tabId.toLowerCase().replace(/[^a-z0-9_-]/g, "-")}`.slice(0, 32);
}

export function createNewTab({ herdr, now = () => Date.now(), limit = NEW_TAB_LIMIT }) {
  const recent = new Map(); // workspace → marcas de tiempo de pestañas creadas

  function withinLimit(workspaceId) {
    const cutoff = now() - limit.windowMs;
    const kept = (recent.get(workspaceId) ?? []).filter((at) => at > cutoff);
    recent.set(workspaceId, kept);
    return kept.length < limit.max;
  }

  async function cwdOf(workspaceId) {
    const { agents } = await herdr.request("agent.list", {});
    return agents.find((agent) => agent.workspace_id === workspaceId && agent.cwd)?.cwd ?? null;
  }

  // Texto para la sala. Un error de tab.create se lanza; un fallo al arrancar el agente no revierte la pestaña.
  async function run({ workspaceId, kind = null }) {
    if (!withinLimit(workspaceId)) {
      const minutes = limit.windowMs / 60_000;
      return `demasiadas pestañas nuevas en este espacio; espera unos minutos (máximo ${limit.max} cada ${minutes} min).`;
    }
    const cwd = await cwdOf(workspaceId);
    if (!cwd) {
      return "no hay ningún agente abierto en este espacio para tomar su directorio. Abre una pestaña a mano en Herdr primero.";
    }
    recent.get(workspaceId).push(now());

    const { tab, root_pane: root } = await herdr.request("tab.create", { workspace_id: workspaceId, cwd, focus: false });
    if (!kind) return `pestaña ${tab.tab_id} creada. Su sala aparece en unos segundos.`;

    try {
      await herdr.request("agent.start", {
        name: agentNameOf(tab.tab_id), kind, pane_id: root.pane_id, timeout_ms: AGENT_START_TIMEOUT_MS,
      });
    } catch (error) {
      return `pestaña ${tab.tab_id} creada, pero no se pudo arrancar ${kind}: ${error.message}. La pestaña queda abierta.`;
    }
    return `pestaña ${tab.tab_id} creada con ${kind}. Su sala aparece en unos segundos; escribe chat ${kind} allí.`;
  }

  return { run };
}
