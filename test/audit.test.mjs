import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditLine, createAudit } from "../src/audit.mjs";

test("auditLine escapa saltos de línea, tabuladores y barras invertidas", () => {
  const line = auditLine({
    at: "2026-10-26T10:00:00.000Z",
    sender: "@owner:hs.example.org",
    room: "!r:hs.example.org",
    verb: "estado",
    pane: "w1:p1\nfalso",
    result: "ok\tbarra\\",
  });
  assert.equal(line.split("\n").length, 1);
  assert.match(line, /w1:p1\\x0afalso/);
  assert.match(line, /ok\\x09barra\\\\/);
});

test("record añade una línea por orden con permisos 0600", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hm-audit-"));
  try {
    const path = join(dir, "audit.log");
    const audit = createAudit(path, () => new Date("2026-10-26T10:00:00Z"));
    await audit.record({ sender: "@a:hs", room: "!r:hs", verb: "estado", pane: "-", result: "ok" });
    await audit.record({ sender: "@a:hs", room: "!r:hs", verb: "enter", pane: "w1:p1", result: "ok (confirmada)" });
    const lines = (await readFile(path, "utf8")).trim().split("\n");
    assert.equal(lines.length, 2);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
