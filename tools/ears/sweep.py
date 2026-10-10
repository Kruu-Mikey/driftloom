"""Decode newly downloaded Drive files into audio/<album>/<title>.

Usage: python3 -I sweep.py "<album folder name>"
Takes every Drive download result in the tool-results directory that has
not been swept yet, writes the audio, and moves the JSON to swept/.
"""
import base64, glob, json, os, shutil, sys

# Where the session saved its Drive download results (one JSON per file).
RESULTS = os.environ.get("EARS_RESULTS") or sys.exit("Set EARS_RESULTS to the tool-results folder.")
# Audio and swept results land in the folder you run this from.
HERE = os.getcwd()
album = sys.argv[1]
out = os.path.join(HERE, "audio", album)
os.makedirs(out, exist_ok=True)
swept = os.path.join(HERE, "swept")
os.makedirs(swept, exist_ok=True)

n = 0
for path in sorted(glob.glob(os.path.join(RESULTS, "mcp-Google_Drive-download_file_content-*.txt"))):
    with open(path) as f:
        d = json.load(f)
    data = base64.b64decode(d["content"])
    title = d["title"].replace("/", "_")
    with open(os.path.join(out, title), "wb") as f:
        f.write(data)
    shutil.move(path, os.path.join(swept, os.path.basename(path)))
    n += 1
    print(f"{len(data):>9}  {title}")
print(f"{n} files -> {out}")
