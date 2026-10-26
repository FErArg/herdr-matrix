// Supervisor del bridge: reinicia `run` con backoff exponencial y tope.
// - Si `run` termina normalmente (SIGINT/SIGTERM), el supervisor termina.
// - Un error marcado `fatal` (configuración, sesión ausente) no se reintenta.
// - Tras `maxFailures` fallos seguidos, sale con el último error.
// - Una ejecución que dura más de `stableMs` reinicia el contador de fallos.

export const DEFAULTS = {
  baseMs: 1_000,
  capMs: 60_000,
  maxFailures: 5,
  stableMs: 5 * 60_000,
};

export function backoffMs(failures, { baseMs = DEFAULTS.baseMs, capMs = DEFAULTS.capMs } = {}) {
  return Math.min(capMs, baseMs * 2 ** (failures - 1));
}

export async function superviseBridge({
  run,
  log,
  signal,
  now = () => Date.now(),
  wait = (ms, abort) => waitOrAbort(ms, abort),
  ...options
}) {
  const { maxFailures = DEFAULTS.maxFailures, stableMs = DEFAULTS.stableMs } = options;
  let failures = 0;

  for (;;) {
    const startedAt = now();
    try {
      await run();
      return;
    } catch (error) {
      if (error.fatal) throw error;
      if (signal?.aborted) return;
      if (now() - startedAt > stableMs) failures = 0;
      failures++;
      if (failures >= maxFailures) {
        log(`el bridge ha fallado ${failures} veces seguidas; se detiene: ${error.message}`);
        throw error;
      }
      const delay = backoffMs(failures, options);
      log(`el bridge se detuvo con error (${error.message}); reintento ${failures} en ${Math.round(delay / 1000)} s`);
      await wait(delay, signal);
      if (signal?.aborted) return;
    }
  }
}

// Espera `ms`, o hasta que se aborte la señal.
function waitOrAbort(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}
