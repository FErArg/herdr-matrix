// Textos de la tarjeta de tarea (plan 20261027-0755). Lógica pura: no hace E/S.
// Todo texto que sale hacia Matrix pasa por `redact` y `clip`.

export const LIMITS = { task: 200, done: 1200, files: 10, problems: 3, panel: 20, problemText: 200 };

// Redes de seguridad, no garantías: la regla es no mostrar salidas sensibles en la sala.
const SECRET_VALUES = [
  /Authorization:\s*\S+(?:\s+\S+)?/gi,
  /\b(?:sk|ghp|xox[abprs]|AKIA)[-_A-Za-z0-9]{6,}/g,
];
const SECRET_ASSIGNMENT = /\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD))\s*=\s*\S+/g;

// Quita saltos de línea y recorta a `max` caracteres.
export function clip(text, max) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

export function redact(text) {
  let value = String(text ?? "");
  for (const pattern of SECRET_VALUES) value = value.replace(pattern, "[oculto]");
  return value.replace(SECRET_ASSIGNMENT, "$1=[oculto]");
}

// Lo que sale hacia Matrix: sin secretos, sin saltos de línea y recortado.
export function safe(text, max) {
  return clip(redact(text), max);
}

function listLine(label, items, limit, noneText) {
  if (items === null) return `${label}: no disponible`;
  if (!items.length) return `${label}: ${noneText}`;
  const shown = items.slice(0, limit).map((item) => safe(item, LIMITS.problemText));
  const rest = items.length - shown.length;
  return `${label}: ${shown.join(", ")}${rest > 0 ? ` … y ${rest} más` : ""}`;
}

export function openText({ task }) {
  return [`Tarea: ${safe(task ?? "no disponible", LIMITS.task)}`, "Estado: trabajando"].join("\n");
}

// Estado de cierre: terminó | error | sin resultado | interrumpida.
// Sin texto final pero con errores de herramientas es `error`; sin texto ni errores, `sin resultado`.
export function closeStateOf({ turn, kind }) {
  if (kind === "exited") return "sin resultado";
  if (!turn) return "terminó";
  if (!turn.reply && turn.problems?.length) return "error";
  if (!turn.reply) return "sin resultado";
  return "terminó";
}

export function closeText({ task, state, turn }) {
  const lines = [
    `Tarea: ${safe(task ?? "no disponible", LIMITS.task)}`,
    `Estado: ${state}`,
  ];
  if (!turn) {
    lines.push("Detalle no disponible");
    return lines.join("\n");
  }
  if (turn.reply) lines.push(`Hecho: ${safe(turn.reply, LIMITS.done)}`);
  lines.push(listLine("Cambios", turn.files ?? null, LIMITS.files, "ninguno"));
  if (turn.problems !== undefined) {
    lines.push(listLine("Problemas", turn.problems, LIMITS.problems, "ninguno"));
  }
  return lines.join("\n");
}

export function decisionText({ task, panelLines }) {
  const lines = String(panelLines ?? "")
    .split("\n")
    .filter((line) => line.trim())
    .slice(-LIMITS.panel)
    .map((line) => safe(line, LIMITS.problemText));
  return [
    `Tarea: ${safe(task ?? "no disponible", LIMITS.task)}`,
    "Estado: necesita decisión",
    ...lines,
  ].join("\n");
}

export function interruptedText({ task }) {
  return [`Tarea: ${safe(task ?? "no disponible", LIMITS.task)}`, "Estado: interrumpida"].join("\n");
}
