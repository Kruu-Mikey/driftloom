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

pub mod bass;
pub mod breath;
pub mod drums;
pub mod filter;
pub mod folk;
pub mod lead;
pub mod noise;
pub mod osc;
pub mod param;
pub mod texture;
pub mod voice;
pub mod wave;

#[cfg(target_arch = "wasm32")]
mod wasm;

use bass::Bass;
use breath::{Panflute, Stab, Struck, TEMPLE_SINES, TempleBell, Wind};
use drums::Drum;
use folk::{Accordion, Body, Nylon};
use lead::{Lead, LeadKind, Tone};
use noise::Noise;
use texture::Texture;
use voice::{Fiddle, Fm, FmOptions, Kalimba, PadNote, SineNote, Tubular, Vibrato, midi_to_freq};
use wave::{Fft, Waves};

/// Web Audio's render quantum. The core renders in blocks of this many
/// frames, on frame numbers that are multiples of it, as an AudioWorklet
/// is called; a host with another block size buffers.
pub const QUANTUM: usize = 128;

/// The channels the core plays into, in the order of its outputs. Each is
/// one of the synth's per-layer channels, so a note from here takes the
/// same echo, reverb, ducking and master chain as one built in JavaScript.
/// All five of them (queue item 27).
pub const CHANNELS: usize = 5;
pub const MELODY: u32 = 0;
pub const CHORDS: u32 = 1;
pub const BASS_CHANNEL: u32 = 2;
pub const TEXTURE_CHANNEL: u32 = 3;
pub const DRUMS_CHANNEL: u32 = 4;

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

/// Whether a note of this voice plays the noise, so the core must have it.
fn plays_noise(voice: u32, parts: u32) -> bool {
    match voice {
        STAB..=HAT => voice != STAB,
        BASS => parts & bass::KIND == bass::PLUCKBASS,
        TEXTURE => texture::uses_noise(parts),
        DRUM => drums::uses_noise(parts),
        _ => false,
    }
}

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

/// How many extra values a note carries. Fixed, so a note is a plain value
/// and nothing allocates: the widest voice, the temple bell, sends ten
/// draws.
pub const EXTRA: usize = 12;

/// The voices the core can play, by number. What each reads from a note's
/// extra values (`Core::note`); values a voice does not name are unused:
///
/// - KALIMBA: `parts`, the strike and the body the budget let through.
/// - FIDDLE: the note it is joined to (NaN if none), then its vibrato's
///   rate, rate at the end and depth (NaN if the note has none).
/// - PAD: how many notes the chord has.
/// - FM: `fm()`'s options, resolved, in this order: ratio, index, attack,
///   decay, detune (cents). Every voice that is an `fm()` call -- keys,
///   bell, celeste, musicbox, rhodes, marimba, harp, piano -- is this.
/// - SINE: none.
/// - TUBULAR: the five `Math.random` draws for its partials' detunes, each
///   in [0, 1), in partial order.
/// - SOFTPAD, ANALOGPAD, ANALOGLEAD, SAWPLUCK, BEEP, MOOG: none.
/// - WHISTLE: where its slide comes from in Hz (NaN if it does not slide),
///   then how long the slide takes to arrive, in seconds.
/// - NYLON: whether it is a string of a strum (1) or not (0 or NaN): the
///   next strum into its channel damps it (`Core::damp`).
/// - ACCORDION: the note it is joined to (NaN if none), then the
///   `Math.random` draw that sets how late its second reed comes in.
/// - STAB: none.
/// - OCARINA, FLUTE: where the slide comes from in Hz and how long it
///   takes (NaN if it does not slide), then the breath's rate draw.
/// - PANFLUTE: the vibrato's rate draw (NaN for a note too short for one),
///   then the breath's rate draw.
/// - KNOCK: the prepared piano's knock: its noise's rate and offset draws,
///   then its bandpass's frequency draw.
/// - TEMPLEBELL: the eight detune draws, partial by partial, then the
///   strike's rate and offset draws.
/// - HAT: `parts` is which (`breath::HAT`, `OPEN_HAT`, `SHAKER`); its
///   noise's rate and offset draws.
/// - BASS: `parts` is the voice (`bass::SUB` and the rest) with the flags
///   `bass::GLIDE` and `CHUG`; the pluck's click's rate and offset draws.
///   Every bass voice but `rhodesbass`, which is an FM note.
/// - TEXTURE: `parts` is which (`texture::SWELL` and the rest). The drop's
///   rate, offset and band draws; the wind's slow sine's rate draw, then
///   its band in Hz (NaN for the usual one); the waves' rate and offset
///   draws. `bell` and `chime` are FM notes.
/// - DRUM: `parts` is which (`drums::KICK` and the rest; the hats are HAT).
///   The noise's rate and offset draws, for every drum but the soft kick
///   and the rim; the jingle's five zils' draws come first, then those.
///
/// The noise voices -- those from the ocarina on, the pluck, the drop, the
/// wind, the waves and the drums but two -- need the noise (`Core::noise`); a
/// core without it
/// drops them, and the host plays them in JavaScript.
pub const KALIMBA: u32 = 0;
pub const FIDDLE: u32 = 1;
pub const PAD: u32 = 2;
pub const FM: u32 = 3;
pub const SINE: u32 = 4;
pub const TUBULAR: u32 = 5;
pub const SOFTPAD: u32 = 6;
pub const ANALOGPAD: u32 = 7;
pub const ANALOGLEAD: u32 = 8;
pub const SAWPLUCK: u32 = 9;
pub const BEEP: u32 = 10;
pub const MOOG: u32 = 11;
pub const WHISTLE: u32 = 12;
pub const NYLON: u32 = 13;
pub const ACCORDION: u32 = 14;
pub const STAB: u32 = 15;
pub const OCARINA: u32 = 16;
pub const FLUTE: u32 = 17;
pub const PANFLUTE: u32 = 18;
pub const KNOCK: u32 = 19;
pub const TEMPLEBELL: u32 = 20;
pub const HAT: u32 = 21;
pub const BASS: u32 = 22;
pub const TEXTURE: u32 = 23;
pub const DRUM: u32 = 24;
/// The last voice there is.
const LAST: u32 = DRUM;

