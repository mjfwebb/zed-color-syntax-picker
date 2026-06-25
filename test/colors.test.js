"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  decode,
  encode,
  findColors,
  presentationsFor,
  createServer,
} = require("../lib.js");

// --- decode ------------------------------------------------------------------
test("decode 6-hex is opaque RGB", () => {
  assert.deepEqual(decode("$", "e53737"), {
    red: 0xe5 / 255,
    green: 0x37 / 255,
    blue: 0x37 / 255,
    alpha: 1,
  });
  assert.deepEqual(decode("0x", "e53737"), {
    red: 0xe5 / 255,
    green: 0x37 / 255,
    blue: 0x37 / 255,
    alpha: 1,
  });
});

test("decode 0x 8-hex is ARGB (alpha first)", () => {
  assert.deepEqual(decode("0x", "ffe53737"), {
    alpha: 1,
    red: 0xe5 / 255,
    green: 0x37 / 255,
    blue: 0x37 / 255,
  });
  // 0x00000000 -> fully transparent
  assert.deepEqual(decode("0x", "00000000"), { alpha: 0, red: 0, green: 0, blue: 0 });
});

test("decode $ 8-hex is RGBA (alpha last)", () => {
  assert.deepEqual(decode("$", "e5373780"), {
    red: 0xe5 / 255,
    green: 0x37 / 255,
    blue: 0x37 / 255,
    alpha: 0x80 / 255,
  });
});

// --- encode (syntax-preserving round trip) -----------------------------------
test("encode preserves 0x ARGB alpha-first", () => {
  const color = decode("0x", "ff101114");
  assert.equal(encode("0x", 8, color), "0xff101114");
});

test("encode preserves $ RGBA alpha-last", () => {
  const color = decode("$", "10111480");
  assert.equal(encode("$", 8, color), "$10111480");
});

test("encode preserves 6-hex RGB for both prefixes", () => {
  assert.equal(encode("0x", 6, decode("0x", "101114")), "0x101114");
  assert.equal(encode("$", 6, decode("$", "101114")), "$101114");
});

test("encode clamps out-of-range channels", () => {
  assert.equal(encode("0x", 6, { red: 2, green: -1, blue: 0.5, alpha: 1 }), "0xff0080");
});

// --- regex / findColors ------------------------------------------------------
test("findColors matches all four supported forms once each", () => {
  const text = "a 0xff101114 b $e53737 c 0xe53737 d $ff0000aa";
  const found = findColors(text);
  assert.equal(found.length, 4);
});

test("findColors ignores non-color hex of wrong length", () => {
  // 3,5,7 hex digits and a 10-hex run must NOT match
  const text = "0xfff 0xfffff 0x1234567 0x12345678ab $abc $abcde";
  assert.equal(findColors(text).length, 0);
});

test("findColors does not match hex glued to a word char", () => {
  assert.equal(findColors("zz0xff0000").length, 0);
  assert.equal(findColors("g0xffffffff").length, 0);
});

test("findColors reports correct ranges across lines", () => {
  const text = "line0\n    $e53737: 0xffe53737,\n";
  const found = findColors(text);
  assert.equal(found.length, 2);
  assert.deepEqual(found[0].range, {
    start: { line: 1, character: 4 },
    end: { line: 1, character: 11 },
  });
  assert.deepEqual(found[1].range, {
    start: { line: 1, character: 13 },
    end: { line: 1, character: 23 },
  });
});

// --- the real palette file shape --------------------------------------------
test("findColors on ARGB + RGB palette rows", () => {
  const text = [
    "export const ALPHA_00: number = 0x00000000;",
    "export const Palette32 = {",
    "    $101114: 0xff101114,",
    "};",
    "export const Palette24 = {",
    "    $101114: 0x101114,",
    "};",
  ].join("\n");
  const found = findColors(text);
  // ALPHA_00, ($101114 key + 0xff101114), ($101114 key + 0x101114) = 5
  assert.equal(found.length, 5);
  // transparent black
  assert.deepEqual(found[0].color, { alpha: 0, red: 0, green: 0, blue: 0 });
  // ARGB value is opaque #101114
  assert.equal(found[2].color.alpha, 1);
});

// --- colorPresentation (picker write-back) -----------------------------------
test("presentationsFor rewrites ARGB literal alpha-first", () => {
  const text = "    $101114: 0xff101114,";
  const range = { start: { line: 0, character: 13 }, end: { line: 0, character: 23 } };
  const out = presentationsFor(text, range, { red: 1, green: 0, blue: 0, alpha: 1 });
  assert.deepEqual(out, [{ label: "0xffff0000" }]);
});

test("presentationsFor rewrites $ key as 6-hex RGB", () => {
  const text = "    $101114: 0xff101114,";
  const range = { start: { line: 0, character: 4 }, end: { line: 0, character: 11 } };
  const out = presentationsFor(text, range, { red: 1, green: 0, blue: 0, alpha: 1 });
  assert.deepEqual(out, [{ label: "$ff0000" }]);
});

test("presentationsFor rewrites $ RGBA literal alpha-last", () => {
  const text = "x = $ff0000aa";
  const range = { start: { line: 0, character: 4 }, end: { line: 0, character: 13 } };
  const out = presentationsFor(text, range, { red: 0, green: 1, blue: 0, alpha: 0.5 });
  assert.deepEqual(out, [{ label: "$00ff0080" }]);
});

// --- dispatcher --------------------------------------------------------------
test("server advertises colorProvider capability", () => {
  const { handle } = createServer();
  const res = handle({ id: 1, method: "initialize", params: {} });
  assert.equal(res.result.capabilities.colorProvider, true);
});

test("server tracks open docs and answers documentColor", () => {
  const { handle } = createServer();
  handle({
    method: "textDocument/didOpen",
    params: { textDocument: { uri: "file:///a.ts", text: "$e53737 0xffe53737" } },
  });
  const res = handle({
    id: 2,
    method: "textDocument/documentColor",
    params: { textDocument: { uri: "file:///a.ts" } },
  });
  assert.equal(res.result.length, 2);
});

test("didChange (full sync) updates the stored doc", () => {
  const { handle } = createServer();
  handle({
    method: "textDocument/didOpen",
    params: { textDocument: { uri: "file:///a.ts", text: "$e53737" } },
  });
  handle({
    method: "textDocument/didChange",
    params: {
      textDocument: { uri: "file:///a.ts" },
      contentChanges: [{ text: "$e53737 $00ff00" }],
    },
  });
  const res = handle({
    id: 3,
    method: "textDocument/documentColor",
    params: { textDocument: { uri: "file:///a.ts" } },
  });
  assert.equal(res.result.length, 2);
});

test("exit notification signals shutdown", () => {
  const { handle } = createServer();
  assert.deepEqual(handle({ method: "exit" }), { exit: true });
});

test("unknown request gets a null reply, unknown notification is dropped", () => {
  const { handle } = createServer();
  assert.deepEqual(handle({ id: 9, method: "foo/bar", params: {} }), { id: 9, result: null });
  assert.equal(handle({ method: "foo/baz", params: {} }), null);
});
