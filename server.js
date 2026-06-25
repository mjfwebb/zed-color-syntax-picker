#!/usr/bin/env node
"use strict";

// LSP entry point. Reads Content-Length framed JSON-RPC on stdin, dispatches to
// the pure handler in lib.js, writes responses on stdout. The only feature it
// advertises is document colors, so Zed renders inline swatches + a picker for
// the non-CSS color syntaxes defined in lib.js.

const { createServer } = require("./lib.js");

const { handle } = createServer();

function send(msg) {
  const buf = Buffer.from(JSON.stringify(msg), "utf8");
  process.stdout.write(`Content-Length: ${buf.length}\r\n\r\n`);
  process.stdout.write(buf);
}

let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;
    const header = buffer.slice(0, headerEnd).toString("ascii");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }
    const len = parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + len) return; // wait for the rest of the body
    const body = buffer.slice(bodyStart, bodyStart + len).toString("utf8");
    buffer = buffer.slice(bodyStart + len);

    let msg;
    try {
      msg = JSON.parse(body);
    } catch (_) {
      continue;
    }

    let out;
    try {
      out = handle(msg);
    } catch (_) {
      // Never crash the language server on a single bad message.
      continue;
    }
    if (!out) continue;
    if (out.exit) process.exit(0);
    send(out);
  }
});
process.stdin.on("end", () => process.exit(0));
