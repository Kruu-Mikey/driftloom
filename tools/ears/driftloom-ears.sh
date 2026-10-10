#!/usr/bin/env bash
# driftloom-ears.sh -- get albums ready for Claude to pull from Google Drive.
#
# One pass does everything: unzips (zips inside zips too), turns every
# track into a 96 kbps stereo Opus file, and cuts anything longer than
# 5 minutes into 4-minute pieces, so every file stays under the 5.5 MB
# that Claude's Drive link carries. Any format works: flac, mp3, m4a,
# ogg, opus, wav, aiff, wv, ape, wma.
#
# Usage:
#   ./driftloom-ears.sh  ZIP_OR_FOLDER_OR_FILE  [more ...]
#
# Example:
#   ./driftloom-ears.sh ~/Downloads/"Music Pile 2.zip"
#
# Results land in a folder named after the first thing you give it, like
# ./for-claude - Music Pile 2/<Album>/... Drag that whole folder into the
# Driftloom folder on Google Drive. Running it again skips finished tracks.

set -euo pipefail

BITRATE="${BITRATE:-96k}"
PART_SECONDS="${PART_SECONDS:-240}"
CUT_OVER="${CUT_OVER:-300}"
LIMIT_BYTES=$((5500 * 1024))
AUDIO_RE='\.(flac|mp3|m4a|m4b|aac|alac|ogg|oga|opus|wav|aif|aiff|wv|ape|wma)$'

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing $1. On Fedora: sudo dnf install $2"; exit 1; }; }
need ffmpeg ffmpeg-free
need ffprobe ffmpeg-free
need unzip unzip

[ "$#" -ge 1 ] || { sed -n '2,20p' "$0"; exit 1; }
first="$(basename "${1%/}")"
OUT="${OUT:-$PWD/for-claude - ${first%.zip}}"

mkdir -p "$OUT"
# Work space next to the output, not /tmp: on Fedora /tmp lives in RAM,
# and a 3 GB zip would fill it.
WORK="$(mktemp -d "$PWD/.ears-work.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

done_count=0; skip_count=0; split_count=0; fail_count=0

clean() { printf '%s' "$1" | sed 's#[/\\:*?"<>|]#_#g; s/^ *//; s/ *$//'; }

convert_one() {
  local src="$1" album="$2"
  local base dir dur
  base="$(clean "$(basename "${src%.*}")")"
  dir="$OUT/$(clean "$album")"
  mkdir -p "$dir"

  if compgen -G "$dir/$base*.opus" >/dev/null; then
    skip_count=$((skip_count + 1)); return
  fi

  dur="$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$src" 2>/dev/null | cut -d. -f1)"
  dur="${dur:-0}"

  if [ "$dur" -gt "$CUT_OVER" ]; then
    echo "  $album / $base  ($((dur / 60)) min, cutting into parts)"
    if ffmpeg -nostdin -hide_banner -v error -i "$src" -map 0:a:0 -vn \
         -c:a libopus -b:a "$BITRATE" \
         -f segment -segment_time "$PART_SECONDS" -reset_timestamps 1 \
         "$dir/$base - part%02d.opus"; then
      split_count=$((split_count + 1)); done_count=$((done_count + 1))
    else
      echo "    FAILED"; fail_count=$((fail_count + 1))
    fi
  else
    echo "  $album / $base"
    if ffmpeg -nostdin -hide_banner -v error -i "$src" -map 0:a:0 -vn \
         -c:a libopus -b:a "$BITRATE" "$dir/$base.opus"; then
      done_count=$((done_count + 1))
    else
      echo "    FAILED"; fail_count=$((fail_count + 1))
    fi
  fi
}

# Every audio file under ROOT. The album name comes from the folders it
# sits in ("Harmonia/Musik von Harmonia" -> "Harmonia - Musik von Harmonia"),
# or from ROOT's own name when the tracks sit at the top.
convert_tree() {
  local root="$1" rootname="$2" f parent rel album
  while IFS= read -r -d '' f; do
    parent="$(dirname "$f")"
    if [ "$parent" = "$root" ]; then
      album="$rootname"
    else
      rel="${parent#"$root"/}"
      album="${rel//\// - }"
    fi
    convert_one "$f" "$album"
  done < <(find "$root" -type f -regextype posix-extended -iregex ".*$AUDIO_RE" -print0 | sort -z)
}

for input in "$@"; do
  if [ -d "$input" ]; then
    echo "Folder: $input"
    convert_tree "$(cd "$input" && pwd)" "$(basename "$input")"
  elif [ -f "$input" ] && [[ "${input,,}" == *.zip ]]; then
    echo "Zip: $input (unpacking)"
    name="$(basename "${input%.*}")"
    mkdir -p "$WORK/$name"
    unzip -q -o "$input" -d "$WORK/$name"
    # Zips inside the zip: unpack each where it sits (a zip holding one
    # folder unpacks without an extra level), until none are left.
    while [ -n "$(find "$WORK/$name" -type f -iname '*.zip' -print -quit)" ]; do
      while IFS= read -r -d '' z; do
        d="${z%.*}"; unzip -q -o "$z" -d "$d" && rm -f "$z"
        inner=("$d"/*)
        if [ "${#inner[@]}" -eq 1 ] && [ -d "${inner[0]}" ]; then
          mv "${inner[0]}"/* "$d"/ 2>/dev/null; rmdir "${inner[0]}" 2>/dev/null || true
        fi
      done < <(find "$WORK/$name" -type f -iname '*.zip' -print0)
    done
    root="$WORK/$name"
    # A zip holding one folder: start inside it, so album names stay short.
    entries=("$root"/*)
    if [ "${#entries[@]}" -eq 1 ] && [ -d "${entries[0]}" ]; then
      root="${entries[0]}"; name="$(basename "$root")"
    fi
    convert_tree "$root" "$name"
    rm -rf "${WORK:?}/$name"
  elif [ -f "$input" ] && [[ "${input,,}" =~ $AUDIO_RE ]]; then
    echo "File: $input"
    convert_one "$input" "$(basename "${input%.*}")"
  else
    echo "Skipping (not a folder, zip or audio file): $input"
  fi
done

echo
echo "Done: $done_count tracks ($split_count cut into parts), $skip_count already done, $fail_count failed."

# Cutting can leave a tail of a second or less; drop those.
find "$OUT" -type f -name '*.opus' -size -20k -delete
# Safety net: anything still over the limit (a very dense track) is cut
# again, without re-encoding.
while IFS= read -r -d '' f; do
  echo "  re-cutting (still too big): $(basename "$f")"
  ffmpeg -nostdin -hide_banner -v error -i "$f" -map 0:a:0 -c copy \
    -f segment -segment_time 120 -reset_timestamps 1 "${f%.opus} - piece%02d.opus" && rm -f "$f"
done < <(find "$OUT" -type f -name '*.opus' -size +"${LIMIT_BYTES}"c -print0)
big="$(find "$OUT" -type f -name '*.opus' -size +"${LIMIT_BYTES}"c)"
[ -z "$big" ] || { echo "Still over the limit; tell Claude which ones:"; echo "$big"; }
echo "Total size: $(du -sh "$OUT" | cut -f1)  in  $OUT"
echo "Upload that whole folder to the Driftloom folder in Google Drive."
