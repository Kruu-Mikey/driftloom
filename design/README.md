# Driftloom UI mockups: start here

This folder is the **UI mockup / design spec** for the one-screen phone app. It is not part of the app: `.assetsignore` keeps it off the live site. The detailed record of every decision lives inside the HTML file; this note tells you where to find it.

## What this is

One self-contained HTML file showing the same phone screen in nine color themes, plus a spec sheet and handover notes. Open it in any browser; no build step.

- **Current file:** `driftloom_v16_light_themes.html`.
- **State:** the 12-session platform-compliance roadmap is complete (WCAG 2.2 AA, iOS HIG, Material 3). v15 was a design pass from Mikey; v16 (Painter session 2) reworked the light themes. The design is **not locked yet**; Mikey reviews each version by eye.
- **Relation to PR #153:** #153 (the first one-screen UI, Painter session 1) stays open on purpose until this new UI is finished and brought into the app.

## Where things are in the HTML

1. **The HTML comment at the very top** is the main handover. Read it in this order:
   - the **v16 · LIGHT THEMES** block (newest work);
   - the **v15 · DESIGN PASS** block;
   - **WHAT SESSIONS 6–12 CHANGED**, including the Session 12 independent review;
   - the v13 / Session 5 block (text sizing);
   - earlier sessions;
   - **WHAT NOT TO DO** (hard rules) and **EDITING NOTES** (where each CSS and script block lives).
2. **Visible "handover" sections** on the page: one per session, in plain English, plus the roadmap.
3. **Spec tables:** every measurement a theme must honor.
4. **Gallery controls** above the phones: text size 100–200%, insets (iPhone, Android, or this device), touch-target outlines, simulate reduced motion, and a live audit line that re-measures all nine phones.

## Rules that must not break (short list; the full list is in the file)

- **Locked skeleton.** Zones are Info 205px, Dynamic ~319px and Buttons 240px, in a 780px content area. Nothing scrolls inside the phone and nothing pops up. The zones never change height with text size.
- **One behavior for everybody.** No user-facing modes, toggles or settings in the app. The gallery's review controls are not part of the app.
- **Numbers stay with their words.** Use U+00A0 no-break spaces ("47%&nbsp;Glade").
- **Nothing in the Info card is ever dropped.** Lines that don't fit take turns in shared slots, with no animation, and the turning holds still while paused, hovered, focused, and for the rest of a loop once the user turns it by hand (the WCAG 2.2.2 mechanism).
- **Text sizes.** All text is 11px or larger and uses rem (the status bar excepted). The track name never goes below 28px except as a last resort, and is never cut.
- **Every control is a native `<button>`** with a name. On/off is a `role="switch"`. Play swaps its name between Play and Pause and has no `aria-pressed`.
- **Contrast is measured from pixels.** Text 4.5:1. Notes, beat cells, the lit playhead cell and focus rings 3:1. Off-beat playhead cells and empty-slot dots are deliberately quiet and treated as decorative.
- **Light-theme notes (v16):** keep their chroma; never darken them toward brown or gray to pass. Alternate light rows (~3.6:1) with deep rows (~5–6:1) and re-run the color-blind check after any change. Olive stays inside its swatch's family.
- **Reduced motion means nothing moves.** Every mark drawn as a background color needs a forced-colors rule.
- **Touch targets.** roll and on/off are drawn at 48×48. No invisible hit pads.

## How to verify (the test kit)

`test-kit/` holds the Playwright scripts behind every number in the handover.

```
cd design/test-kit
npm install
npx playwright install chromium
./run_all.sh ../driftloom_v16_light_themes.html
python3 cvd_check.py ../driftloom_v16_light_themes.html out/nontext_allon.json
```

Compare with `expected_output_v16.txt`. Gotchas:

- **Screenshots far down the page come back wrong** at deviceScaleFactor 2 (more than ~8000 CSS px down). The scripts hide the handover and spec sections first (`SHALLOW=1`); for Nocturne, Abyss and Olive the lit-cell numbers are only valid from the `HIDEFIRST=1` run.
- **Load real fonts.** The scripts swap in local Inter and Space Grotesk via @fontsource and block every other network request.
- **Pre-installed Chromium:** if the sandbox already has a Chromium build, pin `playwright` to the matching version rather than downloading browsers.
- **Only Chromium has been tested.** Safari, Firefox and a real screen reader wait until the design is locked.

## Reference images (`reference/`)

- `v16_all_nine_themes_100pct.png`: all nine phones at default text size.
- `v16_colorblind_check.png`: the four light themes under typical vision, protanopia, deuteranopia, tritanopia and grayscale.
- `v16_forced_colours_light.png`: Windows light contrast theme.

## How Mikey likes to work

- **American English** in chat, docs and code comments.
- **One focused step per session.** Verify it against the standard, update the handover in the HTML, and bump the version (v16 → v17 …).
- **When proposing the next session, give four things:** new or continuing session, which model, what effort, and the session label (e.g. "Painter 3 · Now Playing view").
- **Mikey judges the design by eye.** Show changes as screenshots or contact sheets, and measure every compliance claim.
- **Use an independent reviewer.** An agent that hasn't seen the work catches over-claims.

## Open items

1. **Mikey reviews v16 by eye**, including one decision: Olive's in-family notes gain little pop; a brighter wine-and-rust set exists but breaks the "stay inside the swatch's family" rule.
2. **Next build: the Now Playing view.** The Dynamic zone shows only the Layers view; Library, Sound and Now Playing are unbuilt.
3. **Six buttons are named and focusable but inert:** Previous, Next, Library, Save/Share, Now playing and Sound.
4. **After the design is locked:** test Safari, Firefox, VoiceOver and TalkBack, then bring the UI into the app (superseding PR #153).
