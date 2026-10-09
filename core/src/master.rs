//! The first half of the master chain (queue item 30): the tape wobble,
//! the saturator, the tone lowpass and the highpass, from `preBus` to the
//! bus compressor, as `_build()` in synth.js makes them.
//!
//! - **Wobble**: a delay of 14 ms whose time two sine LFOs move, wow (0.32
//!   Hz) and flutter (6.3 Hz), each through a gain `setTone` sets. The LFOs
//!   are oscillators started when the synth is built, so their phase is
//!   counted from then (`start`); the delay time is the parameter's own
//!   value plus both, every frame, held within 0 and 0.2 s, and the delay
//!   is Chromium's (`delay`).
//! - **Saturator**: a `WaveShaperNode` with a `tanh` curve of 2048 points,
//!   read as Chromium reads it (the input mapped to an index, the two points
//!   either side blended, in 32-bit floats), with 2x oversampling on full
//!   quality (`resample`) and none on lite. `setTone` replaces the curve
//!   outright; the new one is read from the next block on.
//! - **Tone**: a lowpass at 7200 Hz, Q 0.6, that `setTone` moves; then a
//!   highpass at 38 Hz. The same `Biquad` the voices use.

use crate::delay::{Delay, buffer_len};
use crate::filter::{Biquad, Kind};
use crate::osc::TableOsc;
use crate::resample::{Down, Up};
use crate::timeline::Timeline;
use crate::wave::Waves;
use crate::QUANTUM;

type Block = [f32; QUANTUM];

const WOBBLE_MAX: f64 = 0.2;
const WOBBLE_TIME: f64 = 0.014;
const WOW_HZ: f64 = 0.32;
const WOW_DEPTH: f64 = 0.0016;
const FLUTTER_HZ: f64 = 6.3;
const FLUTTER_DEPTH: f64 = 0.00018;
const TONE_HZ: f64 = 7200.0;
const TONE_Q: f64 = 0.6;
const HIGHPASS_HZ: f64 = 38.0;
/// A BiquadFilterNode's Q, untouched.
const Q: f32 = 1.0;

/// Points on the saturator's curve (`tanhCurve`'s `n`).
pub const CURVE: usize = 2048;
/// The curve the synth starts with: `tanhCurve(1.0)`.
const DRIVE: f64 = 1.0;

/// The wobble's delay line at `mix::MAX_RATE`.
pub const MEMORY: usize = QUANTUM + 19200;

const EVENTS: usize = 64;

const fn f(x: f64) -> f32 {
    x as f32
}

pub struct Master {
    rate: f64,
    full: bool,
    /// The wow LFO steps a thirtieth of a table sample a frame, slow enough
    /// that Chromium reads it with Lagrange interpolation rather than the
    /// oscillator's usual linear read (`Wave::read_slow`), so it is run
    /// here, frame by frame: its first frame and its place in the table.
    wow_start: u64,
    wow_index: f64,
    flutter: TableOsc,
    /// The first block the LFOs have not yet been moved through.
    lfo_block: u64,
    wow_depth: Timeline<EVENTS>,
    flutter_depth: Timeline<EVENTS>,
    wobble: Delay,
    wobble_time: f32,
    memory: [f32; MEMORY],
    curve: [f32; CURVE],
    up: Up,
    down: Down,
    tone_freq: Timeline<EVENTS>,
    tone: Biquad,
    highpass: Biquad,
    out: Block,
}

impl Master {
    /// All zeros, as `Mix::new`; `init` builds it.
    pub const fn new() -> Self {
        Master {
            rate: 0.0,
            full: false,
            wow_start: 0,
            wow_index: 0.0,
            flutter: TableOsc::new(),
            lfo_block: 0,
            wow_depth: Timeline::new(0.0, 0.0, 0.0),
            flutter_depth: Timeline::new(0.0, 0.0, 0.0),
            wobble: Delay::new(),
            wobble_time: 0.0,
            memory: [0.0; MEMORY],
            curve: [0.0; CURVE],
            up: Up::new(),
            down: Down::new(),
            tone_freq: Timeline::new(0.0, 0.0, 0.0),
            tone: Biquad::new(),
            highpass: Biquad::new(),
            out: [0.0; QUANTUM],
        }
    }

