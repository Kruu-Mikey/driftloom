"""Measure audio files the same way, whether a record or a Driftloom loop.

Usage: python3 -I analyze.py OUT.jsonl FILE [FILE ...]
Appends one JSON object per file; skips files already in OUT.jsonl.

Every figure is about something a listener can hear:
  loudness      lufs, lra (EBU R128, from ffmpeg), crest
  tone          centroid (Hz), shares of energy by band, share 2-5 kHz
  space         width (side/mid, dB), tail (median decay after notes, dB/s)
  motion        onsets per second, tempo, pulse (how clear the beat is)
  pitch         tuning (cents off A440), wobble (cents, slow pitch drift
                on held notes), bends
  harmony       pitch classes active, chord changes per minute, bass hold
                (share of time the bass note stays put), major/minor lean
  form          repeat (how alike the music is to itself a few seconds
                later), drift10 / drift60 (how far the sound has moved
                after 10 s and 60 s), arc_db (slow loudness swell),
                sweep_oct (slow brightness movement, octaves)
"""
import json, os, subprocess, sys, re
import numpy as np
import librosa
import scipy.signal as sps

SR = 22050


def decode(path, sr, channels):
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-i", path, "-f", "f32le",
           "-ac", str(channels), "-ar", str(sr), "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype=np.float32)
    return x.reshape(-1, channels).T if channels > 1 else x


def ebur128(path):
    r = subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-i", path,
                        "-af", "ebur128=framelog=quiet", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
    tail = r[r.rfind("Summary:"):]
    i = re.search(r"I:\s+(-?[\d.]+) LUFS", tail)
    l = re.search(r"LRA:\s+(-?[\d.]+) LU", tail)
    return (float(i.group(1)) if i else None, float(l.group(1)) if l else None)


def db(x):
    return 10 * np.log10(np.maximum(x, 1e-12))


