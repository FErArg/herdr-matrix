// Órdenes desde la sala (Fase 3): interpretación determinista y tabla cerrada.
// La tabla vive en código, no en config.json: quien pueda editar la config no añade métodos de Herdr.
// La interpretación solo elige un verbo de la tabla. Nunca elige un método ni parámetros de Herdr.
// Sin modelo de lenguaje: sinónimos fijos, tildes ignoradas y, para palabras largas, una letra de error.

export const COMMANDS = {
  estado: { method: "agent.list", write: false, args: [] },
  leer: { method: "pane.read", write: false, args: ["pane"] },
  enviar: { method: "pane.send_text", write: true, confirm: true, args: ["pane", "text"] },
  enter: { method: "pane.send_keys", write: true, confirm: true, args: ["pane"], keys: ["enter"] },
  "new-tab": { method: "tab.create", write: true, confirm: true, args: ["kind"] },
};

// Tipos de agente que new-tab puede arrancar en la pestaña nueva.
export const NEW_TAB_KINDS = ["claude", "opencode"];

// Palabras que el dueño puede usar para cada verbo. Sin tildes y en minúsculas.
export const SYNONYMS = {
  estado: ["estado", "estados", "status", "estatus", "agentes", "lista", "listar"],
  leer: ["leer", "lee", "read", "mostrar", "muestra", "salida"],
  enviar: ["enviar", "envia", "envio", "escribir", "escribe", "send"],
  enter: ["enter", "intro", "pulsar", "pulsa", "return"],
};

// Respuestas que confirman una acción pendiente. Solo se consideran si hay una pendiente.
const CONFIRMATIONS = ["confirmar", "confirma", "confirmo", "si", "ok"];

export const MAX_TEXT_LENGTH = 500;
const PANE_ID = /^w\d+:p\d+$/;
const PANE_PARTS = /^w(\d+)[:.]p(\d+)$/i;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const FUZZY_MIN_LENGTH = 5;

// Quita caracteres invisibles (ancho cero, BOM, guion blando) y normaliza Unicode.
// Los mensajes copiados o escritos en el móvil suelen traerlos sin que se vean.
// Quita también la puntuación final: "confirmar," o "leer w2:p1." se entienden igual.
export function normalizeBody(body) {
  return String(body ?? "")
    .normalize("NFKC")
    .replace(/[­​-‍⁠﻿]/g, "")
    .trim()
    .replace(/[.,;:!?]+$/, "")
    .trim();
}

// Minúsculas y sin tildes: "Envía" → "envia".
export function foldWord(word) {
  return String(word).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

// Verbo de la tabla para una palabra, o null. Con una letra de error solo si la palabra es larga y
// solo si coincide con un único verbo: "enviar" admite "enviat", pero "lee" no admite "lea".
export function verbFor(word) {
  const folded = foldWord(word);
  if (COMMANDS[folded]) return folded;
  for (const [verb, words] of Object.entries(SYNONYMS)) {
    if (words.includes(folded)) return verb;
  }
  if (folded.length < FUZZY_MIN_LENGTH) return null;
  // Solo las órdenes de lectura admiten una letra de error. Una errata nunca llega a una escritura.
  const matches = new Set();
  for (const [verb, words] of Object.entries(SYNONYMS)) {
    if (COMMANDS[verb].write) continue;
    if (words.some((candidate) => candidate.length >= FUZZY_MIN_LENGTH && distance(folded, candidate) <= 1)) {
      matches.add(verb);
    }
  }
  return matches.size === 1 ? [...matches][0] : null;
}

export function isConfirmation(body) {
  return CONFIRMATIONS.includes(foldWord(normalizeBody(body)));
}

// Toma el panel en la posición i. Acepta "w2:p1", "w2.p1" y "w2 p1" (dos palabras).
function takePane(tokens, i) {
  const first = tokens[i];
  if (!first) return { pane: null, next: i };
  const joined = PANE_PARTS.exec(first);
  if (joined) return { pane: `w${joined[1]}:p${joined[2]}`, next: i + 1 };
  if (/^w\d+$/i.test(first) && tokens[i + 1] && /^p\d+$/i.test(tokens[i + 1])) {
    return { pane: `${first.toLowerCase()}:${tokens[i + 1].toLowerCase()}`, next: i + 2 };
  }
  return { pane: first.toLowerCase(), next: i + 1 };
}

// Devuelve { verb, args } o { error } con un motivo genérico para la sala.
// Si la palabra inicial no es de la tabla, devuelve `word` (primera palabra) para la auditoría.
// Formato: <verbo> [argumentos]. Para enviar, el texto es todo lo que sigue al panel.
export function parseCommand(body) {
  const text = normalizeBody(body);
  if (!text) return { error: "orden vacía" };
  if (CONTROL_CHARS.test(text)) return { error: "la orden contiene caracteres de control" };

  const tokens = text.split(/\s+/);
  const verb = verbFor(tokens[0]);
  if (!verb) return { error: "orden no reconocida", word: tokens[0] };
  const spec = COMMANDS[verb];

  if (spec.args.includes("kind")) {
    if (tokens.length > 2) return { error: `${verb} admite como máximo un tipo de agente` };
    if (!tokens[1]) return { verb, args: {} };
    const kind = tokens[1].toLowerCase();
    if (!NEW_TAB_KINDS.includes(kind)) return { error: "tipo de agente no válido (claude u opencode)" };
    return { verb, args: { kind } };
  }

  if (!spec.args.includes("pane")) {
    if (tokens.length > 1) return { error: `${verb} no admite argumentos` };
    return { verb, args: {} };
  }

  const { pane, next } = takePane(tokens, 1);
  if (!pane || !PANE_ID.test(pane)) return { error: "identificador de panel no válido (formato w1:p1)" };

  if (!spec.args.includes("text")) {
    if (tokens.length > next) return { error: `${verb} solo admite el panel` };
    return { verb, args: { pane } };
  }

  const payload = tokens.slice(next).join(" ");
  if (!payload) return { error: "falta el texto" };
  if (payload.length > MAX_TEXT_LENGTH) return { error: `el texto supera ${MAX_TEXT_LENGTH} caracteres` };
  return { verb, args: { pane, text: payload } };
}

export function paneWorkspace(paneId) {
  return paneId.split(":")[0];
}