    /// Build the chain at `rate`, oversampling the saturator on full
    /// quality. The LFOs start at frame 0 until `start` says otherwise.
    /// False if the wobble's delay does not fit (`mix::MAX_RATE`).
    pub fn init(&mut self, rate: f64, full: bool) -> bool {
        self.rate = rate;
        self.full = full;
        let any = (f32::MIN, f32::MAX);
        self.wow_depth.configure(f(WOW_DEPTH), any.0, any.1);
        self.flutter_depth.configure(f(FLUTTER_DEPTH), any.0, any.1);
        self.start(0.0);
        let end = self.wobble.place(WOBBLE_MAX, rate, 0);
        self.wobble_time = f(WOBBLE_TIME).max(0.0).min(self.wobble.max);
        self.memory.fill(0.0);
        self.set_drive(DRIVE);
        self.up.init();
        self.down.init();
        let r = f(rate);
        self.tone_freq.configure(f(TONE_HZ), 0.0, r / 2.0);
        self.tone.reset();
        self.highpass.reset();
        self.highpass.set(Kind::Highpass, f(HIGHPASS_HZ), Q, 0.0, r);
        self.out = [0.0; QUANTUM];
        end <= MEMORY
    }

    /// The LFOs' start, in seconds on the host's clock: when the synth
    /// built them (`start()` with no time starts an oscillator on the next
    /// block rendered).
    pub fn start(&mut self, time: f64) {
        let rate = self.rate;
        self.wow_start = crate::osc::frame_at(time, rate);
        self.wow_index = 0.0;
        self.flutter.schedule(time, f64::INFINITY, rate);
        // Nothing to move through before the block they start in.
        self.lfo_block = self.wow_start - self.wow_start % QUANTUM as u64;
    }

    /// `tanhCurve(drive)`, the curve `setTone` gives the saturator.
    pub fn set_drive(&mut self, drive: f64) {
        if !(drive.is_finite() && drive != 0.0) {
            return;
        }
        let n = CURVE as f64;
        for (i, y) in self.curve.iter_mut().enumerate() {
            let x = (i as f64 / (n - 1.0)) * 2.0 - 1.0;
            *y = ((x * drive).tanh() / drive) as f32;
        }
    }

    pub fn wow_depth(&mut self) -> &mut Timeline<EVENTS> {
        &mut self.wow_depth
    }

    pub fn flutter_depth(&mut self) -> &mut Timeline<EVENTS> {
        &mut self.flutter_depth
    }

    pub fn tone_freq(&mut self) -> &mut Timeline<EVENTS> {
        &mut self.tone_freq
    }

    /// One block of `preBus` in; what reaches the bus compressor out.
    pub fn process(&mut self, block: u64, input: &Block, waves: &Waves) -> &Block {
        let rate = self.rate;
        let r32 = f(rate);
        let wave = &waves.sine;
        let (wow_hz, flutter_hz) = (f(WOW_HZ), f(FLUTTER_HZ));

        // The LFOs run from when the synth built them, rendered or not: a
        // host that starts later moves them through the blocks it missed.
        while self.lfo_block < block {
            let b = self.lfo_block;
            self.wow(b, wave, wow_hz, r32, None);
            self.flutter.skip(b, wave, flutter_hz, r32);
            self.lfo_block += QUANTUM as u64;
        }
        let mut wow = [0.0f32; QUANTUM];
        let mut flutter = [0.0f32; QUANTUM];
        let steady = |hz| crate::osc::Pitch::Steady {
            freq: hz,
            detune: 0.0,
        };
        self.wow(block, wave, wow_hz, r32, Some(&mut wow));
        self.flutter
            .render(block, wave, &steady(flutter_hz), r32, &mut flutter);
        self.lfo_block = block + QUANTUM as u64;
        let mut depth = [0.0f32; QUANTUM];
        self.wow_depth.fill(block, rate, &mut depth);
        for (x, &d) in wow.iter_mut().zip(depth.iter()) {
            *x *= d;
        }
        self.flutter_depth.fill(block, rate, &mut depth);
        for (x, &d) in flutter.iter_mut().zip(depth.iter()) {
            *x *= d;
        }
        // The delay's time: its own value, then each LFO summed in, then
        // held within the parameter's range.
        let max = self.wobble.max;
        let mut times = [0.0f32; QUANTUM];
        for ((t, &w), &fl) in times.iter_mut().zip(wow.iter()).zip(flutter.iter()) {
            let mut x = self.wobble_time;
            x += w;
            x += fl;
            *t = if x.is_nan() { max } else { x.max(0.0).min(max) };
        }
        let mut wobbled = [0.0f32; QUANTUM];
        self.wobble
            .process(&mut self.memory, input, &times, r32, &mut wobbled);

        // The saturator.
        let mut shaped = [0.0f32; QUANTUM];
        if self.full {
            let mut high = [0.0f32; 2 * QUANTUM];
            self.up.process(&wobbled, &mut high);
            shape(&self.curve, &mut high);
            self.down.process(&high, &mut shaped);
        } else {
            shaped = wobbled;
            shape(&self.curve, &mut shaped);
        }

        // Tone, then the highpass.
        let mut freq = [0.0f32; QUANTUM];
        self.tone_freq.fill(block, rate, &mut freq);
        let q = f(TONE_Q);
        for ((y, &x), &fr) in self.out.iter_mut().zip(shaped.iter()).zip(freq.iter()) {
            self.tone.set(Kind::Lowpass, fr, q, 0.0, r32);
            *y = self.highpass.step(self.tone.step(x));
        }
        self.tone.flush();
        self.highpass.flush();
        &self.out
    }
}

