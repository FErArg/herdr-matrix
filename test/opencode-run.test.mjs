import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Binario falso: imprime el ID de sesión y después se queda colgado, como opencode run.
test("runOpencode devuelve el ID y cierra el proceso cuando la respuesta ya está guardada", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hm-oc-"));
  try {
    const fake = join(dir, "opencode-falso");
    await writeFile(fake, '#!/bin/sh\necho \'{"sessionID":"ses_falsa","type":"text"}\'\nsleep 60\n');
    await chmod(fake, 0o755);
    process.env.OPENCODE_BIN = fake;
    const { runOpencode } = await import("../src/chat.mjs?fake=1");

    let polls = 0;
    const started = Date.now();
    const id = await runOpencode({
      text: "hola",
      cwd: dir,
      pollMs: 10,
      settleMs: 10,
      read: async () => (++polls >= 2 ? "respuesta" : null),
    });
    assert.equal(id, "ses_falsa");
    assert.ok(Date.now() - started < 10_000, "no debe esperar al fin del proceso");
  } finally {
    delete process.env.OPENCODE_BIN;
    await rm(dir, { recursive: true, force: true });
  }
});

test("runOpencode sin directorio del proyecto rechaza sin lanzar opencode", async () => {
  const { runOpencode } = await import("../src/chat.mjs?fake=2");
  await assert.rejects(runOpencode({ text: "hola" }), /falta el directorio del proyecto/);
});
