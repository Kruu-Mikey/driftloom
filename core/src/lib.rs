//! Driftloom's audio core: the synth's voices, in Rust.
//!
//! It knows nothing about browsers. A host owns a `Core`, hands it notes as
//! they are decided, and asks it for one block of samples at a time per
//! output channel. The web app's host is an AudioWorklet (`js/worklet.js`,
//! through the WebAssembly exports in `wasm.rs`); a native or game host
//! would wrap the same three calls.
//!
//! Everything is allocated up front: a fixed pool of voices, fixed-size
//! automation, fixed output buffers. Nothing allocates after `Core::new`,
//! and nothing reachable from `process` can panic.
//!
//! The JavaScript synth is the reference. A ported voice is proven against
//! it by rendering the same notes through both and subtracting
//! (`tools/measure.mjs --null`), which is why the building blocks follow
//! Web Audio -- and, where Chromium's rendering differs from a plain
//! reading of the spec, Chromium -- to the sample.

pub mod osc;
pub mod param;
pub mod voice;

#[cfg(target_arch = "wasm32")]
mod wasm;

use voice::Kalimba;

/// Web Audio's render quantum. The core renders in blocks of this many
/// frames, on frame numbers that are multiples of it, as an AudioWorklet
/// is called; a host with another block size buffers.
pub const QUANTUM: usize = 128;

/// The channels the core plays into, in the order of its outputs. Each is
/// one of the synth's per-layer channels, so a note from here takes the
/// same echo, reverb, ducking and master chain as one built in JavaScript.
pub const CHANNELS: usize = 2;
pub const MELODY: u32 = 0;
pub const CHORDS: u32 = 1;

/// Voices sounding at once. The JavaScript voice budget decides what plays,
/// and it cannot fill this: its whole ceiling is 260 units and the cheapest
/// kalimba part costs 3, so at most 86 notes are ever billed at once,
/// against 256 voices. A note that starts with every voice busy is dropped,
/// and counted (`Core::dropped`).
pub const POOL: usize = 256;

/// Notes waiting for their start time. A note takes a voice only when it
/// starts, so a host may hand notes over well ahead: the app's lookahead is
/// at most three seconds, and the measure harness hands over a whole
/// seventy-second render before it starts -- about a thousand notes on the
/// busiest kalimba loop. A note that arrives with the queue full is
/// dropped, and counted. All zeros until used, like the voices, so neither
/// costs anything in the `.wasm`.
pub const QUEUE: usize = 4096;

/// What the core says to a note.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Taken {
    /// Queued for its start time.
    OnTime = 0,
    /// Its start time had already been rendered, so it starts now.
    Late = 1,
    /// The queue of waiting notes is full. Dropped.
    Full = 2,
    /// Not a channel or a voice the core has. Dropped.
    Unknown = 3,
}

/// The voices the core can play, by number.
pub const KALIMBA: u32 = 0;

struct Slot {
    busy: bool,
    channel: usize,
    begin: u64,
    end: u64,
    kalimba: Kalimba,
}

impl Slot {
    const fn new() -> Self {
        Slot {
            busy: false,
            channel: 0,
            begin: 0,
            end: 0,
            kalimba: Kalimba::new(),
        }
    }
}

/// A note waiting for its start.
#[derive(Clone, Copy)]
struct Waiting {
    channel: u32,
    start: u64,
    time: f64,
    midi: f64,
    dur: f64,
    vel: f64,
    parts: u32,
}

const NOTHING: Waiting = Waiting {
    channel: 0,
    start: 0,
    time: 0.0,
    midi: 0.0,
    dur: 0.0,
    vel: 0.0,
    parts: 0,
};

pub struct Core {
    rate: f64,
    /// The first frame of the next block to render.
    next: u64,
    slots: [Slot; POOL],
    queue: [Waiting; QUEUE],
    waiting: usize,
    out: [[f32; QUANTUM]; CHANNELS],
    late: u32,
    dropped: u32,
}

impl Core {
    /// An empty core. `const` and all zeros, so a host can keep one in a
    /// static without building it on the stack.
    pub const fn new() -> Self {
        const FREE: Slot = Slot::new();
        Core {
            rate: 0.0,
            next: 0,
            slots: [FREE; POOL],
            queue: [NOTHING; QUEUE],
            waiting: 0,
            out: [[0.0; QUANTUM]; CHANNELS],
            late: 0,
            dropped: 0,
        }
    }

    /// Set the sample rate and clear everything. Call before the first
    /// note.
    pub fn init(&mut self, rate: f64) {
        self.rate = rate;
        self.next = 0;
        self.late = 0;
        self.dropped = 0;
        self.clear();
    }

    /// Let every voice go at once, sounding or waiting: the host is going
    /// away.
    pub fn clear(&mut self) {
        self.waiting = 0;
        for slot in self.slots.iter_mut() {
            slot.busy = false;
        }
    }

