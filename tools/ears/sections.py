"""Breakdowns: how often the low end drops out while the music keeps playing.

Usage: python3 -I sections.py OUT.jsonl FILE [FILE ...]   (skips files done)

Per 0.5-s frame: energy below 120 Hz (kick and bass) and 120 Hz-5 kHz (the
rest). A "low drop" is a run of at least 2 s where the low band sits 12 dB
or more under its own 75th percentile while the rest stays within 12 dB of
its median (so it isn't a pause or a fade). Reported per minute, with the
median drop length. Also "full rests": runs of 1 s or more where everything
is 30 dB under the median (a real gap in the music).
"""
import json, os, subprocess, sys
import numpy as np

SR = 22050
HOP = SR // 2


def decode(path):
    raw = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", path, "-f", "f32le",
                          "-ac", "1", "-ar", str(SR), "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32)


def runs(mask, min_len):
    out, n = [], 0
    for m in list(mask) + [False]:
        if m:
            n += 1
        else:
            if n >= min_len:
                out.append(n)
            n = 0
    return out


def run(path):
    y = decode(path)
    out = {"file": path, "album": os.path.basename(os.path.dirname(path)), "track": os.path.basename(path),
           "seconds": round(len(y) / SR, 1)}
    if len(y) < SR * 20:
        out["skip"] = 1
        return out
    n = len(y) // HOP
    frames = y[: n * HOP].reshape(n, HOP) * np.hanning(HOP)
    P = np.abs(np.fft.rfft(frames, axis=1)) ** 2
    f = np.fft.rfftfreq(HOP, 1 / SR)
    low = 10 * np.log10(P[:, (f >= 30) & (f < 120)].sum(axis=1) + 1e-12)
    rest = 10 * np.log10(P[:, (f >= 120) & (f < 5000)].sum(axis=1) + 1e-12)
    tot = 10 * np.log10(P[:, f >= 30].sum(axis=1) + 1e-12)
    # Skip fades: the first and last 10%.
    a, b = int(n * 0.1), int(n * 0.9)
    low, rest, tot = low[a:b], rest[a:b], tot[a:b]
    minutes = (b - a) * 0.5 / 60
    drop = (low < np.percentile(low, 75) - 12) & (rest > np.median(rest) - 12)
    # Only where the low end is normally there: kick or bass sounding in at
    # least 75% of frames. Sparse bass isn't a breakdown.
    out["low_on_share"] = round(float(1 - drop.mean()), 3)
    if drop.mean() > 0.25:
        out["low_drops_per_min"] = None
        out["rests_per_min"] = round(len(runs(tot < np.median(tot) - 30, 2)) / minutes, 2)
        return out
    d = runs(drop, 4)
    gap = tot < np.median(tot) - 30
    g = runs(gap, 2)
    out["low_drops_per_min"] = round(len(d) / minutes, 2)
    out["low_drop_len_s"] = round(float(np.median(d)) * 0.5, 1) if d else None
    out["low_drop_share"] = round(sum(d) / (b - a), 3)
    out["rests_per_min"] = round(len(g) / minutes, 2)
    return out


if __name__ == "__main__":
    outp, files = sys.argv[1], sys.argv[2:]
    done = set()
    if os.path.exists(outp):
        done = {json.loads(l)["file"] for l in open(outp) if l.strip()}
    with open(outp, "a") as fh:
        for p in files:
            if p in done:
                continue
            try:
                row = run(p)
            except Exception as ex:
                row = {"file": p, "error": repr(ex)}
            fh.write(json.dumps(row) + "\n")
            fh.flush()
