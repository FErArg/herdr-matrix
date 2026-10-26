import { test } from "node:test";
import assert from "node:assert/strict";
import { backoffMs, superviseBridge } from "../src/supervisor.mjs";

function scripted(outcomes) {
  let calls = 0;
  return {
    get calls() { return calls; },
    run: async () => {
      const outcome = outcomes[calls++];
      if (outcome instanceof Error) throw outcome;
    },
  };
}

test("backoff exponencial con tope", () => {
  assert.equal(backoffMs(1), 1_000);
  assert.equal(backoffMs(2), 2_000);
  assert.equal(backoffMs(3), 4_000);
  assert.equal(backoffMs(20), 60_000);
});

test("reintenta tras fallos transitorios y termina cuando run acaba normalmente", async () => {
  const script = scripted([new Error("socket"), new Error("socket"), undefined]);
  const waits = [];
  await superviseBridge({
    run: script.run,
    log: () => {},
    wait: async (ms) => { waits.push(ms); },
  });
  assert.equal(script.calls, 3);
  assert.deepEqual(waits, [1_000, 2_000]);
});

test("un error fatal no se reintenta", async () => {
  const fatal = Object.assign(new Error("config inválida"), { fatal: true });
  const script = scripted([fatal, undefined]);
  await assert.rejects(superviseBridge({ run: script.run, log: () => {}, wait: async () => {} }), /config inválida/);
  assert.equal(script.calls, 1);
});

test("tras maxFailures fallos seguidos sale con el último error", async () => {
  const script = scripted([new Error("1"), new Error("2"), new Error("3")]);
  await assert.rejects(
    superviseBridge({ run: script.run, log: () => {}, wait: async () => {}, maxFailures: 3 }),
    /3/,
  );
  assert.equal(script.calls, 3);
});

test("una ejecución estable reinicia el contador de fallos", async () => {
  let clock = 0;
  const script = scripted([new Error("a"), new Error("b"), new Error("c"), undefined]);
  // Cada ejecución dura 1 s, salvo la tercera, que dura mucho más que stableMs.
  const durations = [1_000, 1_000, 600_000];
  const run = async () => {
    const duration = durations[script.calls] ?? 0;
    clock += duration;
    await script.run();
  };
  await superviseBridge({
    run,
    log: () => {},
    wait: async () => {},
    now: () => clock,
    maxFailures: 3,
    stableMs: 300_000,
  });
  assert.equal(script.calls, 4);
});

test("una señal durante la espera detiene el supervisor sin reintentar", async () => {
  const controller = new AbortController();
  const script = scripted([new Error("x"), undefined]);
  await superviseBridge({
    run: script.run,
    log: () => {},
    signal: controller.signal,
    wait: async () => controller.abort(),
  });
  assert.equal(script.calls, 1);
});
