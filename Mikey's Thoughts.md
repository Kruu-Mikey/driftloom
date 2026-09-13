# Mikey's original notes

All four of these are done. Kept as a record of where the work started, and
of where each one landed, because in every case the cause turned out to be
more interesting than the symptom.

**"Need a way to go back a few loops."**
Done. Previous/next walk the loop history, and while an album is playing they
walk the album instead. A re-roll is treated as a revision of the current
loop rather than a new entry, so Previous reaches the loop before it rather
than stepping back through your own rolls.

**"Implement bluetooth button controls."**
Done, but not the way it was first attempted. The first try listened for
`MediaPlayPause` keyboard events, which Bluetooth devices on Android never
send. The second try routed audio through a `MediaStreamAudioDestinationNode`,
which on Chrome for Android is the one approach guaranteed *not* to work:
stream-backed elements are classed as communications audio, like a phone
call, and are deliberately excluded from media notifications. What works is
playing a real encoded file alongside the music, long enough not to be
treated as a sound effect (over five seconds) and loud enough not to be
judged silent. See `audio/keepalive.flac` and the README.

**"Background playing... occasionally it will stop working."**
Done, and there were two separate causes. Backgrounded pages have their
timers clamped to roughly 1Hz, so the scheduler ran dry between wake-ups;
ticks now come from a Web Worker and the lookahead widens to 3s while hidden.
Separately, voice release tracking used `setTimeout`, so under that same
clamping the budget stayed full and notes were dropped silently. Releases now
track the audio clock instead.

**"Restore doesn't seem to be able to select .rtx files."**
Done. `accept="application/json"` was hiding backups from Android's picker;
the filter is gone. There is also a clipboard route now that avoids the file
system entirely, which is the one to reach for if the picker misbehaves.

Everything still outstanding lives in `ROADMAP.md`.
