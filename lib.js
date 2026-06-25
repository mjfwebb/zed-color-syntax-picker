"use strict";

// Pure color-parsing + LSP message handling for the Color Syntax Picker
// language server. Kept dependency-free and side-effect-free (except the doc
// store inside createServer) so it can be unit tested directly.
//
// Recognized literals:
//   $rrggbb        -> RGB
//   $rrggbbaa      -> RGBA (alpha last)
//   0xrrggbb       -> RGB
//   0xaarrggbb     -> ARGB (alpha first, e.g. 0xffe53737)

// 8-hex is matched before 6-hex so a full ARGB literal isn't truncated to RGB.
const COLOR_RE =
  /(?<![\w$.])(\$|0x)([0-9a-fA-F]{8}|[0-9a-fA-F]{6})(?![0-9a-fA-F])/g;

function clampByte(f) {
  return Math.max(0, Math.min(255, Math.round(f * 255)));
}
function hex2(n) {
  return n.toString(16).padStart(2, "0");
}

// Decode a matched literal into an LSP color {red,green,blue,alpha} (0..1).
function decode(prefix, hex) {
  const b = [];
  for (let i = 0; i < hex.length; i += 2) {
    b.push(parseInt(hex.slice(i, i + 2), 16) / 255);
  }
  if (hex.length === 6) {
    return { red: b[0], green: b[1], blue: b[2], alpha: 1 };
  }
  if (prefix === "0x") {
    // ARGB
    return { alpha: b[0], red: b[1], green: b[2], blue: b[3] };
  }
  // "$" => RGBA
  return { red: b[0], green: b[1], blue: b[2], alpha: b[3] };
}

// Re-encode a color back into the SAME syntax as the original literal.
function encode(prefix, origLen, color) {
  const r = hex2(clampByte(color.red));
  const g = hex2(clampByte(color.green));
  const bl = hex2(clampByte(color.blue));
  const a = hex2(clampByte(color.alpha));
  if (origLen === 6) return prefix + r + g + bl;
  if (prefix === "0x") return prefix + a + r + g + bl; // ARGB
  return prefix + r + g + bl + a; // $ RGBA
}

// --- position mapping (offset <-> {line, character}) -------------------------
function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}
function posAt(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, character: offset - starts[lo] };
}
function offsetAt(starts, pos) {
  const base = starts[pos.line] != null ? starts[pos.line] : 0;
  return base + pos.character;
}

// --- LSP feature logic -------------------------------------------------------
// Scan whole document; return LSP ColorInformation[].
function findColors(text) {
  const starts = lineStarts(text);
  const out = [];
  COLOR_RE.lastIndex = 0;
  let m;
  while ((m = COLOR_RE.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    out.push({
      range: { start: posAt(starts, start), end: posAt(starts, end) },
      color: decode(m[1], m[2]),
    });
  }
  return out;
}

// Given the current doc text, the edited range, and the chosen color,
// produce ColorPresentation[] that re-write the literal in its original syntax.
function presentationsFor(text, range, color) {
  let prefix = "0x";
  let origLen = 6;
  if (text != null) {
    const starts = lineStarts(text);
    const literal = text.slice(offsetAt(starts, range.start), offsetAt(starts, range.end));
    if (literal.startsWith("$")) {
      prefix = "$";
      origLen = literal.length - 1;
    } else if (literal.toLowerCase().startsWith("0x")) {
      prefix = "0x";
      origLen = literal.length - 2;
    }
    if (origLen !== 8) origLen = 6;
  }
  return [{ label: encode(prefix, origLen, color) }];
}

// --- LSP message dispatcher (holds doc state) --------------------------------
// handle(msg) returns:
//   { id, result }  for requests
//   { exit: true }  for the exit notification
//   null            for handled notifications
function createServer() {
  const docs = new Map();

  function handle(msg) {
    switch (msg.method) {
      case "initialize":
        return {
          id: msg.id,
          result: {
            capabilities: {
              textDocumentSync: { openClose: true, change: 1 }, // 1 = full
              colorProvider: true,
            },
            serverInfo: { name: "color-syntax-picker", version: "0.1.0" },
          },
        };
      case "initialized":
        return null;
      case "textDocument/didOpen":
        docs.set(msg.params.textDocument.uri, msg.params.textDocument.text);
        return null;
      case "textDocument/didChange": {
        const changes = msg.params.contentChanges;
        if (changes && changes.length) {
          docs.set(msg.params.textDocument.uri, changes[changes.length - 1].text);
        }
        return null;
      }
      case "textDocument/didClose":
        docs.delete(msg.params.textDocument.uri);
        return null;
      case "textDocument/documentColor":
        return { id: msg.id, result: findColors(docs.get(msg.params.textDocument.uri) || "") };
      case "textDocument/colorPresentation":
        return {
          id: msg.id,
          result: presentationsFor(
            docs.get(msg.params.textDocument.uri),
            msg.params.range,
            msg.params.color
          ),
        };
      case "shutdown":
        return { id: msg.id, result: null };
      case "exit":
        return { exit: true };
      default:
        // Reply to unknown requests so the client isn't left waiting.
        if (msg.id !== undefined && msg.id !== null) return { id: msg.id, result: null };
        return null;
    }
  }

  return { docs, handle };
}

module.exports = {
  COLOR_RE,
  decode,
  encode,
  lineStarts,
  posAt,
  offsetAt,
  findColors,
  presentationsFor,
  createServer,
};
