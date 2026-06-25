"use strict";

// Integration test: spawn the real server.js and drive it over stdio with
// Content-Length framing, the same way Zed does.

const test = require("node:test");
const assert = require("node:assert/strict");
const cp = require("node:child_process");
const path = require("node:path");

const SERVER = path.join(__dirname, "..", "server.js");

function rpc(messages, { expectReplies }) {
  return new Promise((resolve, reject) => {
    const p = cp.spawn(process.execPath, [SERVER, "--stdio"], { stdio: ["pipe", "pipe", "inherit"] });
    const replies = [];
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => {
      p.kill();
      reject(new Error("timeout waiting for replies"));
    }, 4000);

    p.stdout.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        const he = buf.indexOf("\r\n\r\n");
        if (he < 0) break;
        const m = /Content-Length:\s*(\d+)/i.exec(buf.slice(0, he).toString("ascii"));
        const len = parseInt(m[1], 10);
        if (buf.length < he + 4 + len) break;
        replies.push(JSON.parse(buf.slice(he + 4, he + 4 + len).toString("utf8")));
        buf = buf.slice(he + 4 + len);
        if (replies.length === expectReplies) {
          clearTimeout(timer);
          p.kill();
          resolve(replies);
        }
      }
    });

    for (const msg of messages) {
      const b = Buffer.from(JSON.stringify(msg), "utf8");
      p.stdin.write(`Content-Length: ${b.length}\r\n\r\n`);
      p.stdin.write(b);
    }
  });
}

test("end-to-end: initialize + documentColor over stdio", async () => {
  const text = "const a = 0xff101114;\nconst b = $e53737;\nconst c = 0xe53737;\n";
  const replies = await rpc(
    [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { capabilities: {} } },
      {
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: { textDocument: { uri: "file:///t.ts", text } },
      },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "textDocument/documentColor",
        params: { textDocument: { uri: "file:///t.ts" } },
      },
    ],
    { expectReplies: 2 }
  );

  const init = replies.find((r) => r.id === 1);
  assert.equal(init.result.capabilities.colorProvider, true);

  const colors = replies.find((r) => r.id === 2);
  assert.equal(colors.result.length, 3);
  // first is ARGB 0xff101114 -> opaque #101114
  assert.equal(colors.result[0].color.alpha, 1);
  assert.ok(Math.abs(colors.result[0].color.red - 0x10 / 255) < 1e-9);
});

test("end-to-end: colorPresentation preserves ARGB syntax", async () => {
  const text = "x = 0xff101114";
  const replies = await rpc(
    [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { capabilities: {} } },
      {
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: { textDocument: { uri: "file:///t.ts", text } },
      },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "textDocument/colorPresentation",
        params: {
          textDocument: { uri: "file:///t.ts" },
          color: { red: 1, green: 0, blue: 0, alpha: 1 },
          range: { start: { line: 0, character: 4 }, end: { line: 0, character: 14 } },
        },
      },
    ],
    { expectReplies: 2 }
  );

  const pres = replies.find((r) => r.id === 2);
  assert.deepEqual(pres.result, [{ label: "0xffff0000" }]);
});
