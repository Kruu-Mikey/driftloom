# Ears tools

Measuring records and Driftloom renders the same way. Used by the ears
sessions (`docs/EARS.md`). Python needs
`pip install --break-system-packages librosa soundfile` and ffmpeg; the
renderer needs Playwright's Chromium. Run everything from a working folder
outside the repo, with `python3 -I` for anything that reads downloaded
audio.

| Script | What it does |
|---|---|
| `driftloom-ears.sh` | Mikey's side: unzips (nested too), makes 96 kbps Opus, cuts tracks over 5 minutes into 4-minute pieces, keeps every file under 5.5 MB for the Drive connector |
| `sweep.py` | Decodes saved Drive download results into `audio/<album>/` (one album per batch). Needs `EARS_RESULTS` |
| `sweep_rules.py` | The same, choosing the album by title rules (write new rules per pile) |
| `render.mjs` | Renders Driftloom loops to WAV through the real Engine and Synth in headless Chromium, with "Let the loop wander" on: `node render.mjs REPO OUTDIR N SECONDS SEED`; `PICK=3,8` renders only those corpus indices, `TAG` names the files |
| `analyze.py` | The main measures: loudness, bands, stereo width, tails, onsets and pulse, chord changes, tuning, wobble, repetition, drift over 10 s and 60 s, arc, brightness sweep |
| `extra.py` | Finer energy bands (40–60 Hz, 60–120, ... 5k+) and pitch classes above the bass |
| `sections.py` | Floor drops (the low end out for 2 s or more while the rest plays) and full stops (the whole mix 30 dB down for 1 s or more) |
| `summarize.py`, `summarize2.py` | Per-album medians; batch two's tables in batch one's definitions |
| `spec.py` | A 60-second log-frequency spectrogram, for looking at by eye |

Definitions the reports use: medians per file; "steady beat" means pulse
0.6 or more for records, drums on for Driftloom; drift ratio is the median
of drift60/drift10 per file. The measurements for batches one and two are
in the Project as `claude/ears-data.csv`.

Calibration and limits: the wobble measure read a 5-cent wow as 3.3 and a
12-cent wow as 8.0. The chord counter undercounts fast changes (it read
Driftloom as 17 a minute against the generator's 29). Single-file tuning
readings within about ±8 cents are noise. Renders of the same loop differ
from run to run at about -79 dB (the wobble's LFOs).
