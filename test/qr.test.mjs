import { test } from "node:test";
import assert from "node:assert/strict";
import { renderQr } from "../src/qr.mjs";

test("renderQr devuelve un bloque de texto cuadrado", () => {
  const lines = renderQr(new Uint8Array([0x4d, 0x41, 0x54, 0x52, 0x49, 0x58])).split("\n");
  assert.ok(lines.length > 10);
  const width = lines[0].length;
  assert.ok(lines.every((line) => line.length === width));
});

test("renderQr admite bytes fuera de ASCII sin cambiarlos de codificación", () => {
  const binary = new Uint8Array([0x00, 0xff, 0x80, 0xc3, 0xa9, 0x7f]);
  assert.equal(renderQr(binary), renderQr(new Uint8Array(binary)));
  assert.notEqual(renderQr(binary), renderQr(new Uint8Array([0x00, 0xfe, 0x80, 0xc3, 0xa9, 0x7f])));
});
