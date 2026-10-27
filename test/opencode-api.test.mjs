import { test } from "node:test";
import assert from "node:assert/strict";
import { describePermission, interruptOpencode, opencodeApiTurn, readOpencodeApiTurn, replyAfter, replyOpencodePermission, runOpencode, sendAndWait } from "../src/opencode-api.mjs";

// Servidor simulado de `opencode api`: responde según método y ruta, y registra las llamadas.
function fakeApi(routes) {
  const calls = [];
  const exec = async (bin, args) => {
    const [, method, path, flag, body] = args;
    calls.push({ method, path, body: flag === "-d" ? JSON.parse(body) : undefined });
    const key = `${method} ${path}`;
    const handler = routes[key];
    if (!handler) throw new Error(`ruta no simulada: ${key}`);
    const data = await handler(flag === "-d" ? JSON.parse(body) : undefined);
    return { stdout: JSON.stringify({ data }) };
  };
  return { exec, calls };
}

const messagesFor = (text, reply) => [
  { id: "a2", type: "assistant", content: [{ type: "text", text: reply }] },
  { id: "u1", type: "user", payload: { text } },
];

test("replyAfter devuelve el texto del asistente posterior al pedido", () => {
  assert.equal(replyAfter(messagesFor("hola", "prueba"), "hola"), "prueba");
});

test("replyAfter lee el texto del pedido tanto en `text` como en `payload.text`", () => {
  const messages = [
    { type: "assistant", content: [{ type: "text", text: "uno" }] },
    { type: "user", text: "p" },
  ];
  assert.equal(replyAfter(messages, "p"), "uno");
});

test("replyAfter devuelve null si el pedido no está o aún no tiene respuesta", () => {
  assert.equal(replyAfter(messagesFor("hola", "prueba"), "otro"), null);
  assert.equal(replyAfter([{ id: "u1", type: "user", payload: { text: "hola" } }], "hola"), null);
});

test("replyAfter concatena varios bloques de texto y omite las partes de razonamiento", () => {
  const messages = [
    { type: "assistant", content: [{ type: "reasoning", text: "pensando" }, { type: "text", text: "uno" }, { type: "text", text: "dos" }] },
    { type: "user", payload: { text: "p" } },
  ];
  assert.equal(replyAfter(messages, "p"), "uno\n\ndos");
});

test("runOpencode crea la sesión en el directorio del workspace y espera la respuesta", async () => {
  const { exec, calls } = fakeApi({
    "post /api/session": () => ({ id: "ses_new" }),
    "post /api/session/ses_new/prompt": () => ({ id: "msg_u" }),
    "get /api/session/ses_new/permission": () => [],
    "post /api/experimental/session/ses_new/wait": () => [],
  });
  const id = await runOpencode({ text: "hola", cwd: "/proyecto", exec, now: () => 0, pollMs: 1 });
  assert.equal(id, "ses_new");
  assert.deepEqual(calls[0], { method: "post", path: "/api/session", body: { location: { directory: "/proyecto" } } });
  assert.deepEqual(calls[1].body, { text: "hola" });
});

test("runOpencode reutiliza la sesión existente sin crear otra", async () => {
  const { exec, calls } = fakeApi({
    "post /api/session/ses_1/prompt": () => ({}),
    "get /api/session/ses_1/permission": () => [],
    "post /api/experimental/session/ses_1/wait": () => [],
  });
  const id = await runOpencode({ sessionId: "ses_1", text: "hola", cwd: "/p", exec, now: () => 0, pollMs: 1 });
  assert.equal(id, "ses_1");
  assert.ok(!calls.some((call) => call.path === "/api/session"));
});

test("con auto, los permisos pedidos se aprueban una vez", async () => {
  let pending = [{ id: "per_1" }];
  const { exec, calls } = fakeApi({
    "post /api/session/ses_1/prompt": () => ({}),
    "get /api/session/ses_1/permission": () => {
      const current = pending;
      pending = [];
      return current;
    },
    "post /api/session/ses_1/permission/per_1/reply": () => ({}),
    "post /api/experimental/session/ses_1/wait": () => new Promise((resolve) => setTimeout(() => resolve([]), 20)),
  });
  await runOpencode({ sessionId: "ses_1", text: "hola", cwd: "/p", auto: true, exec, pollMs: 1 });
  const reply = calls.find((call) => call.path.endsWith("/reply"));
  assert.deepEqual(reply.body, { decision: "once" });
});

test("sin auto, un permiso pendiente no se aprueba y el turno termina por tiempo", async () => {
  let clock = 0;
  const { exec, calls } = fakeApi({
    "post /api/session/ses_1/prompt": () => ({}),
    "get /api/session/ses_1/permission": () => [{ id: "per_1" }],
    "post /api/experimental/session/ses_1/wait": () => new Promise(() => {}),
  });
  await assert.rejects(
    runOpencode({ sessionId: "ses_1", text: "hola", cwd: "/p", auto: false, exec, timeoutMs: 100, pollMs: 1, now: () => (clock += 60) }),
    /no respondió a tiempo/,
  );
  assert.ok(!calls.some((call) => call.path.endsWith("/reply")));
});