    /// Notes that arrived after their start time had been rendered.
    pub fn late(&self) -> u32 {
        self.late
    }

    /// Notes dropped: the queue was full when they arrived, or every voice
    /// was busy when they started.
    pub fn dropped(&self) -> u32 {
        self.dropped
    }

    /// Notes sounding or waiting to.
    pub fn busy(&self) -> usize {
        self.waiting + self.slots.iter().filter(|s| s.busy).count()
    }

    /// A note: `voice` (KALIMBA), into `channel` (MELODY or CHORDS), at
    /// `time` seconds on the host's clock, with the voice's own `parts`.
    /// A note whose start has already been rendered starts at once: the
    /// whole of it, from its first sample, at the start of the next block.
    #[allow(clippy::too_many_arguments)]
    pub fn note(
        &mut self,
        voice: u32,
        channel: u32,
        time: f64,
        midi: f64,
        dur: f64,
        vel: f64,
        parts: u32,
    ) -> Taken {
        if voice != KALIMBA
            || channel as usize >= CHANNELS
            || !(time.is_finite() && dur.is_finite())
        {
            return Taken::Unknown;
        }
        let rate = self.rate;
        let mut time = time;
        let mut taken = Taken::OnTime;
        if osc::frame_at(time, rate) < self.next {
            time = self.next as f64 / rate;
            taken = Taken::Late;
            self.late = self.late.saturating_add(1);
        }
        let Some(gap) = self.queue.get_mut(self.waiting) else {
            self.dropped = self.dropped.saturating_add(1);
            return Taken::Full;
        };
        *gap = Waiting {
            channel,
            start: osc::frame_at(time, rate),
            time,
            midi,
            dur,
            vel,
            parts,
        };
        self.waiting += 1;
        taken
    }

    // A waiting note's start has come: give it a voice.
    fn start(&mut self, w: Waiting) {
        let Some(slot) = self.slots.iter_mut().find(|s| !s.busy) else {
            self.dropped = self.dropped.saturating_add(1);
            return;
        };
        slot.kalimba
            .play(w.midi, w.time, w.dur, w.vel, w.parts, self.rate);
        slot.channel = w.channel as usize;
        slot.begin = slot.kalimba.start_frame();
        slot.end = slot.kalimba.end_frame();
        slot.busy = slot.end > slot.begin;
    }

    /// Render the block of `QUANTUM` frames that starts at frame `block`
    /// (a multiple of `QUANTUM`; blocks come in order), into the output
    /// buffers, and return them, one per channel.
    pub fn process(&mut self, block: u64) -> &[[f32; QUANTUM]; CHANNELS] {
        let end = block + QUANTUM as u64;
        self.next = end;
        for ch in self.out.iter_mut() {
            ch.fill(0.0);
        }
        // Notes starting in this block take their voices. The queue is not
        // kept in order: the last waiting note fills the gap each leaves.
        let mut i = 0;
        while i < self.waiting {
            let Some(&w) = self.queue.get(i) else { break };
            if w.start >= end {
                i += 1;
                continue;
            }
            self.waiting -= 1;
            if let Some(&last) = self.queue.get(self.waiting)
                && let Some(gap) = self.queue.get_mut(i)
            {
                *gap = last;
            }
            self.start(w);
        }
        let rate = self.rate;
        for slot in self.slots.iter_mut().filter(|s| s.busy) {
            if slot.begin >= end {
                continue;
            }
            if let Some(out) = self.out.get_mut(slot.channel) {
                slot.kalimba.render(block, rate, out);
            }
            if slot.end <= end {
                slot.busy = false;
            }
        }
        &self.out
    }
}

