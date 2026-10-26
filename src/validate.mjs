// Validación de entradas del usuario antes de usarlas en peticiones HTTP.

const MXID_PATTERN = /^@[a-z0-9._=\-/]+:[a-z0-9.-]+(?::\d{1,5})?$/i;
const MAX_MXID_LENGTH = 255;

export function validateServerUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("La URL del servidor no es válida.");
  }
  if (url.protocol !== "https:") {
    throw new Error("Solo se acepta https.");
  }
  if (url.username || url.password) {
    throw new Error("La URL no puede llevar credenciales.");
  }
  if (url.search || url.hash) {
    throw new Error("La URL no puede llevar query ni fragmento.");
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

export function validateMxid(raw) {
  if (typeof raw !== "string" || raw.length > MAX_MXID_LENGTH || !MXID_PATTERN.test(raw)) {
    throw new Error("El MXID debe tener la forma @usuario:servidor.");
  }
  return raw;
}
