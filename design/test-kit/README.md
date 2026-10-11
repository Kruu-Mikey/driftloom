# Driftloom test kit

Playwright measurements behind every number in the mockup's handover.

    npm install
    npx playwright install chromium
    ./run_all.sh path/to/driftloom_vNN.html     # writes images to out/

Compare the output with `expected_output_v16.txt` (v15: `expected_output_v15.txt`).

Color-blind check for the light themes' notes (after run_all.sh has written out/nontext_allon.json):

    python3 cvd_check.py path/to/driftloom_vNN.html out/nontext_allon.json

| Script | What it checks |
|---|---|
| cvd_check.py | Light-theme notes: neighboring-row OKLab distance under protanopia, deuteranopia, tritanopia (Machado 2009) and grayscale, plus each note's contrast under each |
| ui.mjs | The gallery's own audit at 100, 130, 150 and 200% |
| modes.mjs | Which info-line alternation mode applies at each text size |
| s11fine.mjs | 51 text sizes × plain / user text spacing × 6-, 8- and 12-character names, letting only the page's observer react |
| nontext.mjs | Note, beat-cell and lit-cell contrast against the real composited panel (ALLON=1 turns every layer on; SHALLOW=1 and HIDEFIRST=1 keep elements near the top of the page) |
| words.mjs | on / off / roll word contrast against the actual button fill |
| ring.mjs | Focus-ring contrast before vs after focus, for every control in every theme |
| a11y.mjs | Tab order, Enter / Space operation, ARIA snapshot |
| motion.mjs | Press transforms with no preference, with reduce, and with the gallery switch |
| rot.mjs | Info-line turning: 4 s pace, hover / focus / pause holds, tap takeover, resume on next loop |
| fc.mjs | Forced-colours render (dark or light) and probes |
| zoom.mjs | Reflow at 1280, 640 and 320 CSS px |
| shot9iso.mjs, pages.mjs, layers.mjs | Screenshot helpers for visual diffs and contact sheets |

Gotchas:

- At deviceScaleFactor 2, element screenshots more than about 8000 CSS px down the page are unreliable. Keep SHALLOW=1.
- The scripts load local fonts through @fontsource. Without real fonts, the measurements change.

- If the sandbox ships an older pre-installed Chromium, pin `playwright` to the matching version instead of downloading browsers (this run used playwright 1.56.1 with Chromium 141).
