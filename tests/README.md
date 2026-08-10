# Tests

See `../docs/TESTING.md` for the full inventory, recorded results, and the
known-expected `zxcheck.js` failure on dense codes.

Quick start:

    node test.js        # codec under frame loss
    node test2.js       # crypto + gzip + full pipeline

End-to-end tests need Puppeteer and a local Chrome. Update the hardcoded
`executablePath` at the top of each e2e file first. They run against
`src/test-copy.html`, which `assemble.py` produces alongside the shipped build,
so build before testing:

    cd ../src && python3 assemble.py && cd ../tests
    node e2e2.js        # encryption / unlock / plain paths
    node e2e4.js        # workers, grid modes, full loop
    node e2e5.js        # engine cascade, offline proof, diagnostics
