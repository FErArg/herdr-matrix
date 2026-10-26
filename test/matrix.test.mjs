import { test } from "node:test";
import assert from "node:assert/strict";
import { createMatrixClient, MatrixError } from "../src/matrix.mjs";

function jsonResponse(status, body) {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("petición autenticada envía Bearer y redirect: error", async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return jsonResponse(200, { user_id: "@bot:example.org" });
  };
  const client = createMatrixClient({ baseUrl: "https://hs.example.org", accessToken: "tok", fetchImpl });
  const who = await client.whoami();

  assert.equal(who.user_id, "@bot:example.org");
  assert.equal(seen.url, "https://hs.example.org/_matrix/client/v3/account/whoami");
  assert.equal(seen.init.headers.Authorization, "Bearer tok");
  assert.equal(seen.init.redirect, "error");
});

test("errores del servidor se convierten en MatrixError con errcode", async () => {
  const fetchImpl = async () => jsonResponse(403, { errcode: "M_FORBIDDEN", error: "nope" });
  const client = createMatrixClient({ baseUrl: "https://hs.example.org", accessToken: "t", fetchImpl });
  await assert.rejects(client.whoami(), (error) => {
    assert.ok(error instanceof MatrixError);
    assert.equal(error.errcode, "M_FORBIDDEN");
    assert.equal(error.status, 403);
    return true;
  });
});

test("profileExists devuelve false con 404 y true con 200", async () => {
  const notFound = createMatrixClient({
    baseUrl: "https://hs.example.org",
    fetchImpl: async () => jsonResponse(404, { errcode: "M_NOT_FOUND" }),
  });
  const found = createMatrixClient({
    baseUrl: "https://hs.example.org",
    fetchImpl: async () => jsonResponse(200, { displayname: "x" }),
  });
  assert.equal(await notFound.profileExists("@nadie:hs.example.org"), false);
  assert.equal(await found.profileExists("@owner:hs.example.org"), true);
});

test("respuesta mayor de 1 MB se rechaza", async () => {
  const big = "x".repeat(1_000_001);
  const client = createMatrixClient({
    baseUrl: "https://hs.example.org",
    fetchImpl: async () => new Response(big, { status: 200 }),
  });
  await assert.rejects(client.whoami(), /demasiado grande/);
});