impl Default for Core {
    fn default() -> Self {
        Core::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use voice::{BODY, STRIKE};

    const RATE: f64 = 44100.0;

    fn render(core: &mut Core, blocks: usize) -> Vec<[f32; QUANTUM]> {
        let mut melody = Vec::new();
        for b in 0..blocks {
            let out = core.process((b * QUANTUM) as u64);
            melody.push(out[0]);
        }
        melody
    }

    fn boxed() -> Box<Core> {
        let mut core = Box::new(Core::new());
        core.init(RATE);
        core
    }

    #[test]
    fn a_kalimba_note_sounds_then_lets_its_voice_go() {
        let mut core = boxed();
        assert_eq!(
            core.note(KALIMBA, MELODY, 0.1, 69.0, 0.4, 0.8, STRIKE | BODY),
            Taken::OnTime
        );
        assert_eq!(core.busy(), 1);
        assert!(
            core.slots.iter().all(|s| !s.busy),
            "a voice before its start"
        );
        let blocks = render(&mut core, (2.0 * RATE) as usize / QUANTUM);
        let peak = blocks.iter().flatten().fold(0.0f32, |a, &b| a.max(b.abs()));
        assert!(peak > 0.1 && peak < 0.3, "peak {peak}");
        // 0.4 s note, released 1.2 s after: gone by 1.71 s.
        assert_eq!(core.busy(), 0);
        let first = (0.1 * RATE).ceil() as usize;
        assert!(blocks.iter().flatten().take(first).all(|&x| x == 0.0));
    }

    #[test]
    fn the_same_notes_render_the_same_samples() {
        let mut a = boxed();
        let mut b = boxed();
        for core in [&mut a, &mut b] {
            core.note(KALIMBA, MELODY, 0.0123, 72.0, 0.3, 0.6, STRIKE | BODY);
            core.note(KALIMBA, MELODY, 0.2001, 64.0, 1.5, 0.5, STRIKE);
        }
        assert_eq!(render(&mut a, 400), render(&mut b, 400));
    }

    #[test]
    fn parts_the_budget_refused_stay_silent() {
        let mut both = boxed();
        let mut body = boxed();
        both.note(KALIMBA, CHORDS, 0.05, 60.0, 0.5, 0.7, STRIKE | BODY);
        body.note(KALIMBA, CHORDS, 0.05, 60.0, 0.5, 0.7, BODY);
        let chords = |core: &mut Core| -> f32 {
            let mut e = 0.0;
            for b in 0..200 {
                e += core.process((b * QUANTUM) as u64)[1]
                    .iter()
                    .map(|x| x * x)
                    .sum::<f32>();
            }
            e
        };
        assert!(chords(&mut both) > chords(&mut body) * 2.0);
        assert_eq!(body.busy(), 0);
    }

    #[test]
    fn a_late_note_starts_at_once_and_is_counted() {
        let mut core = boxed();
        render(&mut core, 10);
        assert_eq!(
            core.note(KALIMBA, MELODY, 0.001, 69.0, 0.2, 0.8, STRIKE),
            Taken::Late
        );
        assert_eq!(core.late(), 1);
        let out = core.process(10 * QUANTUM as u64);
        // sin(0) at the first frame, then sounding.
        assert_eq!(out[0][0], 0.0);
        assert!(out[0][1] != 0.0);
    }

    #[test]
    fn notes_wait_without_taking_voices() {
        let mut core = boxed();
        // Far more than there are voices, a second apart: each gets one.
        for i in 0..POOL * 2 {
            assert_eq!(
                core.note(
                    KALIMBA,
                    MELODY,
                    0.01 + i as f64 * 0.01,
                    60.0,
                    0.1,
                    0.5,
                    BODY
                ),
                Taken::OnTime
            );
        }
        render(&mut core, (6.0 * RATE) as usize / QUANTUM);
        assert_eq!(core.dropped(), 0);
        assert_eq!(core.busy(), 0);
    }

    #[test]
    fn a_full_queue_drops_the_note_and_counts_it() {
        let mut core = boxed();
        for i in 0..QUEUE {
            assert_eq!(
                core.note(
                    KALIMBA,
                    MELODY,
                    1.0 + i as f64 * 0.001,
                    60.0,
                    0.5,
                    0.5,
                    STRIKE
                ),
                Taken::OnTime
            );
        }
        assert_eq!(
            core.note(KALIMBA, MELODY, 9.0, 60.0, 0.5, 0.5, STRIKE),
            Taken::Full
        );
        assert_eq!(core.dropped(), 1);
    }

    #[test]
    fn a_note_starting_with_every_voice_busy_is_dropped_and_counted() {
        let mut core = boxed();
        for _ in 0..=POOL {
            core.note(KALIMBA, MELODY, 0.0, 60.0, 0.5, 0.5, STRIKE);
        }
        core.process(0);
        assert_eq!(core.dropped(), 1);
        assert_eq!(core.busy(), POOL);
    }

    #[test]
    fn unknown_voices_and_channels_are_refused() {
        let mut core = boxed();
        assert_eq!(
            core.note(7, MELODY, 0.1, 60.0, 0.5, 0.5, STRIKE),
            Taken::Unknown
        );
        assert_eq!(
            core.note(KALIMBA, 5, 0.1, 60.0, 0.5, 0.5, STRIKE),
            Taken::Unknown
        );
        assert_eq!(
            core.note(KALIMBA, MELODY, f64::NAN, 60.0, 0.5, 0.5, STRIKE),
            Taken::Unknown
        );
        assert_eq!(core.busy(), 0);
    }

    #[test]
    fn clear_lets_every_voice_go() {
        let mut core = boxed();
        core.note(KALIMBA, MELODY, 0.0, 60.0, 0.5, 0.5, STRIKE | BODY);
        core.note(KALIMBA, CHORDS, 5.0, 60.0, 0.5, 0.5, STRIKE | BODY);
        core.clear();
        assert_eq!(core.busy(), 0);
        let out = core.process(0);
        assert!(out.iter().flatten().all(|&x| x == 0.0));
    }
}