test("una respuesta sin contenido (204) se trata como null", async () => {
  const exec = async () => ({ stdout: "\n" });
  const id = await runOpencode({ sessionId: "ses_1", text: "hola", cwd: "/p", exec, now: () => 0, pollMs: 1 });
  assert.equal(id, "ses_1");
});

test("runOpencode sin directorio del proyecto rechaza sin llamar a la API", async () => {
  const { exec, calls } = fakeApi({});
  await assert.rejects(runOpencode({ text: "hola", exec }), /falta el directorio del proyecto/);
  assert.equal(calls.length, 0);
});

// Mensajes como los devuelve la API: del más reciente al más antiguo.
const apiMessages = [
  { type: "idle" },
  { type: "assistant", content: [
    { type: "text", text: "listo" },
    { type: "tool", name: "write", state: { status: "completed", input: { path: "/p/a.md", content: "x" } } },
    { type: "tool", name: "shell", state: { status: "error", input: {}, content: [{ type: "text", text: "exit 1" }] } },
  ] },
  { type: "assistant", content: [
    { type: "tool", name: "write", state: { status: "completed", input: { path: "/p/a.md" } } },
    { type: "tool", name: "read", state: { status: "completed", input: { path: "/p/b.md" } } },
    { type: "text", text: "miro el fichero" },
  ] },
  { type: "user", text: "dos" },
  { type: "assistant", content: [{ type: "text", text: "anterior" }] },
  { type: "user", text: "uno" },
];

test("opencodeApiTurn toma el último pedido, la respuesta y las acciones del turno", () => {
  const turn = opencodeApiTurn(apiMessages);
  assert.equal(turn.request, "dos");
  assert.equal(turn.reply, "miro el fichero\n\nlisto");
  assert.deepEqual(turn.files, ["/p/a.md"]);
  assert.deepEqual(turn.actions.map((action) => action.name), ["write", "read", "write", "shell"]);
  assert.deepEqual(turn.actions[1], { name: "read", detail: "/p/b.md" });
  assert.deepEqual(turn.problems, ["exit 1"]);
});

test("opencodeApiTurn sin mensajes devuelve un turno vacío", () => {
  assert.deepEqual(opencodeApiTurn([]), { request: null, reply: null, files: [], problems: [], actions: [] });
});

test("readOpencodeApiTurn lee los mensajes de la sesión con la API", async () => {
  const calls = [];
  const exec = async (bin, args) => {
    calls.push(args.join(" "));
    return { stdout: JSON.stringify({ data: apiMessages }) };
  };
  const turn = await readOpencodeApiTurn({ sessionId: "ses_1", exec, bin: "opencode" });
  assert.deepEqual(calls, ["api get /api/session/ses_1/message"]);
  assert.equal(turn.request, "dos");
});

// Permisos: sin `auto`, la petición se avisa una vez y el turno sigue cuando el dueño decide.
test("sin auto, un permiso se avisa una vez y el turno sigue cuando el dueño decide", async () => {
  let pending = [{ id: "per_1", sessionID: "ses_1", action: "bash", resources: ["rm x"], metadata: {} }];
  const asked = [];
  const replies = [];
  const exec = async (bin, args) => {
    const line = args.join(" ");
    if (line === "api get /api/session/ses_1/permission") return { stdout: JSON.stringify({ data: pending }) };
    if (line.startsWith("api post /api/session/ses_1/permission/per_1/reply")) {
      replies.push(JSON.parse(args[args.indexOf("-d") + 1]));
      pending = [];
      return { stdout: "" };
    }
    if (line.includes("/wait")) {
      const until = Date.now() + 2_000;
      while (!replies.length && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 2));
      return { stdout: "" };
    }
    return { stdout: "" };
  };
  setTimeout(() => replyOpencodePermission({ sessionId: "ses_1", requestId: "per_1", decision: "once", exec, bin: "opencode" }), 20);
  await sendAndWait({ sessionId: "ses_1", text: "hola", auto: false, onPermission: (request) => asked.push(request.id), exec, bin: "opencode", pollMs: 5 });
  assert.deepEqual(asked, ["per_1"]);
  assert.deepEqual(replies, [{ decision: "once" }]);
});

test("replyOpencodePermission no acepta aprobar siempre desde la sala", async () => {
  await assert.rejects(replyOpencodePermission({ sessionId: "ses_1", requestId: "per_1", decision: "always", exec: async () => ({ stdout: "" }), bin: "opencode" }), /no permitida/);
});

test("interruptOpencode llama a la ruta de interrupción de la sesión", async () => {
  const calls = [];
  await interruptOpencode({ sessionId: "ses_1", exec: async (bin, args) => { calls.push(args.join(" ")); return { stdout: "" }; }, bin: "opencode" });
  assert.deepEqual(calls, ["api post /api/session/ses_1/interrupt"]);
});

test("describePermission resume la acción y los recursos", () => {
  assert.equal(describePermission({ action: "bash", resources: ["rm -rf x", "y"] }), "bash: rm -rf x, y");
  assert.equal(describePermission({}), "permiso");
});
