# WebAssembly engines

Engines compiled to WebAssembly live here as `<name>.wasm` and are loaded on
first use with `LBWasm.load('<name>')` (`js/engines/wasm.js`). The loader
keeps the bytes in Cache Storage, so a module that has loaded once also works
offline.

Rules for adding one:

1. Build it from a released, open-source version; note the source, version
   and build command in this file.
2. Add its licence to `../LICENSES.md`.
3. Use a plain name (letters, digits, `-`, `_`); the loader refuses paths.
4. Add tests that run the real module.

| File | What it is | Licence |
|---|---|---|
| `selftest.wasm` | 41-byte module exporting `add(a, b)`, used by the loader's tests | AGPL-3.0 (Layerbit) |
| `jq.wasm` + `jq.js` | jq 1.7 compiled to WebAssembly by jq-web 0.6.2 (npm `jq-web`, files copied unchanged). Emscripten's own loader in `jq.js` fetches `jq.wasm` from this folder, so it is loaded with a script tag rather than `LBWasm.load`; the service worker pre-caches both. | MIT (jq), ISC (jq-web) |
