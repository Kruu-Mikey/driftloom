"""Decode Drive downloads into audio/<album>/<title>, choosing the album by
title (RULES below are Music Pile 2's; write new ones for each pile).

Usage: EARS_RESULTS=<tool-results folder> python3 -I sweep_rules.py
Unknown titles go to audio/_unsorted.
"""
import base64, glob, json, os, sys, re, shutil

# Where the session saved its Drive download results (one JSON per file).
RESULTS = os.environ.get("EARS_RESULTS") or sys.exit("Set EARS_RESULTS to the tool-results folder.")
# Audio and swept results land in the folder you run this from.
HERE = os.getcwd()

RULES = [
    (r"^Mike & Rich", "Mike & Rich - Expert Knob Twiddlers"),
    (r"^Death Grips - Fashion Week", "Death Grips - Fashion Week (Instrumentals)"),
    (r"^Blank Banshee", "Blank Banshee - Blank Banshee 0"),
    (r"^\d+\.The Field", "The Field - From Here We Go Sublime"),
    (r"^0\d - [A-Z ]+ - part", "Ryuichi Sakamoto - Thousand Knives"),
    (r"^0\d - (Port |Nautical|Biokinetics)", "Porter Ricks - Biokinetics"),
    (r"^\d\d (Intro|LFO|Simon From Sydney|Nurture|Freeze|We Are Back|Tan Ta Ra|You Have to Understand|El Ef Oh|Love Is the Message|Mentok|Think a Moment|Groovy Distortion|Track 14)", "LFO - Frequencies"),
    (r"^\d\d (Ljoss|Thor's Stone|Irby Tremor|Onward|The Weight of Gold|An Hour|Anneka|Gathering|The Plumes|Friend, You Will)", "Forest Swords - Engravings"),
    (r"^\d\d (New Colour|The Animal Pattern|As a Child|Lying in the Reeds|Dragon Blue Eyes|Crystal Caverns|Raindance|Dream Girl|Earth|Cthulhu|Stands Tidal|Spirals)", "Lone - Galaxy Garden"),
    (r"^\d\d (Kalpol|Bike|Autriche|Bronchus|Basscadet|Eggshell|Doctrine|Maetl|Windwind|Lowride|444)", "Autechre - Incunabula"),
    (r"^\d\d autechre - ", "Autechre - Amber"),
    (r"^\d\d (Boring Angel|Americans|He She|Inside World|Zebra|Along|Problem Areas|Cryo|Still Life|Chrome Country)", "Oneohtrix Point Never - R Plus Seven"),
]

swept = os.path.join(HERE, "swept")
os.makedirs(swept, exist_ok=True)
n = 0
for path in sorted(glob.glob(os.path.join(RESULTS, "mcp-Google_Drive-download_file_content-*.txt"))):
    with open(path) as f:
        d = json.load(f)
    title = d["title"].replace("/", "_")
    album = next((a for pat, a in RULES if re.search(pat, title)), "_unsorted")
    out = os.path.join(HERE, "audio", album)
    os.makedirs(out, exist_ok=True)
    data = base64.b64decode(d["content"])
    with open(os.path.join(out, title), "wb") as f:
        f.write(data)
    shutil.move(path, os.path.join(swept, os.path.basename(path)))
    n += 1
    print(f"{len(data):>9}  {album[:28]:28}  {title}")
print(f"{n} files")
