# Color Syntax Picker, a Zed extension

Inline color swatches and a color picker in [Zed](https://zed.dev) for color
literals that Zed does not recognize on its own: `$rrggbb`, `0xrrggbb`, and
ARGB `0xaarrggbb`.

By default Zed only shows swatches for CSS-style colors. Game engines, graphics
code, and palette files often store colors as `0xff101114` (ARGB) or `$e53737`.
This extension makes those clickable too.

## Supported syntaxes

| Syntax       | Meaning              | Example      | Picker writes back |
| ------------ | -------------------- | ------------ | ------------------ |
| `$rrggbb`    | RGB                  | `$e53737`    | `$rrggbb`          |
| `$rrggbbaa`  | RGBA (alpha last)    | `$e5373780`  | `$rrggbbaa`        |
| `0xrrggbb`   | RGB                  | `0xe53737`   | `0xrrggbb`         |
| `0xaarrggbb` | ARGB (alpha first)   | `0xffe53737` | `0xaarrggbb`       |

Editing a swatch rewrites the literal in the same syntax and length it was found
in. An ARGB literal stays ARGB with alpha first. A `$` literal stays `$`. A
6-hex literal stays 6-hex.

Note on the 8-hex forms: `0x` plus 8 hex is read as ARGB (alpha first), and `$`
plus 8 hex is read as RGBA (alpha last). `0x00000000` shows as fully
transparent.

## How it works

Zed draws inline color swatches only from an LSP
[`textDocument/documentColor`](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocument_documentColor)
response. This extension registers a small, dependency-free language server (a
Node script run with Zed's bundled Node) that does two things:

1. Scans open documents for the syntaxes above and reports them as document
   colors.
2. Handles `colorPresentation` so the picker writes the value back in its
   original syntax.

It advertises nothing else. No diagnostics, no completions, no formatting. It
just adds swatches.

## Install as a dev extension

1. Install Rust with [rustup](https://rustup.rs). Zed compiles the extension to
   WASM on install, and a Homebrew or otherwise installed Rust toolchain will
   not work for dev extensions.
2. In Zed, open the command palette and run `zed: install dev extension`, then
   select this folder.
3. Open a file with a color literal (`.ts`, `.js`, `.rs`, and so on). Swatches
   appear. Click one to open the picker.

Run `zed --foreground` to see language-server logs while developing.

## Choosing which languages get swatches

Edit the `languages = [...]` list in [`extension.toml`](extension.toml). Each
entry must match a Zed language `name`, such as `TypeScript`, `TSX`,
`JavaScript`, `Rust`, `C`, `C++`, `GLSL`, `Python`, or `Go`. Add or remove
entries, then reload the extension.

## Development

```sh
npm test      # or: node --test
```

Tests use plain `node:test` and `node:assert` with no dependencies. They cover
color decoding (RGB, RGBA, ARGB), syntax-preserving re-encoding, the match regex
(including rejection of wrong-length and word-glued hex), document-color ranges,
the LSP dispatcher, and an end-to-end stdio round trip against `server.js`.

## Project layout

```
extension.toml   manifest and language-server registration
Cargo.toml       Rust crate for the WASM extension
src/lib.rs       extension: launches server.js via Zed's bundled Node
lib.js           pure color logic and LSP message handling (unit tested)
server.js        LSP entry point: Content-Length framing over stdio
test/            node:test suites
```

## License

[MIT](LICENSE)
