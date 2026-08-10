# Publishing analysis

Nothing has been published. This document exists so the decision can be made
with the facts already gathered, rather than re-derived.

**Not legal advice.** The licence facts below were read off the packages
themselves and should be re-verified against the upstream repositories before
anything goes public.

---

## Licence position

### Lightwire's own code

`src/core.js`, `src/template.html`, `src/assemble.py` and the tests were written
from scratch for this project. No code was copied from Decimen, qrs,
QRFileTransfer, ShadowCat, libcimbar, or the `luby-transform` npm package — the
LT implementation, base45 codec, container format and wire protocol are original.

This matters specifically because **Decimen is AGPL from v0.3.0 onward**. Had the
project started as a fork, the AGPL would have propagated. It did not, so the
owner is free to choose any licence.

**No licence has been chosen yet.** That is decision #1.

### Vendored dependencies

| Library | Version | Licence | Notes |
|---|---|---|---|
| qrcode-generator (Kazuhiko Arase) | vendored | **MIT** | Copyright header intact at the top of the file. |
| jsQR (Cosmo Wolfe) | vendored | **Apache-2.0** | Fallback decoder only. |
| zxing-wasm (glue) | 2.2.4 | **MIT** | Per its `package.json`. |
| ZXing-C++ (the compiled `.wasm`) | commit `fba4e95…` | **Apache-2.0** | The actual decoder engine. |

Provenance check on the binary:
`sha256(zxing_reader.wasm) = 85d46f55d7c86a4d09bb04273367408b19c324f582d040d018aecb25a9a82942`,
matching the `ZXING_WASM_SHA256` constant compiled into the upstream glue.

### What Apache-2.0 requires of you

Both jsQR and ZXing-C++ are Apache-2.0, which is permissive but has real
obligations that a single-file distribution makes easy to overlook:

1. **Include a copy of the Apache-2.0 licence text** with the distribution.
2. **Retain copyright, patent, trademark and attribution notices** from the source.
3. **State that you modified files**, where you did.
4. **Propagate any `NOTICE` file** contents from upstream, if one exists.

**Current state: the footer credits qrcode-generator (MIT) and jsQR (Apache-2.0)
but does NOT mention ZXing at all, and no licence texts are bundled.** That is
the single most concrete blocker to publishing as-is.

### Fix before publishing

- [ ] Add ZXing-C++ / zxing-wasm to the in-app footer credit.
- [ ] Add a `LICENSES/` folder (or a single `THIRD-PARTY-NOTICES.md`) containing
      the full MIT and Apache-2.0 texts plus each project's copyright line.
- [ ] Since the file is meant to travel *alone*, also embed a compact attribution
      block as an HTML comment at the top of `dist/lightwire.html` — a bundled
      sibling file does not travel with a file someone emails to themselves.
      This is the point most likely to be missed.
- [ ] Note in the docs that the ZXing WASM binary is redistributed unmodified.
- [ ] Choose and add Lightwire's own licence.

MIT or Apache-2.0 for Lightwire itself would both be compatible with everything
vendored. Apache-2.0 has the advantage of matching the strictest inbound licence
and including an explicit patent grant.

---

## Distribution options

The artifact is one static file with no build step, no server, and no network
calls. That makes hosting almost trivial and mostly a question of audience.

| Option | Fit | Notes |
|---|---|---|
| **GitHub repo + Releases** | Best default | Source plus a downloadable built file. Releases give versioned, hash-verifiable downloads — which matters for a security-adjacent tool. |
| **GitHub Pages** | Good companion | Serves it over HTTPS, so the camera works without the localhost dance. One line in the README. |
| **Self-hosted (existing VPS)** | Good | Full control; put it on a subdomain. Same benefit: HTTPS means camera works directly. |
| **Gist / single-file paste** | Weak | No versioning, no docs, no attribution structure. Fine for a private link, not for publishing. |
| **npm** | Poor fit | It is not a library and has no dependencies. |

**Recommendation if publishing:** GitHub repo (source + docs) with Pages enabled
for a live demo, and built files attached to tagged Releases with published
SHA-256 hashes.

### Hosting caveat worth stating publicly

If you host a live version, users are trusting *your server* to serve
unmodified code — for an air-gap tool that is a meaningful trust shift. Anyone
serious should download the file and verify its hash. Say so in the README
rather than letting it be discovered.

---

## Claims to be careful about

The tool will be read as a security tool whether or not it is presented as one.
Every claim below is currently **true** — keep it that way.

- **"No network."** Verified: `e2e5.js` aborts all non-localhost requests and
  everything still works, including the WASM engine. This claim breaks the moment
  anyone adds a CDN font, an analytics snippet, or a remote WASM fetch. Guard it
  with a test, and keep `externalRequests: 0` in CI if there ever is CI.
- **"Encrypted."** AES-256-GCM with PBKDF2 at 250k iterations is sound for the
  stated purpose. Do not describe it as protecting against a determined attacker
  who has recorded the screen *and* can brute-force a weak passphrase — the
  passphrase is the whole security boundary. Recommend long passphrases in the UI.
- **"Air-gapped."** Correct in the sense of no network path. It is worth being
  explicit that a camera in the room defeats an unencrypted transfer, since that
  is exactly the threat encryption was added for.
- **Speed numbers.** The presets are labelled with *nominal* rates
  (6 / 48 / 189 KB/s). Real optical throughput is lower and camera-bound. The
  README should quote the C920 forecast from `CAMERA.md` rather than the nominal
  ceiling, or the project will read as overclaiming.

---

## Other open questions for the owner

1. **Name.** "Lightwire" was chosen in-session. It has not been checked against
   existing projects, npm names, domains, or trademarks. Check before committing
   to it publicly.
2. **Cryptography and jurisdiction.** The tool ships strong encryption. Publicly
   distributing open-source crypto is routine and generally exempt in most
   jurisdictions, but the specifics depend on where you publish from. Worth a
   quick check rather than an assumption.
3. **Support expectations.** A published tool attracts issues, especially about
   cameras. `CAMERA.md` is written to be the answer to most of them; consider
   linking it directly from the README and from the in-app camera note.
4. **Slim build.** If file size becomes a complaint (1.65 MB, mostly the WASM
   engine), the answer is a second build target, not removing the engine — see
   `DECISIONS.md` §10.
5. **Attribution to prior art.** Decimen, qrs, QRFileTransfer and libcimbar were
   surveyed and informed the design even though no code was taken. A "prior art"
   section in the README would be honest and good practice.

---

## Pre-publication checklist

- [ ] Choose Lightwire's licence.
- [ ] Bundle third-party licence texts, **and** embed an attribution comment
      inside `dist/lightwire.html` itself.
- [ ] Credit ZXing in the visible footer.
- [ ] Verify the name is free.
- [ ] Re-verify all four upstream licences at their sources.
- [ ] Manual camera pass on real hardware (see `HANDOFF.md`) — nothing optical
      has been tested outside forecasts.
- [ ] Decide hosted-demo vs download-only; if hosted, publish file hashes.
- [ ] Rewrite the README's speed claims around realistic figures.
- [ ] Test the shipped file once more from a clean download, both `file://` and
      `localhost`, on Windows and one other OS.
