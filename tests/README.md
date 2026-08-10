# Tests

See `../docs/TESTING.md` for the full inventory, recorded results, and the
known-expected `zxcheck.js` failure on dense codes.

Quick start:

    node test.js        # codec under frame loss
    node test2.js       # crypto + gzip + full pipeline

End-to-end tests need a headless Chrome. They run against `src/test-copy.html`,
which `assemble.py` produces alongside the shipped build, so build before
testing:

    cd ../src && python3 assemble.py && cd ../tests

The Puppeteer suite takes both its module and its browser from the
environment — no paths are baked in:

    export PUPPETEER_PATH=/path/to/puppeteer      # optional if resolvable
    export CHROME_PATH=/path/to/chrome            # optional if bundled
    node e2e2.js        # encryption / unlock / plain paths
    node e2e4.js        # workers, grid modes, full loop
    node e2e5.js        # engine cascade, offline proof, diagnostics

The calibration test uses Playwright instead, because that is what was
available on the machine it was written on:

    NODE_PATH=/path/to/node_modules node e2e6-calibration.mjs
