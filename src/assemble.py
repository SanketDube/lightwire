#!/usr/bin/env python3
"""Lightwire build: inline everything into one self-contained HTML file.

Deliberately a string-substitution script rather than a bundler -- no npm, no
lockfile, no network needed to build. See docs/DECISIONS.md #13.

Outputs:
  ../dist/lightwire.html   the shipped artifact
  ./test-copy.html         same file plus test hooks (tests run against this)
"""
import base64, os

HERE = os.path.dirname(os.path.abspath(__file__))
VENDOR = os.path.join(HERE, "vendor")
DIST = os.path.abspath(os.path.join(HERE, "..", "dist"))


def read(path, mode="r"):
    with open(path, mode) as f:
        return f.read()


# --- core.js, stripped of its Node export tail and wrapped as the LW namespace ---
core = read(os.path.join(HERE, "core.js")).split('if (typeof module !== "undefined")')[0]
core = (
    "var LW=(function(){\n" + core +
    "\nreturn {base45Encode:base45Encode,base45Decode:base45Decode,crc32:crc32,makeEncoder:makeEncoder,"
    "makeDecoder:makeDecoder,parseHeader:parseHeader,buildContainer:buildContainer,openContainer:openContainer,"
    "FLAG_ENC:FLAG_ENC,FLAG_GZ:FLAG_GZ,rungOf:rungOf,withRung:withRung,"
    "gzipBytes:gzipBytes,gunzipBytes:gunzipBytes,"
    "encryptBytes:encryptBytes,decryptBytes:decryptBytes,sha256Hex:sha256Hex,subtleOK:subtleOK};\n})();"
)

# The QR generator + core go into a <script type="text/plain"> block so the same
# text can be eval'd on the main thread AND reused verbatim as the Worker body.
libsrc = read(os.path.join(VENDOR, "qrcode-generator.js")) + "\n;\n" + core
assert "</scr" + "ipt" not in libsrc.lower(), "libsrc would break the text/plain block"

tpl = read(os.path.join(HERE, "template.html"))
zxb64 = base64.b64encode(read(os.path.join(VENDOR, "zxing_reader.wasm"), "rb")).decode()

# The shipped file is meant to travel alone -- emailed to yourself, carried on a
# stick -- so a sibling LICENSE file does not travel with it. The attribution
# has to be inside the artifact. It goes AFTER the doctype: a comment before it
# would push the browser into quirks mode. No "--" inside, that ends a comment.
ATTRIBUTION = """<!--
  Lightwire - single-file optical file transfer over QR codes.
  Copyright 2026 Sanket Dube. Licensed under the Apache License, Version 2.0.
  http://www.apache.org/licenses/LICENSE-2.0

  This file embeds, unmodified:
    jsQR                Copyright Cosmo Wolfe and contributors      Apache-2.0
    ZXing-C++ (wasm)    Copyright the ZXing-C++ project authors     Apache-2.0
    qrcode-generator    Copyright (c) 2009 Kazuhiko Arase           MIT
    zxing-wasm (glue)   Copyright (c) 2023 Ze-Zheng Wu              MIT

  Full licence texts and notices:
  https://github.com/SanketDube/lightwire/blob/main/THIRD-PARTY-NOTICES.md
  "QR Code" is a registered trademark of DENSO WAVE INCORPORATED.
-->"""
assert "--" not in ATTRIBUTION[4:-3], "'--' inside an HTML comment ends it early"
DOCTYPE = "<!DOCTYPE html>"
assert tpl.startswith(DOCTYPE), "template must open with the doctype"
tpl = DOCTYPE + "\n" + ATTRIBUTION + tpl[len(DOCTYPE):]

out = (tpl.replace("__LIBSRC__", libsrc)
          .replace("__JSQR__", read(os.path.join(VENDOR, "jsQR.js")))
          .replace("__ZXJS__", read(os.path.join(VENDOR, "zx-reader.js")))
          .replace("__ZXWASM_B64__", zxb64))

os.makedirs(DIST, exist_ok=True)
with open(os.path.join(DIST, "lightwire.html"), "w") as f:
    f.write(out)

# Test build: hooks injected at a fixed anchor so the shipped file stays clean.
# Add new hooks HERE, never in template.html. See docs/DECISIONS.md #14.
hooks = (
    'window.__feed=handleFrame;window.__dec=function(){return dec};'
    'window.__result=function(){return result};'
    'window.__q=function(){return frameQ.length};window.__cells=function(){return cellCanvas};'
    'window.__workers=function(){return workers.length};'
    'window.__engine=function(){return getEngine()};window.__hf=handleFrame;'
    'window.__ppm=function(){return ppmEma};'
    'window.__calStart=startCalibration;window.__calRung=function(){return calRung};'
    'window.__calStats=function(){return calStats};window.__calRec=function(){return calRec};'
    'window.__rcal=function(){return {runs:calRuns,rec:rcalRec,seen:calSeen}};'
    'window.__calFinish=finishCal;window.__calLadder=CAL_LADDER;'
    'window.__calTiming=function(ms,settle,quiet){CAL_MS=ms;CAL_SETTLE=settle;CAL_QUIET=quiet};'
    'window.__calFps=function(){return CAL_FPS};'
    'window.__takeRec=takeRecommendation;\nsetRole("send");'
)
with open(os.path.join(HERE, "test-copy.html"), "w") as f:
    f.write(out.replace('setRole("send");', hooks))

print("built %d bytes -> %s" % (len(out), os.path.join(DIST, "lightwire.html")))
