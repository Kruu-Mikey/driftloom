"""Second pass: finer energy bands, and chord density above the bass.

Usage: python3 -I extra.py OUT.jsonl FILE [FILE ...]
"""
import json, os, subprocess, sys
import numpy as np
import librosa

SR = 22050
EDGES = [(0, 40), (40, 60), (60, 120), (120, 250), (250, 1000), (1000, 2000), (2000, 5000), (5000, 11025)]


def decode(path):
    raw = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", path, "-f", "f32le",
                          "-ac", "1", "-ar", str(SR), "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32)


def run(path):
    y = decode(path)
    out = {"file": path, "album": os.path.basename(os.path.dirname(path)), "track": os.path.basename(path),
           "seconds": round(len(y) / SR, 1)}
    if len(y) < SR * 8:
        out["skip"] = 1
        return out
    S = np.abs(librosa.stft(y, n_fft=8192, hop_length=2048)) ** 2
    f = librosa.fft_frequencies(sr=SR, n_fft=8192)
    e = S.sum(axis=0)
    loud = e > np.percentile(e, 20)
    s = S[:, loud].sum(axis=1)
    s = s / s.sum()
    for lo, hi in EDGES:
        out[f"b{lo}_{hi}"] = round(float(s[(f >= lo) & (f < hi)].sum()), 4)
    # Chord density above the bass: chroma from 200-2000 Hz only, pitch
    # classes within 6 dB of the strongest, in sounding frames.
    yh = librosa.effects.harmonic(y, margin=2.0)
    C = np.abs(librosa.cqt(yh, sr=SR, hop_length=2048, fmin=librosa.note_to_hz("G3"),
                           n_bins=36, bins_per_octave=12)) ** 2
    chroma = np.zeros((12, C.shape[1]))
    for b in range(36):
        chroma[(b + 7) % 12] += C[b]            # G3 is pitch class 7
    ce = chroma.sum(axis=0)
    m = ce > np.percentile(ce, 30)
    cn = chroma[:, m] / np.maximum(chroma[:, m].max(axis=0, keepdims=True), 1e-12)
    out["upper_pcs"] = round(float(np.median((cn > 0.25).sum(axis=0))), 1) if m.any() else None
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