def analyze(path):
    out = {"file": path, "album": os.path.basename(os.path.dirname(path)),
           "track": os.path.basename(path)}
    stereo = decode(path, SR, 2)
    y = stereo.mean(axis=0).astype(np.float32)
    dur = len(y) / SR
    out["seconds"] = round(dur, 1)
    if dur < 8 or np.max(np.abs(y)) < 1e-4:
        out["skip"] = "too short or silent"
        return out

    out["lufs"], out["lra"] = ebur128(path)
    rms_all = np.sqrt(np.mean(y ** 2))
    out["crest_db"] = round(float(20 * np.log10(np.max(np.abs(y)) / max(rms_all, 1e-9))), 1)

    # --- tone -------------------------------------------------------------
    S = np.abs(librosa.stft(y, n_fft=4096, hop_length=1024)) ** 2
    freqs = librosa.fft_frequencies(sr=SR, n_fft=4096)
    frame_e = S.sum(axis=0)
    loud = frame_e > np.percentile(frame_e, 20)          # ignore near-silence
    spec = S[:, loud].sum(axis=1)
    total = spec.sum()
    bands = {"sub_lt120": (0, 120), "low_120_500": (120, 500),
             "mid_500_2k": (500, 2000), "pres_2k_5k": (2000, 5000),
             "air_gt5k": (5000, SR / 2)}
    for name, (lo, hi) in bands.items():
        out[name] = round(float(spec[(freqs >= lo) & (freqs < hi)].sum() / total), 4)
    cent = (freqs[:, None] * S).sum(axis=0) / np.maximum(S.sum(axis=0), 1e-12)
    out["centroid_hz"] = round(float(np.median(cent[loud])), 0)

    # slow brightness movement: centroid in octaves over sounding frames,
    # smoothed over ~3 s, intro and outro (first and last 10%) left out
    hop_s = 1024 / SR
    nfr = len(cent)
    core = np.zeros(nfr, bool)
    core[int(nfr * 0.1): int(nfr * 0.9)] = True
    oc = np.log2(np.maximum(cent[loud & core], 20))
    k = max(1, int(3 / hop_s))
    if len(oc) > k * 3:
        oc_s = np.convolve(oc, np.ones(k) / k, mode="valid")
        out["sweep_oct"] = round(float(np.percentile(oc_s, 90) - np.percentile(oc_s, 10)), 2)

    # --- space ------------------------------------------------------------
    mid = (stereo[0] + stereo[1]) / 2
    side = (stereo[0] - stereo[1]) / 2
    out["width_db"] = round(float(db(np.mean(side ** 2)) - db(np.mean(mid ** 2))), 1)

    # --- loudness over time -------------------------------------------------
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0]
    rdb = 20 * np.log10(np.maximum(rms, 1e-6))
    hop_r = 512 / SR
    k30 = int(30 / hop_r)
    mid_r = rdb[int(len(rdb) * 0.1): int(len(rdb) * 0.9)]
    if len(mid_r) > k30 * 2:
        smooth = np.convolve(mid_r, np.ones(k30) / k30, mode="valid")
        out["arc_db"] = round(float(np.percentile(smooth, 90) - np.percentile(smooth, 10)), 1)

    # --- onsets, tempo, pulse --------------------------------------------
    env = librosa.onset.onset_strength(y=y, sr=SR, hop_length=512)
    on = librosa.onset.onset_detect(onset_envelope=env, sr=SR, hop_length=512,
                                    backtrack=False, units="frames")
    out["onsets_per_s"] = round(len(on) / dur, 2)
    tempo = librosa.feature.tempo(onset_envelope=env, sr=SR, hop_length=512)
    out["tempo"] = round(float(np.atleast_1d(tempo)[0]), 1)
    ac = librosa.autocorrelate(env - env.mean(), max_size=int(4 / hop_r))
    ac = ac / max(ac[0], 1e-9)
    lo = int(0.25 / hop_r)
    out["pulse"] = round(float(np.max(ac[lo:])), 3)

    # tail: how fast sound dies after an isolated note (dB per second)
    slopes = []
    for f in on:
        nxt = on[on > f]
        gap = (nxt[0] - f) * hop_r if len(nxt) else dur - f * hop_r
        if gap < 0.8:
            continue
        seg = rdb[f: f + int(min(gap, 3.0) / hop_r)]
        if len(seg) < 10:
            continue
        p = int(np.argmax(seg[: max(3, len(seg) // 4)]))
        tail = seg[p:]
        if len(tail) < 8:
            continue
        t = np.arange(len(tail)) * hop_r
        slopes.append(np.polyfit(t, tail, 1)[0])
    out["tail_db_per_s"] = round(float(np.median(slopes)), 1) if len(slopes) >= 3 else None
    out["isolated_notes"] = len(slopes)

    # --- harmony -----------------------------------------------------------
    yh = librosa.effects.harmonic(y, margin=2.0)
    chroma = librosa.feature.chroma_cqt(y=yh, sr=SR, hop_length=2048)
    hop_c = 2048 / SR
    cn = chroma / np.maximum(chroma.max(axis=0, keepdims=True), 1e-9)
    act = (cn > 0.5).sum(axis=0)
    energetic = librosa.feature.rms(y=yh, frame_length=4096, hop_length=2048)[0]
    m = energetic[: chroma.shape[1]] > np.percentile(energetic, 25)
    out["pitch_classes"] = round(float(np.median(act[m[: len(act)]])) if m.any() else 0, 1)
    # chord changes: big jumps in 2-s averaged chroma
    k2 = max(1, int(2 / hop_c))
    nseg = chroma.shape[1] // k2
    if nseg > 3:
        seg = chroma[:, : nseg * k2].reshape(12, nseg, k2).mean(axis=2)
        seg = seg / np.maximum(np.linalg.norm(seg, axis=0, keepdims=True), 1e-9)
        sim = (seg[:, 1:] * seg[:, :-1]).sum(axis=0)
        out["chord_changes_per_min"] = round(float((sim < 0.85).sum() / (dur / 60)), 1)
    # key lean: Krumhansl profiles over the whole track
    maj = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    mnr = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
    cm = chroma.mean(axis=1)
    cmaj = max(np.corrcoef(np.roll(maj, i), cm)[0, 1] for i in range(12))
    cmin = max(np.corrcoef(np.roll(mnr, i), cm)[0, 1] for i in range(12))
    out["key_major_r"] = round(float(cmaj), 3)
    out["key_minor_r"] = round(float(cmin), 3)
    # bass hold: strongest pitch class below ~260 Hz, how long it stays put
    Cb = np.abs(librosa.cqt(yh, sr=SR, hop_length=2048, fmin=librosa.note_to_hz("C1"),
                            n_bins=36, bins_per_octave=12))
    bass_pc = Cb.argmax(axis=0) % 12
    bmask = Cb.max(axis=0) > np.percentile(Cb.max(axis=0), 30)
    if bmask.sum() > 20:
        b = bass_pc[bmask]
        vals, counts = np.unique(b, return_counts=True)
        out["bass_hold"] = round(float(counts.max() / len(b)), 3)
        # bass note per ~1 s (mode of each window), so flicker isn't counted
        kb = max(1, int(1 / (2048 / SR)))
        nb = len(b) // kb
        if nb > 3:
            per = [np.bincount(b[i * kb:(i + 1) * kb], minlength=12).argmax() for i in range(nb)]
            changes = int((np.diff(per) != 0).sum())
            out["bass_changes_per_min"] = round(float(changes / (len(b) * 2048 / SR / 60)), 1)

    # tuning offset
    out["tuning_cents"] = round(float(librosa.estimate_tuning(y=yh, sr=SR) * 100), 1)

    # --- pitch wobble and bends on held partials (works with chords) --------
    # Track spectral peaks 150-2500 Hz frame to frame; a partial held for at
    # least 0.5 s gives one wobble figure (std of its pitch around its own
    # straight-line trend, in cents) and counts as a bend if it glides more
    # than 50 cents end to end.
    hop_p = 1024
    P = np.abs(librosa.stft(yh, n_fft=8192, hop_length=hop_p))
    fr = librosa.fft_frequencies(sr=SR, n_fft=8192)
    lo_b, hi_b = np.searchsorted(fr, 150), np.searchsorted(fr, 2500)
    L = np.log(np.maximum(P[lo_b - 1: hi_b + 1], 1e-9))
    tracks, live = [], []
    min_len = int(0.5 * SR / hop_p)
    for t in range(P.shape[1]):
        col = L[:, t]
        pk = np.where((col[1:-1] > col[:-2]) & (col[1:-1] > col[2:]))[0] + 1
        if len(pk) == 0:
            cents_now = np.array([])
        else:
            pk = pk[col[pk] > col.max() - 3.5]          # within ~30 dB of the top
            pk = pk[np.argsort(col[pk])[::-1][:8]]
            a_, b_, c_ = col[pk - 1], col[pk], col[pk + 1]
            off = 0.5 * (a_ - c_) / np.where(a_ - 2 * b_ + c_ == 0, -1e-9, a_ - 2 * b_ + c_)
            f = (lo_b - 1 + pk + off) * SR / 8192
            cents_now = 1200 * np.log2(f / 440.0)
        used = set()
        nxt = []
        for tr in live:
            if len(cents_now):
                d = np.abs(cents_now - tr[-1])
                j = int(np.argmin(d))
                if d[j] < 30 and j not in used:
                    used.add(j)
                    tr.append(cents_now[j])
                    nxt.append(tr)
                    continue
            if len(tr) >= min_len:
                tracks.append(tr)
        for j, c in enumerate(cents_now):
            if j not in used:
                nxt.append([c])
        live = nxt
    tracks += [tr for tr in live if len(tr) >= min_len]
    # Long partials are judged in 3-s pieces, so a slow wow isn't mistaken
    # for a trend and one long drone doesn't count as one sample.
    wob, bends, pieces = [], 0, 0
    chunk = int(3 * SR / hop_p)
    for tr in tracks:
        r_all = np.array(tr)
        for s in range(0, len(r_all), chunk):
            r = r_all[s: s + chunk]
            if len(r) < min_len:
                continue
            pieces += 1
            x = np.arange(len(r))
            fit = np.polyfit(x, r, 1)
            wob.append(np.std(r - np.polyval(fit, x)))
            secs = len(r) * hop_p / SR
            glide = abs(fit[0] * (len(r) - 1))
            if glide > 40 and glide / secs > 30:
                bends += 1
    out["held_partials"] = len(tracks)
    out["wobble_cents"] = round(float(np.median(wob)), 2) if len(wob) >= 3 else None
    out["bends_per_min"] = round(bends / (dur / 60), 2)
    out["bend_share"] = round(bends / pieces, 3) if pieces else None

    # --- form: repetition and drift -----------------------------------------
    mf = librosa.feature.mfcc(y=y, sr=SR, n_mfcc=13, hop_length=2048)
    feat = np.vstack([mf[1:], chroma[:, : mf.shape[1]] * 10])
    feat = (feat - feat.mean(axis=1, keepdims=True)) / np.maximum(feat.std(axis=1, keepdims=True), 1e-9)
    hop_f = 2048 / SR
    # repeat: best correlation of the feature sequence with itself 1-16 s later
    best = 0.0
    n = feat.shape[1]
    for lag in range(int(1 / hop_f), min(int(16 / hop_f), n // 2)):
        a1, b1 = feat[:, :-lag].ravel(), feat[:, lag:].ravel()
        r = np.corrcoef(a1, b1)[0, 1]
        best = max(best, r)
    out["repeat"] = round(float(best), 3)
    # drift: distance between 5-s means at 10 s and 60 s apart
    w = int(5 / hop_f)
    nw = n // w
    if nw >= 14:
        M = feat[:, : nw * w].reshape(feat.shape[0], nw, w).mean(axis=2)
        def dist(lag):
            return float(np.mean(np.linalg.norm(M[:, lag:] - M[:, :-lag], axis=0)))
        out["drift10"] = round(dist(2), 2)
        out["drift60"] = round(dist(12), 2)
    return out


def main():
    outp, files = sys.argv[1], sys.argv[2:]
    done = set()
    if os.path.exists(outp):
        for line in open(outp):
            try:
                done.add(json.loads(line)["file"])
            except Exception:
                pass
    for p in files:
        if p in done:
            continue
        try:
            row = analyze(p)
        except Exception as e:
            row = {"file": p, "error": repr(e)}
        with open(outp, "a") as f:
            f.write(json.dumps(row) + "\n")
        print(row.get("track"), "ok" if "error" not in row else row["error"], flush=True)


if __name__ == "__main__":
    main()
