# Integrity

Recorded at package time. Re-verify after any rebuild —
`python3 assemble.py` from `src/` reproduces `dist/lightwire.html` byte for byte.

```
6268d69fcbb2a82f21028c67afb1a37c91cce918f44dca8fc9042938e1cfb94a  dist/lightwire.html
8517281002c3ce53ebf7a0f0162374538ea46f1344ef0747e411829ed4548516  src/core.js
bdf337f55f04c191b4fd24731fe9df19383d759050812aa13ae13ebf9a82dd6e  src/template.html
7e31fa85fe545143ad8113c8cd6e6f052c92dbdb38473cdbae1b4076326b14a6  src/assemble.py
bc40c8a15196236b2314db0856f72ca0b49980cd5413b8c852a7349f5fee0859  src/vendor/jsQR.js
18ae399f81182bc9de916e9c77b195df20cc58d6f2d55a62b085a299f1bf1780  src/vendor/qrcode-generator.js
a8ed89e52eae415285e54abc555fa1bcd5bdfcc7d4d586a2f85a88669b7c66aa  src/vendor/zx-reader.js
85d46f55d7c86a4d09bb04273367408b19c324f582d040d018aecb25a9a82942  src/vendor/zxing_reader.wasm
```

The `zxing_reader.wasm` hash matches the `ZXING_WASM_SHA256` constant compiled
into the upstream zxing-wasm 2.2.4 glue code, confirming the binary is the
unmodified upstream build.
