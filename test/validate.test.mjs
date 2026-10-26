import { test } from "node:test";
import assert from "node:assert/strict";
import { validateMxid, validateServerUrl } from "../src/validate.mjs";

test("acepta https y normaliza barras finales", () => {
  assert.equal(validateServerUrl("https://synapse.example.com:8448/"), "https://synapse.example.com:8448");
});

test("rechaza http, credenciales, query y URL no válida", () => {
  assert.throws(() => validateServerUrl("http://synapse.example.com"), /Solo se acepta https/);
  assert.throws(() => validateServerUrl("https://u:p@synapse.example.com"), /credenciales/);
  assert.throws(() => validateServerUrl("https://synapse.example.com/?x=1"), /query/);
  assert.throws(() => validateServerUrl("no es una url"), /no es válida/);
});

test("valida MXID con forma @usuario:servidor", () => {
  assert.equal(validateMxid("@owner:hs.example.org"), "@owner:hs.example.org");
  assert.throws(() => validateMxid("owner"), /MXID/);
  assert.throws(() => validateMxid("@owner"), /MXID/);
  assert.throws(() => validateMxid("@owner:host name"), /MXID/);
  assert.throws(() => validateMxid(undefined), /MXID/);
});
