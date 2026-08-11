# Screenshots

Captured from headless test runs (no real camera involved).

| File | Shows |
|---|---|
| `shot3-send.png` | Sender: single-code mode, gzip + encryption active, fingerprint. |
| `shot3-progress.png` | Receiver mid-transfer: readout, ACK code, then the estimated progress bar. |
| `shot3-locked.png` | Receiver: all blocks in, awaiting passphrase — the result panel sits above everything. |
| `shot3-done.png` | Receiver: checksum verified, fingerprint shown, result at the top of the page. |
| `shot4-grid.png` | Sender: 2×2 grid mode. |
| `shot4-ludicrous.png` | Sender: 3×3 Ludicrous preset, worker pipeline running. |
| `shot5-diag.png` | Receiver: engine, px/module and optics verdict readouts. |
| `shot6-calibrating.png` | Sender: mid-sweep on setting 3 of 6, showing the codes it is actually managing to paint. |
| `shot6-cal-results.png` | Sender: the ladder with per-setting paint rates, two settings flagged sender-limited, and the receiver's verdict arrived over the ACK channel. |
| `shot6-recv-verdict.png` | Receiver: all six settings scored, the winner picked on measured KB/s rather than code rate, and the prediction marked as a prediction. |
| `shot7-bigfile.png` | Receiver on a 12.57 MB transfer (16,476 blocks) in an 800 px window: the whole screen fits, and the estimate reads 44% while only 33 blocks are actually solved — the reason the block grid was replaced. |

The `shot6-*` figures come from a simulated optical link — frames are handed to
the decoder with a code width in camera pixels — so the KB/s and px/module
numbers are plausible, not observed. Nothing here has met a real camera.