impl Master {
    // The wow LFO's block from frame `block` (`ProcessKRate`'s slow path):
    // each frame read at its place in the table, which then moves on by the
    // step, wrapped, in 64 bits. With no `out`, only its place moves.
    fn wow(&mut self, block: u64, wave: &crate::wave::Wave, hz: f32, rate: f32, mut out: Option<&mut Block>) {
        let freq = hz.max(-rate / 2.0).min(rate / 2.0);
        let incr = freq * wave.rate_scale();
        let pick = wave.pick(freq);
        let size = wave.size() as f64;
        let inverse = 1.0 / size;
        for i in 0..QUANTUM {
            if block + (i as u64) < self.wow_start {
                continue;
            }
            if let Some(y) = out.as_deref_mut().and_then(|o| o.get_mut(i)) {
                *y = wave.read_slow(self.wow_index, incr, pick);
            }
            self.wow_index += incr as f64;
            self.wow_index -= (self.wow_index * inverse).floor() * size;
        }
    }
}

impl Default for Master {
    fn default() -> Self {
        Self::new()
    }
}

// `WaveShaperCurveValues`, the x86 build: the input to an index into the
// curve, the two points either side, blended -- every step a 32-bit float.
fn shape(curve: &[f32; CURVE], samples: &mut [f32]) {
    let last = (CURVE - 1) as f32;
    let max = CURVE as i32 - 1;
    let scale = 0.5 * last;
    for x in samples.iter_mut() {
        let v = ((*x + 1.0) * scale).max(0.0).min(last);
        let i1 = v as i32;
        let index = i1 as f32;
        let at = |i: i32| curve.get(i.max(0).min(max) as usize).copied().unwrap_or(0.0);
        let (v1, v2) = (at(i1), at(i1 + 1));
        let frac = v - index;
        *x = frac * (v2 - v1) + v1;
    }
}

/// The memory the wobble's delay needs at `rate`.
pub fn memory_for(rate: f64) -> usize {
    buffer_len(WOBBLE_MAX, rate)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wave::Fft;

    const RATE: f64 = 44100.0;

    fn built(full: bool) -> (Box<Master>, Box<Waves>) {
        std::thread::Builder::new()
            .stack_size(1 << 26)
            .spawn(move || {
                let mut m = Box::new(Master::new());
                assert!(m.init(RATE, full));
                let mut waves = Box::new(Waves::new());
                waves.build(RATE as f32, &mut Fft::new());
                (m, waves)
            })
            .and_then(|t| t.join().map_err(|_| std::io::Error::other("panicked")))
            .expect("master")
    }

    #[test]
    fn the_wobble_fits_at_the_highest_rate() {
        assert_eq!(memory_for(crate::mix::MAX_RATE), MEMORY);
    }

    #[test]
    fn the_curve_is_tanh_over_the_drive() {
        let mut m = Box::new(Master::new());
        m.set_drive(2.0);
        assert_eq!(m.curve[0], ((-2.0f64).tanh() / 2.0) as f32);
        assert_eq!(m.curve[CURVE - 1], (2.0f64.tanh() / 2.0) as f32);
    }

    #[test]
    fn a_quiet_sine_comes_through_about_level_and_late() {
        for full in [true, false] {
            let (mut m, waves) = built(full);
            let hz = 1000.0;
            let mut peak = 0.0f32;
            for b in 0..200u64 {
                let input: Block = core::array::from_fn(|i| {
                    let n = (b as usize * QUANTUM + i) as f64;
                    (0.1 * (2.0 * core::f64::consts::PI * hz * n / RATE).sin()) as f32
                });
                let out = m.process(b * QUANTUM as u64, &input, &waves);
                if b > 100 {
                    peak = out.iter().fold(peak, |a, &x| a.max(x.abs()));
                }
            }
            // tanh is nearly straight at 0.1; the filters pass 1 kHz.
            assert!((peak - 0.1).abs() < 0.01, "full {full}: {peak}");
        }
    }

    #[test]
    fn shaping_reads_the_curve_at_its_ends() {
        let mut m = Box::new(Master::new());
        m.set_drive(1.0);
        let mut x = [-2.0f32, 2.0, 0.0];
        shape(&m.curve, &mut x);
        assert_eq!(x[0], m.curve[0]);
        assert_eq!(x[1], m.curve[CURVE - 1]);
        assert!(x[2].abs() < 1e-3);
    }
}

