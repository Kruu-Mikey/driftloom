#!/usr/bin/env bash
# Runs every check against one mockup file. Usage: ./run_all.sh path/to/driftloom.html
# First time: npm install && npx playwright install chromium
set -u
F="${1:?give the mockup html path}"
mkdir -p out
run() { echo; echo "=== $1 ==="; shift; "$@" || echo "!!! failed"; }
run "Gallery audit at 100/130/150/200% (page's own auditPhones)" node ui.mjs "$F" out/ui
run "Which alternation mode at each size" node modes.mjs "$F"
run "51 sizes x plain/spaced x name lengths (observer only)" node s11fine.mjs "$F"
run "Non-text contrast: notes (all layers on)" env ALLON=1 SHALLOW=1 TALL=1 node nontext.mjs "$F" out/nontext_allon.json
run "Non-text contrast: beats, lit cell (themes 1-6)" env SHALLOW=1 TALL=1 node nontext.mjs "$F" out/nontext.json
run "Non-text contrast: beats, lit cell (themes 7-9)" env SHALLOW=1 HIDEFIRST=1 TALL=1 node nontext.mjs "$F" out/nontext789.json
run "Button word contrast (on / off / roll)" node words.mjs "$F"
run "Focus-ring contrast, every control, every theme" node ring.mjs "$F"
run "Keyboard order, operation, ARIA tree" node a11y.mjs "$F"
run "Reduced motion" env SHALLOW=1 node motion.mjs "$F"
run "Alternating info lines: timing, holds, takeover" node rot.mjs "$F"
run "Forced colours (writes out/fc_*.png)" node fc.mjs "$F" out/fc dark
run "Reflow at 1280 / 640 / 320" node zoom.mjs "$F"
