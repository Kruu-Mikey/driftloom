"""Per-album medians of the measures, with Driftloom loops as the last rows.

Usage: python3 -I summarize.py [--csv out.csv]
Reads records*.jsonl (records) and driftloom*.jsonl (loops).
Split pieces of one track are pooled by album like any other file, and
seconds-weighted where that matters (onsets, changes per minute).
"""
import glob, json, sys
from collections import defaultdict
import numpy as np

COLS = [
    ("lufs", "LUFS", 1), ("lra", "LRA", 1), ("crest_db", "crest", 1),
    ("centroid_hz", "bright Hz", 0), ("pres_2k_5k", "2-5k %", 100), ("air_gt5k", ">5k %", 100),
    ("sub_lt120", "<120 %", 100), ("width_db", "width", 1),
    ("onsets_per_s", "notes/s", 2), ("tempo", "tempo", 0), ("pulse", "pulse", 2),
    ("tail_db_per_s", "tail dB/s", 1),
    ("pitch_classes", "pcs", 1), ("chord_changes_per_min", "chords/min", 1),
    ("bass_hold", "bass hold", 2), ("bass_changes_per_min", "bass/min", 1),
    ("tuning_cents", "tuning", 0), ("wobble_cents", "wobble", 2), ("bend_share", "bends", 3),
    ("repeat", "repeat", 2), ("drift10", "drift10", 2), ("drift60", "drift60", 2),
    ("arc_db", "arc dB", 1), ("sweep_oct", "sweep oct", 2),
]


def load(patterns, group_key):
    rows = []
    for pat in patterns:
        for p in glob.glob(pat):
            for line in open(p):
                d = json.loads(line)
                if "error" in d or "skip" in d:
                    continue
                rows.append(d)
    groups = defaultdict(list)
    for d in rows:
        groups[group_key(d)].append(d)
    return groups


def med(rows, key, weight=False):
    v = [(r[key], r.get("seconds", 1)) for r in rows if r.get(key) is not None]
    if not v:
        return None
    vals = np.array([a for a, _ in v], float)
    if weight:
        w = np.array([b for _, b in v], float)
        order = np.argsort(vals)
        cw = np.cumsum(w[order]) / w.sum()
        return float(vals[order][np.searchsorted(cw, 0.5)])
    return float(np.median(vals))


def table(groups, label_width=34):
    head = f"{'':{label_width}}" + "".join(f"{c[1]:>10}" for c in COLS)
    print(head)
    for name in sorted(groups):
        rows = groups[name]
        cells = []
        for key, _, scale in COLS:
            m = med(rows, key, weight=True)
            if m is None:
                cells.append(f"{'-':>10}")
            else:
                val = m * (scale if scale > 2 else 1)
                dec = 1 if scale > 2 else scale
                cells.append(f"{val:>10.{dec}f}")
        print(f"{name[:label_width]:{label_width}}" + "".join(cells) + f"   n={len(rows)}")


if __name__ == "__main__":
    rec = load(["records*.jsonl"], lambda d: d["album"])
    table(rec)
    print()
    loops = load(["driftloom*.jsonl"], lambda d: "Driftloom: " + d["track"].split("-", 1)[1].replace(".wav", ""))
    if loops:
        table(loops)
        allrows = [r for v in loops.values() for r in v]
        print()
        table({"Driftloom: ALL LOOPS": allrows})