// `process` hands each voice the bus of its body by these places.
const _: () =
    assert!(folk::FIDDLE == 0 && folk::NYLON == 1 && folk::ACCORDION == 2 && folk::KINDS == 3);

// A voice lives in a slot of a fixed pool, so its size is the pool's price
// and boxing it would allocate; the biggest, tubular, sets the slot's size.
//
// `repr(u8)` keeps the tag first, with the first voice's tag zero. Without
// it the compiler hides the other voices' tags in a spare value of a byte
// inside the biggest one, a free slot is no longer all zeros, and the pool
// is written into the `.wasm` -- 3 MB, where all zeros cost nothing.
#[allow(clippy::large_enum_variant)]
#[repr(u8)]
enum Voice {
    Kalimba(Kalimba),
    Fiddle(Fiddle),
    Pad(PadNote),
    Fm(Fm),
    Sine(SineNote),
    Tubular(Tubular),
    Tone(Tone),
    Lead(Lead),
    Nylon(Nylon),
    Accordion(Accordion),
    Stab(Stab),
    Wind(Wind),
    Panflute(Panflute),
    Struck(Struck),
    TempleBell(TempleBell),
    Bass(Bass),
    Texture(Texture),
    Drum(Drum),
}

struct Slot {
    busy: bool,
    channel: usize,
    begin: u64,
    end: u64,
    /// A strummed nylon string: which strum into its channel it belongs
    /// to, and when its note ends (`Core::damp`).
    strummed: bool,
    strum: u32,
    until: f64,
    voice: Voice,
}

impl Slot {
    const fn new() -> Self {
        Slot {
            busy: false,
            channel: 0,
            begin: 0,
            end: 0,
            strummed: false,
            strum: 0,
            until: 0.0,
            voice: Voice::Kalimba(Kalimba::new()),
        }
    }
}

/// A note waiting for its start.
#[derive(Clone, Copy)]
struct Waiting {
    voice: u32,
    channel: u32,
    start: u64,
    time: f64,
    midi: f64,
    dur: f64,
    vel: f64,
    parts: u32,
    extra: [f64; EXTRA],
    /// When the note ends, on the time it was asked for (a late note's
    /// start moves; this does not).
    until: f64,
    /// A strummed nylon string's strum (see `Slot`), and the time the next
    /// strum damps it, if it has come before the note started.
    strummed: bool,
    strum: u32,
    damped: bool,
    damp: f64,
}

