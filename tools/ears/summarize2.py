"""Batch-2 summary in the batch-1 report's terms.

Usage: python3 -I summarize2.py
Album table (medians per file; chords/min seconds-weighted), pooled figures
for the six differences for batch 1, pile 2 and Driftloom, side by side.
Definitions match ears-batch-1.md: drift = median of per-file drift60/drift10;
"steady beat" = pulse >= 0.6; 1-5 kHz = b1000_2000 + b2000_5000.
"""
import json, glob
from collections import defaultdict
import numpy as np

# The second pile's albums; set this to the pile being compared.
PILE2 = {"Autechre - Amber", "Oneohtrix Point Never - R Plus Seven", "LFO - Frequencies",
         "The Field - From Here We Go Sublime", "Ryuichi Sakamoto - Thousand Knives", "Porter Ricks - Biokinetics",
         "Mike & Rich - Expert Knob Twiddlers", "Lone - Galaxy Garden", "Autechre - Incunabula",
         "Forest Swords - Engravings", "Death Grips - Fashion Week (Instrumentals)", "Blank Banshee - Blank Banshee 0"}


def rows(pats):
    out = []
    for pat in pats:
        for p in sorted(glob.glob(pat)):
            for l in open(p):
                d = json.loads(l)
                if "error" not in d and "skip" not in d:
                    out.append(d)
    return out


R = rows(["records*.jsonl"])
E = {d["file"]: d for d in rows(["extra*.jsonl"])}
D = rows(["driftloom.jsonl"])
DL = rows(["driftloom-long.jsonl"])
for d in R + D + DL:
    d.update({k: v for k, v in E.get(d["file"], {}).items() if k.startswith("b") or k == "upper_pcs"})


def med(rs, k, w=False):
    v = [(r[k], r.get("seconds", 1)) for r in rs if r.get(k) is not None]
    if not v:
        return float("nan")
    a = np.array([x for x, _ in v], float)
    if not w:
        return float(np.median(a))
    ws = np.array([s for _, s in v], float)
    o = np.argsort(a)
    return float(a[o][np.searchsorted(np.cumsum(ws[o]) / ws.sum(), 0.5)])


def ratio(rs):
    v = [r["drift60"] / r["drift10"] for r in rs if r.get("drift60") and r.get("drift10")]
    return float(np.median(v)) if v else float("nan")


def k15(r):
    return r["b1000_2000"] + r["b2000_5000"] if "b1000_2000" in r else None


for r in R + D + DL:
    r["k15"] = k15(r)
    r["above5k"] = r.get("b5000_11025")

b1 = [r for r in R if r["album"] not in PILE2]
p2 = [r for r in R if r["album"] in PILE2]

print(f"batch 1 files {len(b1)}, pile 2 files {len(p2)}, with extras {sum('b40_60' in r for r in p2)}")
print()
print("| Album | n | Width (dB) | 40–60 Hz % | 60–120 % | 120–250 % | 1–5 kHz % | >5 kHz % | Chords/min | Tail (dB/s) | Tuning (cents) | Drift 60/10 | Pulse | Notes/s | Upper pcs | Wobble |")
print("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
groups = defaultdict(list)
for r in p2:
    groups[r["album"]].append(r)
for a in sorted(groups):
    rs = groups[a]
    print(f"| {a} | {len(rs)} | {med(rs,'width_db'):.0f} | {100*med(rs,'b40_60'):.1f} | {100*med(rs,'b60_120'):.0f} | "
          f"{100*med(rs,'b120_250'):.0f} | {100*med(rs,'k15'):.1f} | {100*med(rs,'above5k'):.1f} | {med(rs,'chord_changes_per_min'):.1f} | "
          f"{med(rs,'tail_db_per_s'):.1f} | {med(rs,'tuning_cents'):+.0f} | {ratio(rs):.2f} | {med(rs,'pulse'):.2f} | "
          f"{med(rs,'onsets_per_s',True):.1f} | {med(rs,'upper_pcs'):.0f} | {med(rs,'wobble_cents'):.1f} |")

print()
print("Pooled (median per file)")
hdr = ["set", "n", "width", "lra", "tail", "chords(w)", "tuning", "|tun|>=8 share", "drift60/10", "repeat", "pulse", "notes/s", "upper_pcs", "wobble", "1-5k%", "40-60%", "arc_db", "sweep_oct"]
print(" | ".join(hdr))
def pooled(name, rs, drs=None):
    t = [r["tuning_cents"] for r in rs if r.get("tuning_cents") is not None]
    vals = [name, len(rs), med(rs, "width_db"), med(rs, "lra"), med(rs, "tail_db_per_s"), med(rs, "chord_changes_per_min"),
            med(rs, "tuning_cents"), np.mean([abs(x) >= 8 for x in t]) if t else float("nan"), ratio(drs or rs), med(rs, "repeat"),
            med(rs, "pulse"), med(rs, "onsets_per_s", True), med(rs, "upper_pcs"), med(rs, "wobble_cents"),
            100 * med(rs, "k15"), 100 * med(rs, "b40_60"), med(rs, "arc_db"), med(rs, "sweep_oct")]
    print(" | ".join(f"{v:.2f}" if isinstance(v, float) else str(v) for v in vals))
pooled("batch1", b1)
pooled("pile2", p2)
pooled("driftloom60", D, DL)
pooled("driftloom150", DL)

print()
print("Band shares by beat (median %), pulse >= 0.6 = steady beat")
bands = ["b0_40", "b40_60", "b60_120", "b120_250", "b250_1000", "b1000_2000", "b2000_5000", "b5000_11025"]
print("set | n | " + " | ".join(bands))
KIT = {x["file"]: x["meta"].get("kit") for x in json.load(open("driftloom/index.json"))}
for d in D:
    d["has_drums"] = KIT.get(d["track"], KIT.get(d["file"].split("/")[-1])) != "none"
for name, rs in [("batch1", b1), ("pile2", p2), ("driftloom", D)]:
    for beat in (False, True):
        if name == "driftloom":
            s = [r for r in rs if r["has_drums"] == beat and "b40_60" in r]
        else:
            s = [r for r in rs if r.get("pulse") is not None and (r["pulse"] >= 0.6) == beat and "b40_60" in r]
        print(f"{name} {'beat' if beat else 'nobeat'} | {len(s)} | " + " | ".join(f"{100*med(s,b):.1f}" for b in bands))

print()
print("Per-album album-level medians, both batches together: how many albums in each range")
allg = defaultdict(list)
for r in R:
    allg[r["album"]].append(r)
def count(fn, label):
    a1 = [a for a in allg if a not in PILE2 and fn(allg[a])]
    a2 = [a for a in allg if a in PILE2 and fn(allg[a])]
    print(f"{label}: batch1 {len(a1)}/{sum(a not in PILE2 for a in allg)}, pile2 {len(a2)}/{sum(a in PILE2 for a in allg)}  {a2}")
count(lambda rs: med(rs, "chord_changes_per_min") < 1, "chords <1/min")
count(lambda rs: med(rs, "chord_changes_per_min") < 2, "chords <2/min")
count(lambda rs: abs(med(rs, "tuning_cents")) >= 8, "|tuning| >= 8")
count(lambda rs: ratio(rs) > 1, "drift ratio > 1")
count(lambda rs: -2.4 <= med(rs, "tail_db_per_s") <= -0.3, "tail 0.3-2.4 dB/s")
count(lambda rs: med(rs, "width_db") > -15, "width wider than -15")
