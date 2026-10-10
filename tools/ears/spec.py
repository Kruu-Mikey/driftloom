"""Draw a 60-s spectrogram (log frequency, 30 Hz-8 kHz) for looking at by eye.

Usage: python3 -I spec.py START_SECONDS OUT.png FILE
"""
import subprocess, sys
import numpy as np
import librosa
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

start, outp, path = float(sys.argv[1]), sys.argv[2], sys.argv[3]
SR = 22050
raw = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-ss", str(start), "-t", "60", "-i", path,
                      "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"], capture_output=True, check=True).stdout
y = np.frombuffer(raw, np.float32)
S = librosa.amplitude_to_db(np.abs(librosa.stft(y, n_fft=4096, hop_length=512)), ref=np.max)
f = librosa.fft_frequencies(sr=SR, n_fft=4096)
t = np.arange(S.shape[1]) * 512 / SR
keep = (f >= 30) & (f <= 8000)
fig, ax = plt.subplots(figsize=(12, 5), dpi=90)
ax.pcolormesh(t, f[keep], S[keep], shading="auto", vmin=-80, vmax=0, cmap="magma")
ax.set_yscale("log")
ax.set_yticks([40, 60, 120, 250, 500, 1000, 2000, 4000, 8000])
ax.set_yticklabels(["40", "60", "120", "250", "500", "1k", "2k", "4k", "8k"])
ax.set_xlabel(f"seconds from {start:.0f}")
ax.set_title(path.split("/")[-1][:80])
fig.tight_layout()
fig.savefig(outp)
