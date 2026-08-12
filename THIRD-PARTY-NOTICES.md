# Third-party notices

Lightwire ships as a single HTML file with every dependency inlined. Those
dependencies keep their own licences, and this file carries the notices that
those licences require.

Lightwire's own code — `src/core.js`, `src/template.html`, `src/assemble.py`
and `tests/` — is licensed under Apache-2.0; see `LICENSE`.

**One file is modified; the rest are byte for byte as obtained from upstream.**
Verified 2026-08-10, amended 2026-08-12:

| Component | Version | Licence | Bundled as |
|---|---|---|---|
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) | vendored | MIT | `src/vendor/qrcode-generator.js` — **MODIFIED, see below** |
| [jsQR](https://github.com/cozmo/jsQR) | 1.4.0 | Apache-2.0 | `src/vendor/jsQR.js` |
| [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) (JS glue) | 2.2.4 | MIT | `src/vendor/zx-reader.js` |
| [ZXing-C++](https://github.com/zxing-cpp/zxing-cpp) (compiled engine) | commit `fba4e95…` | Apache-2.0 | `src/vendor/zxing_reader.wasm` |

### Modification to qrcode-generator

`src/vendor/qrcode-generator.js` has **two methods added** by this project on
2026-08-12: `makeAndGetMask()` and `makeWithMask(pattern)`. Nothing existing
was altered — `make()` and every other public method behave exactly as
upstream, and the original copyright header is intact. The addition is marked
in the file between `LIGHTWIRE MODIFICATION` comments.

Reason: `make()` builds each QR code nine times, eight of those to score mask
patterns. Lightwire generates thousands of codes per transfer from
statistically identical data, so the added methods let it run that search once
and reuse the answer. Measured effect: 3.8x more codes per second on the
sending machine. See `docs/DECISIONS.md` §22.

The MIT licence permits modification; this notice records it so nobody has to
diff the file to discover it.

Provenance of the WebAssembly binary:

```
sha256(src/vendor/zxing_reader.wasm)
  = 85d46f55d7c86a4d09bb04273367408b19c324f582d040d018aecb25a9a82942
```

which matches the `ZXING_WASM_SHA256` constant compiled into the upstream
zxing-wasm glue. Re-verify this if the binary is ever re-downloaded.

Neither Apache-2.0 project (jsQR, ZXing-C++) publishes a `NOTICE` file of its
own — checked at both repositories on 2026-08-10 — so section 4(d) of the
Apache licence carries nothing further into this distribution.

"QR Code" is a registered trademark of DENSO WAVE INCORPORATED.

---

## Apache License 2.0 components

**jsQR** — Copyright Cosmo Wolfe and contributors. Used as the last-resort
barcode decoder where neither the OS decoder nor the bundled ZXing engine is
available.

**ZXing-C++** — Copyright the ZXing-C++ project authors. The compiled
WebAssembly reader is the primary decode engine on Windows, Linux, and any
platform without a native `BarcodeDetector`.

Both are distributed under the Apache License, Version 2.0. The complete
licence text is in `LICENSE` at the root of this repository and is reproduced
in full there; it applies to these components as well as to Lightwire itself.
You may obtain a copy of the licence at:

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
License for the specific language governing permissions and limitations under
the License.

---

## MIT licence components

### qrcode-generator

The original copyright header is preserved verbatim at the top of
`src/vendor/qrcode-generator.js`:

```
// QR Code Generator for JavaScript
//
// Copyright (c) 2009 Kazuhiko Arase
//
// URL: http://www.d-project.com/
//
// Licensed under the MIT license:
//  http://www.opensource.org/licenses/mit-license.php
//
// The word 'QR Code' is registered trademark of
// DENSO WAVE INCORPORATED
//  http://www.denso-wave.com/qrcode/faqpatent-e.html
```

### zxing-wasm

Copyright (c) 2023 Ze-Zheng Wu.

### MIT licence text

Applies to both components above, with the respective copyright line.

```
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Prior art

No code was taken from any of these, but they were surveyed before Lightwire
was built and they informed the design. Credit where it is due:

- [Decimen](https://decimen.app) — fountain-coded optical transfer, AGPL from
  v0.3.0 onward.
- [qifi-dev/qrs](https://github.com/qifi-dev/qrs) — fountain codes via the
  `luby-transform` npm package.
- [LucaIaco/QRFileTransfer](https://github.com/LucaIaco/QRFileTransfer) — the
  bidirectional ACK idea, there used for stop-and-wait.
- [libcimbar](https://github.com/sz3/libcimbar) — colour/multi-layer codes and
  the throughput ceiling they reach.
- ShadowCat — the single-file constraint, without fountain coding.

See `docs/DECISIONS.md` §1 for what was taken from each idea and what was not.