const NOTHING: Waiting = Waiting {
    voice: 0,
    channel: 0,
    start: 0,
    time: 0.0,
    midi: 0.0,
    dur: 0.0,
    vel: 0.0,
    parts: 0,
    extra: [0.0; EXTRA],
    until: 0.0,
    strummed: false,
    strum: 0,
    damped: false,
    damp: 0.0,
};

pub struct Core {
    rate: f64,
    /// The first frame of the next block to render.
    next: u64,
    slots: [Slot; POOL],
    queue: [Waiting; QUEUE],
    waiting: usize,
    out: [[f32; QUANTUM]; CHANNELS],
    waves: Waves,
    fft: Fft,
    /// The voices with a body sum here, per channel and kind of body, then
    /// go through it.
    buses: [[[f32; QUANTUM]; folk::KINDS]; CHANNELS],
    bodies: [[Body; folk::KINDS]; CHANNELS],
    /// Which strum each channel is on (`Core::damp`).
    strums: [u32; CHANNELS],
    noise: Noise,
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
            waves: Waves::new(),
            fft: Fft::new(),
            buses: [[[0.0; QUANTUM]; folk::KINDS]; CHANNELS],
            bodies: [const { [const { Body::new() }; folk::KINDS] }; CHANNELS],
            strums: [0; CHANNELS],
            noise: Noise::new(),
            late: 0,
            dropped: 0,
        }
    }

    /// Set the sample rate, build the wavetables and clear everything.
    /// Call before the first note.
    pub fn init(&mut self, rate: f64) {
        self.rate = rate;
        self.next = 0;
        self.late = 0;
        self.dropped = 0;
        self.clear();
        let r = rate as f32;
        self.waves.build(r, &mut self.fft);
        for channel in self.bodies.iter_mut() {
            for (kind, body) in channel.iter_mut().enumerate() {
                body.set(kind, r);
            }
        }
        self.strums = [0; CHANNELS];
    }

    /// Let every voice go at once, sounding or waiting: the host is going
    /// away.
    pub fn clear(&mut self) {
        self.waiting = 0;
        for slot in self.slots.iter_mut() {
            slot.busy = false;
        }
    }

    /// Room for the host's noise, `len` samples at the core's rate, to be
    /// written into what this returns (`_makeNoise`: two seconds, drawn
    /// from `Math.random` as the synth is built). Empty, and no noise, if it
    /// is longer than `noise::NOISE_MAX`.
    pub fn noise(&mut self, len: usize) -> &mut [f32] {
        self.noise.resize(len);
        self.noise.space()
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

    /// A note: `voice`, into `channel` (MELODY or CHORDS), at `time`
    /// seconds on the host's clock, with the voice's own `parts` and
    /// `extra` values (see the voices, above). A note whose start has
    /// already been rendered starts at once: the whole of it, from its
    /// first sample, at the start of the next block.
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
        extra: [f64; EXTRA],
    ) -> Taken {
        if voice > LAST
            || (plays_noise(voice, parts) && !self.noise.ready())
            || channel as usize >= CHANNELS
            || !(time.is_finite() && dur.is_finite() && midi.is_finite() && vel.is_finite())
        {
            return Taken::Unknown;
        }
        let rate = self.rate;
        let until = time + dur;
        let strummed = voice == NYLON && extra[0] > 0.0;
        let strum = self.strums.get(channel as usize).copied().unwrap_or(0);
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
            voice,
            channel,
            start: osc::frame_at(time, rate),
            time,
            midi,
            dur,
            vel,
            parts,
            extra,
            until,
            strummed,
            strum,
            damped: false,
            damp: 0.0,
        };
        self.waiting += 1;
        taken
    }

    /// A new strum into `channel` at `time` (`damp()` in synth.js): the
    /// strings of the strum before it that are still held -- every nylon
    /// note marked as a strum's since the last damp into the channel, whose
    /// note ends after `time` -- let go at `time` on their own release,
    /// `setTargetAtTime(0.0001, time, 0.08)` added to both their gains.
    ///
    /// Web Audio adds that event to a timeline that may already be
    /// rendering. Chromium renders an event added ahead of the clock exactly
    /// as one scheduled with the note, so a string already sounding takes it
    /// as it is, and a string still waiting takes it when it starts. One
    /// whose time has already been rendered is not caught up: Chromium
    /// moves an event added in the past to the start of the next block it
    /// renders (`ClampNewEventsToCurrentTime`), and the curve starts there,
    /// from the last value it rendered.
    pub fn damp(&mut self, channel: u32, time: f64) {
        let Some(serial) = self.strums.get_mut(channel as usize) else {
            return;
        };
        let strum = *serial;
        *serial = serial.wrapping_add(1);
        if !time.is_finite() {
            return;
        }
        for w in self.queue.iter_mut().take(self.waiting) {
            if w.strummed && w.channel == channel && w.strum == strum && w.until > time {
                w.damped = true;
                w.damp = time;
            }
        }
        let now = self.next as f64 / self.rate;
        let at = if time < now { now } else { time };
        for slot in self.slots.iter_mut() {
            if slot.busy
                && slot.strummed
                && slot.channel == channel as usize
                && slot.strum == strum
                && slot.until > time
                && let Voice::Nylon(v) = &mut slot.voice
            {
                v.damp(at);
            }
        }
    }

    // A waiting note's start has come: give it a voice.
    fn start(&mut self, w: Waiting) {
        let Some(slot) = self.slots.iter_mut().find(|s| !s.busy) else {
            self.dropped = self.dropped.saturating_add(1);
            return;
        };
        let rate = self.rate;
        let noise = self.noise.samples().len();
        let [a, b, c, d, e, f, g, ..] = w.extra;
        let (begin, end) = match w.voice {
            FIDDLE => {
                let prev = if a.is_finite() { Some(a) } else { None };
                let vib = if b.is_finite() && c.is_finite() && d.is_finite() {
                    Some(Vibrato {
                        rate: b,
                        rate_end: c,
                        depth: d,
                    })
                } else {
                    None
                };
                let mut v = Fiddle::new();
                v.play(w.midi, w.time, w.dur, w.vel, prev, vib, rate);
                let span = (v.start_frame(), v.end_frame());
                slot.voice = Voice::Fiddle(v);
                span
            }
            PAD => {
                let mut v = PadNote::new();
                v.play(w.midi, w.time, w.dur, w.vel, a.max(1.0), rate);
                let span = (v.start_frame(), v.end_frame());
                slot.voice = Voice::Pad(v);
                span
            }
            FM => {
                let options = FmOptions {
                    ratio: a,
                    index: b,
                    attack: c,
                    decay: d,
                    detune: e,
                };
                let mut v = Fm::new();
                v.strike(midi_to_freq(w.midi), w.time, w.dur, w.vel, &options, rate);
                let span = (v.start_frame(), v.end_frame());
                slot.voice = Voice::Fm(v);
                span
            }
            SINE => {
                let mut v = SineNote::new();
                v.play(w.midi, w.time, w.dur, w.vel, rate);
                let span = (v.start_frame(), v.end_frame());
                slot.voice = Voice::Sine(v);
                span
            }
            TUBULAR => {
                let mut v = Tubular::new();
                v.play(w.midi, w.time, w.dur, w.vel, [a, b, c, d, e], rate);
                let span = (v.start_frame(), v.end_frame());
                slot.voice = Voice::Tubular(v);
                span
            }
            SOFTPAD | ANALOGPAD | ANALOGLEAD | SAWPLUCK | BEEP => {
                let mut v = Tone::new();
                match w.voice {
                    SOFTPAD => v.soft_pad(w.midi, w.time, w.dur, w.vel, rate),
                    ANALOGPAD => v.analog_pad(w.midi, w.time, w.dur, w.vel, rate),
                    ANALOGLEAD => v.analog_lead(w.midi, w.time, w.dur, w.vel, rate),
                    SAWPLUCK => v.saw_pluck(w.midi, w.time, w.dur, w.vel, rate),
                    _ => v.beep(w.midi, w.time, w.dur, w.vel, rate),
                }
                let span = (v.start_frame(), v.end_frame());
                slot.voice = Voice::Tone(v);
                span
            }
            MOOG | WHISTLE => {
                let kind = if w.voice == MOOG {
                    LeadKind::Moog
                } else {
                    LeadKind::Whistle
                };
                let slide = if a.is_finite() && b.is_finite() {
                    Some((a, b))
                } else {
                    None
                };
                let mut v = Lead::new();
                v.play(kind, w.midi, w.time, w.dur, w.vel, slide, rate);
                let span = (v.start_frame(), v.end_frame());
                slot.voice = Voice::Lead(v);
                span
            }
            NYLON => {
                let mut v = Nylon::new();
                v.play(w.midi, w.time, w.dur, w.vel, rate);
                if w.damped {
                    v.damp(w.damp);
                }
                let span = (v.start_frame(), v.end_frame());
                slot.voice = Voice::Nylon(v);
                span
            }
            ACCORDION => {
                let mut v = Accordion::new();
                v.play(
                    w.midi,
                    w.time,
                    w.dur,
                    w.vel,
                    w.channel == CHORDS,
                    a.is_finite(),
                    b,
                    rate,
                );
                let span = (v.start_frame(), v.end_frame());
                slot.voice = Voice::Accordion(v);
                span
            }
            STAB => {
                let mut v = Stab::new();
                v.play(w.midi, w.time, w.dur, w.vel, rate);
                let span = (v.start_frame(), v.end_frame());
                slot.voice = Voice::Stab(v);
                span
            }
            OCARINA | FLUTE => {
                let slide = if a.is_finite() && b.is_finite() {
                    Some((a, b))
                } else {
                    None
                };
                let mut v = Wind::new();
                v.play(
                    w.voice == FLUTE,
                    w.midi,
                    w.time,
                    w.dur,
                    w.vel,
                    slide,
                    c,
                    noise,
                    rate,
                );
                let span = (v.start_frame(), v.end_frame());
                slot.voice = Voice::Wind(v);
                span
            }
            PANFLUTE => {
                let vibrato = if a.is_finite() { Some(a) } else { None };
                let mut v = Panflute::new();
                v.play(w.midi, w.time, w.dur, w.vel, vibrato, b, noise, rate);
                let span = (v.start_frame(), v.end_frame());
                slot.voice = Voice::Panflute(v);
                span
            }
            KNOCK | HAT => {
                let mut v = Struck::new();
                if w.voice == KNOCK {
                    v.knock(w.time, w.vel, a, b, c, noise, rate);
                } else {
                    v.hat(w.parts, w.time, w.vel, a, b, noise, rate);
                }
                let span = (v.start_frame(), v.end_frame());
                slot.voice = Voice::Struck(v);
                span
            }
            TEMPLEBELL => {
                let mut draws = [0.0; TEMPLE_SINES];
                for (d, &x) in draws.iter_mut().zip(w.extra.iter()) {
                    *d = x;
                }
                let strike = (
                    w.extra.get(TEMPLE_SINES).copied().unwrap_or(0.0),
                    w.extra.get(TEMPLE_SINES + 1).copied().unwrap_or(0.0),
                );
                let mut v = TempleBell::new();
                v.play(
                    w.midi,
                    w.time,
                    w.dur,
                    w.vel,
                    w.channel == CHORDS,
                    &draws,
                    strike,
                    noise,
                    rate,
                );
                let span = (v.start_frame(), v.end_frame());
                slot.voice = Voice::TempleBell(v);
                span
            }
            BASS => {
                let mut v = Bass::new();
                v.play(w.parts, w.midi, w.time, w.dur, w.vel, (a, b), noise, rate);
                let span = (v.start_frame(), v.end_frame());
                slot.voice = Voice::Bass(v);
                span
            }
            DRUM => {
                let mut v = Drum::new();
                v.play(w.parts, w.time, w.vel, &[a, b, c, d, e, f, g], noise, rate);
                let span = (v.start_frame(), v.end_frame());
                slot.voice = Voice::Drum(v);
                span
            }
            TEXTURE => {
                let mut v = Texture::new();
                v.play(w.parts, w.midi, w.time, w.dur, w.vel, [a, b, c], noise, rate);
                let span = (v.start_frame(), v.end_frame());
                slot.voice = Voice::Texture(v);
                span
            }
            _ => {
                let mut v = Kalimba::new();
                v.play(w.midi, w.time, w.dur, w.vel, w.parts, rate);
                let span = (v.start_frame(), v.end_frame());
                slot.voice = Voice::Kalimba(v);
                span
            }
        };
        slot.channel = w.channel as usize;
        slot.strummed = w.strummed;
        slot.strum = w.strum;
        slot.until = w.until;
        slot.begin = begin;
        slot.end = end;
        slot.busy = end > begin;
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
        for bus in self.buses.iter_mut().flatten() {
            bus.fill(0.0);
        }
        let rate = self.rate;
        for slot in self.slots.iter_mut().filter(|s| s.busy) {
            if slot.begin >= end {
                continue;
            }
            let (Some(out), Some([fiddles, nylons, accordions])) = (
                self.out.get_mut(slot.channel),
                self.buses.get_mut(slot.channel),
            ) else {
                continue;
            };
            match &mut slot.voice {
                Voice::Kalimba(v) => v.render(block, rate, &self.waves, out),
                Voice::Fiddle(v) => v.render(block, rate, &self.waves, fiddles),
                Voice::Nylon(v) => v.render(block, rate, &self.waves, nylons),
                Voice::Accordion(v) => v.render(block, rate, &self.waves, accordions),
                Voice::Stab(v) => v.render(block, rate, &self.waves, out),
                Voice::Wind(v) => v.render(block, rate, &self.waves, self.noise.samples(), out),
                Voice::Panflute(v) => v.render(block, rate, &self.waves, self.noise.samples(), out),
                Voice::Struck(v) => v.render(block, rate, self.noise.samples(), out),
                Voice::TempleBell(v) => {
                    v.render(block, rate, &self.waves, self.noise.samples(), out)
                }
                Voice::Bass(v) => v.render(block, rate, &self.waves, self.noise.samples(), out),
                Voice::Texture(v) => {
                    v.render(block, rate, &self.waves, self.noise.samples(), out)
                }
                Voice::Drum(v) => v.render(block, rate, &self.waves, self.noise.samples(), out),
                Voice::Pad(v) => v.render(block, rate, &self.waves, out),
                Voice::Fm(v) => v.render(block, rate, &self.waves, out),
                Voice::Sine(v) => v.render(block, rate, &self.waves, out),
                Voice::Tubular(v) => v.render(block, rate, &self.waves, out),
                Voice::Tone(v) => v.render(block, rate, &self.waves, out),
                Voice::Lead(v) => v.render(block, rate, &self.waves, out),
            }
            if slot.end <= end {
                slot.busy = false;
            }
        }
        // Every note with a body, through its channel's body of its kind.
        for ((out, buses), bodies) in self
            .out
            .iter_mut()
            .zip(self.buses.iter())
            .zip(self.bodies.iter_mut())
        {
            for (bus, body) in buses.iter().zip(bodies.iter_mut()) {
                body.run(bus, out);
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

    const NO: [f64; EXTRA] = [f64::NAN; EXTRA];

    // The core holds its wavetables, 1.2 MB, so it is built on a thread
    // with room for it on the stack.
    fn boxed() -> Box<Core> {
        std::thread::Builder::new()
            .stack_size(1 << 26)
            .spawn(|| {
                let mut core = Box::new(Core::new());
                core.init(RATE);
                core
            })
            .and_then(|t| t.join().map_err(|_| std::io::Error::other("panicked")))
            .expect("core")
    }

    #[test]
    fn a_kalimba_note_sounds_then_lets_its_voice_go() {
        let mut core = boxed();
        assert_eq!(
            core.note(KALIMBA, MELODY, 0.1, 69.0, 0.4, 0.8, STRIKE | BODY, NO),
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
            core.note(KALIMBA, MELODY, 0.0123, 72.0, 0.3, 0.6, STRIKE | BODY, NO);
            core.note(KALIMBA, MELODY, 0.2001, 64.0, 1.5, 0.5, STRIKE, NO);
        }
        assert_eq!(render(&mut a, 400), render(&mut b, 400));
    }

    #[test]
    fn parts_the_budget_refused_stay_silent() {
        let mut both = boxed();
        let mut body = boxed();
        both.note(KALIMBA, CHORDS, 0.05, 60.0, 0.5, 0.7, STRIKE | BODY, NO);
        body.note(KALIMBA, CHORDS, 0.05, 60.0, 0.5, 0.7, BODY, NO);
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
            core.note(KALIMBA, MELODY, 0.001, 69.0, 0.2, 0.8, STRIKE, NO),
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
                    BODY,
                    NO
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
                    STRIKE,
                    NO
                ),
                Taken::OnTime
            );
        }
        assert_eq!(
            core.note(KALIMBA, MELODY, 9.0, 60.0, 0.5, 0.5, STRIKE, NO),
            Taken::Full
        );
        assert_eq!(core.dropped(), 1);
    }

    #[test]
    fn a_note_starting_with_every_voice_busy_is_dropped_and_counted() {
        let mut core = boxed();
        for _ in 0..=POOL {
            core.note(KALIMBA, MELODY, 0.0, 60.0, 0.5, 0.5, STRIKE, NO);
        }
        core.process(0);
        assert_eq!(core.dropped(), 1);
        assert_eq!(core.busy(), POOL);
    }

    #[test]
    fn unknown_voices_and_channels_are_refused() {
        let mut core = boxed();
        assert_eq!(
            core.note(99, MELODY, 0.1, 60.0, 0.5, 0.5, STRIKE, NO),
            Taken::Unknown
        );
        assert_eq!(
            core.note(KALIMBA, 5, 0.1, 60.0, 0.5, 0.5, STRIKE, NO),
            Taken::Unknown
        );
        assert_eq!(
            core.note(KALIMBA, MELODY, f64::NAN, 60.0, 0.5, 0.5, STRIKE, NO),
            Taken::Unknown
        );
        assert_eq!(core.busy(), 0);
    }

    // The options keys passes to `fm()`: ratio, index, attack, decay, detune.
    const KEYS: [f64; EXTRA] = [
        2.0,
        260.0,
        0.006,
        0.4,
        0.0,
        f64::NAN,
        f64::NAN,
        f64::NAN,
        f64::NAN,
        f64::NAN,
        f64::NAN,
        f64::NAN,
    ];

    fn energy(core: &mut Core, channel: usize, seconds: f64) -> (f32, f32) {
        let (mut peak, mut sum) = (0.0f32, 0.0f32);
        for b in 0..(seconds * RATE) as usize / QUANTUM {
            for &x in core.process((b * QUANTUM) as u64)[channel].iter() {
                peak = peak.max(x.abs());
                sum += x * x;
            }
        }
        (peak, sum)
    }

    #[test]
    fn an_fm_note_sounds_then_lets_its_voice_go() {
        let mut core = boxed();
        assert_eq!(
            core.note(FM, CHORDS, 0.1, 60.0, 0.5, 0.8, 0, KEYS),
            Taken::OnTime
        );
        // In the chords channel, and nothing in the melody one.
        let mut melody = 0.0f32;
        let mut chords = 0.0f32;
        for b in 0..(2.5 * RATE) as usize / QUANTUM {
            let out = core.process((b * QUANTUM) as u64);
            melody = out[0].iter().fold(melody, |a, &x| a.max(x.abs()));
            chords = out[1].iter().fold(chords, |a, &x| a.max(x.abs()));
        }
        assert_eq!(melody, 0.0);
        assert!(chords > 0.05 && chords < 0.3, "peak {chords}");
        // 0.5 s note, released 1.2 s after: gone by 1.81 s.
        assert_eq!(core.busy(), 0);
    }

    #[test]
    fn fm_options_change_the_note() {
        let mut keys = boxed();
        let mut bell = boxed();
        keys.note(FM, MELODY, 0.05, 72.0, 0.4, 0.7, 0, KEYS);
        bell.note(
            FM,
            MELODY,
            0.05,
            72.0,
            0.4,
            0.7,
            0,
            [
                3.51,
                420.0,
                0.006,
                0.5,
                7.0,
                f64::NAN,
                f64::NAN,
                f64::NAN,
                f64::NAN,
                f64::NAN,
                f64::NAN,
                f64::NAN,
            ],
        );
        let a = render(&mut keys, 300);
        let b = render(&mut bell, 300);
        assert_ne!(a, b);
    }

    #[test]
    fn a_sine_note_sounds_then_lets_its_voice_go() {
        let mut core = boxed();
        core.note(SINE, MELODY, 0.1, 69.0, 0.6, 0.8, 0, NO);
        let (peak, _) = energy(&mut core, 0, 3.0);
        // vel * 0.24 at the top of the swell.
        assert!(peak > 0.15 && peak < 0.2, "peak {peak}");
        assert_eq!(core.busy(), 0);
    }

    #[test]
    fn a_tubular_note_rings_for_at_least_five_seconds() {
        let mut core = boxed();
        let mut draws = [f64::NAN; EXTRA];
        draws[..5].copy_from_slice(&[0.5, 0.0, 1.0, 0.25, 0.75]);
        core.note(TUBULAR, CHORDS, 0.1, 60.0, 0.4, 0.8, 0, draws);
        let (peak, _) = energy(&mut core, 1, 4.0);
        assert!(peak > 0.05 && peak < 0.4, "peak {peak}");
        assert_eq!(core.busy(), 1, "gone before five seconds");
        let mut b = (4.0 * RATE) as usize / QUANTUM;
        while core.busy() > 0 && b < 20 * RATE as usize / QUANTUM {
            core.process((b * QUANTUM) as u64);
            b += 1;
        }
        assert_eq!(core.busy(), 0);
    }

    #[test]
    fn each_wave_table_voice_sounds_then_lets_its_voice_go() {
        // (voice, level range its peak should fall in), at a note of 0.5 s.
        let voices = [
            (SOFTPAD, 0.02, 0.5),
            (ANALOGPAD, 0.02, 0.5),
            (ANALOGLEAD, 0.01, 0.5),
            (SAWPLUCK, 0.01, 0.5),
            (BEEP, 0.01, 0.5),
            (MOOG, 0.01, 0.5),
            (WHISTLE, 0.01, 0.5),
        ];
        for (voice, low, high) in voices {
            let mut core = boxed();
            assert_eq!(
                core.note(voice, MELODY, 0.05, 64.0, 0.5, 0.8, 0, NO),
                Taken::OnTime
            );
            let (peak, _) = energy(&mut core, 0, 4.0);
            assert!(peak > low && peak < high, "voice {voice}: peak {peak}");
            assert_eq!(core.busy(), 0, "voice {voice} still sounding");
        }
    }

    #[test]
    fn a_whistle_slides_only_when_it_is_told_to() {
        let mut plain = boxed();
        let mut slid = boxed();
        let mut none = [f64::NAN; EXTRA];
        plain.note(WHISTLE, MELODY, 0.05, 72.0, 0.4, 0.7, 0, none);
        none[0] = 440.0;
        none[1] = 0.06;
        slid.note(WHISTLE, MELODY, 0.05, 72.0, 0.4, 0.7, 0, none);
        assert_ne!(render(&mut plain, 100), render(&mut slid, 100));
    }

    #[test]
    fn the_built_in_waves_have_chromiums_partials() {
        use wave::{sawtooth, square, triangle};
        let pi = core::f32::consts::PI;
        assert!((sawtooth(1) - 2.0 / pi).abs() < 1e-6);
        assert!((sawtooth(2) + 1.0 / pi).abs() < 1e-6);
        assert_eq!(square(2), 0.0);
        assert!((square(3) - 4.0 / (3.0 * pi)).abs() < 1e-6);
        assert!((triangle(1) - 8.0 / (pi * pi)).abs() < 1e-6);
    }

    #[test]
    fn clear_lets_every_voice_go() {
        let mut core = boxed();
        core.note(KALIMBA, MELODY, 0.0, 60.0, 0.5, 0.5, STRIKE | BODY, NO);
        core.note(KALIMBA, CHORDS, 5.0, 60.0, 0.5, 0.5, STRIKE | BODY, NO);
        core.clear();
        assert_eq!(core.busy(), 0);
        let out = core.process(0);
        assert!(out.iter().flatten().all(|&x| x == 0.0));
    }
}
