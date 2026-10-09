//! An oscillator that starts, runs and stops the way a Web Audio
//! `OscillatorNode` does in Chromium (`oscillator_handler.cc`), checked
//! against its output. It plays a `Wave`: a `PeriodicWave`, or one of the
//! built-in shapes, which Chromium builds the same way -- even the sine is
//! a table of one partial, read like the rest. The JavaScript synth is the
//! reference, and these are the places a plain oscillator would not null
//! against it:
//!
//! - **Start and stop** land on whole sample frames: the first frame at or
//!   after the start time, and the stop time likewise, each rounded to
//!   1/1024 of a frame first (`frame_at`). So a start a hair past a frame
//!   is on that frame, and a stop a hair past one stops there. A start on
//!   a frame but after it writes nothing there; the wave begins on the
//!   next. The wave starts at the top of its table and moves on after each
//!   sample, by the step at that sample.
//! - **The fraction of a frame.** A note rarely starts on a frame. When the
//!   oscillator's pitch is steady in the render block it starts in
//!   (nothing automated, nothing connected to it), Chromium starts the
//!   wave where it would have been at that frame had the note begun
//!   between frames. Not in the very first block a context renders, and
//!   not when the pitch moves (below): there it starts at the top.
//! - **The first block of a moving pitch.** When the frequency or detune
//!   moves in the block the note starts in (something is connected to it,
//!   as FM is, or it has an automation event at or after the block's
//!   start), the block reads its steps from the start of the block rather
//!   than from the note's first frame: the note's first sample takes the
//!   block's first step, and so on. So a frequency set at the note's start
//!   time does not reach it until a block later, and the oscillator runs
//!   at whatever came before -- an automated frequency's intrinsic value,
//!   or an FM carrier's own pitch with no modulation -- for up to a block.
//!   That is in every JavaScript note today, so it is here too. From the
//!   next block on, frames line up.
//! - **Precision.** The place in the table is a 64-bit float; the steps,
//!   the pitch, the detune and the blend between tables are 32-bit floats,
//!   worked out in Chromium's order.
//!
//! Blocks are Web Audio's render quantum, `QUANTUM` frames, on frame
//! numbers that are multiples of it: the host hands every block to the
//! core in order, and these rules are counted from frame 0.

use crate::QUANTUM;
use crate::wave::Wave;

/// `TimeToSampleFrame`'s first step: the time in frames, to 1/1024 of one.
pub fn frames(time: f64, rate: f64) -> f64 {
    (time * rate * 1024.0).round() / 1024.0
}

/// The first frame at or after `time` seconds, as Chromium schedules every
/// source, oscillators and buffer sources alike
/// (`AudioScheduledSourceHandler::UpdateSchedulingInfo`): the time is
/// rounded to 1/1024 of a frame first, so a time a hair past a frame is
/// that frame.
pub fn frame_at(time: f64, rate: f64) -> u64 {
    let f = frames(time, rate).ceil();
    if f > 0.0 { f as u64 } else { 0 }
}

/// How a wavetable oscillator's pitch is set for a block: steady (one
/// frequency and one detune for the whole block, read once), or moving, with
/// the frequency and the detune in cents at every frame. Either part of a
/// moving pitch may itself be steady.
pub enum Pitch<'a> {
    Steady { freq: f32, detune: f32 },
    Moving { freq: Part<'a>, detune: Part<'a> },
}

pub enum Part<'a> {
    Steady(f32),
    Moving(&'a [f32; QUANTUM]),
}

/// The oscillator. It keeps its place in table samples.
pub struct TableOsc {
    /// Position in the table, in table samples, in [0, size).
    index: f64,
    start: u64,
    stop: u64,
    at: f64,
}

impl TableOsc {
    pub const fn new() -> Self {
        TableOsc {
            index: 0.0,
            start: 0,
            stop: 0,
            at: 0.0,
        }
    }

    pub fn schedule(&mut self, start: f64, stop: f64, rate: f64) {
        self.start = frame_at(start, rate);
        self.stop = frame_at(stop, rate);
        self.at = start * rate;
        self.index = 0.0;
    }

    pub fn start_frame(&self) -> u64 {
        self.start
    }

    /// Where a steady wave starts, in the block it starts in: where it
    /// would have been at its first sample had it begun on its start time,
    /// between frames. Not in the very first block a context renders.
    fn lead(&mut self, f: f32, rate_scale: f32) {
        if self.start >= QUANTUM as u64 {
            let first = self.start + u64::from(self.at > self.start as f64);
            self.index = (first as f64 - self.at) * f as f64 * rate_scale as f64;
        }
    }

    pub fn stop_frame(&self) -> u64 {
        self.stop
    }

    /// Render the block from frame `block` into `out` (every sample written,
    /// zero where it does not play). Returns the range it played in.
    pub fn render(
        &mut self,
        block: u64,
        wave: &Wave,
        pitch: &Pitch,
        rate: f32,
        out: &mut [f32; QUANTUM],
    ) -> (usize, usize) {
        out.fill(0.0);
        let end = block + QUANTUM as u64;
        let first = self.start >= block && self.start < end;
        // A start a hair past its frame (see `frame_at`) starts on that
        // frame but writes nothing there: the wave begins on the next.
        let skip = u64::from(first && self.at > self.start as f64);
        let lo = self.start.max(block) + skip;
        let hi = self.stop.min(end);
        let size = wave.size() as f64;
        let nyquist = rate / 2.0;
        let rate_scale = wave.rate_scale();
        if lo >= hi {
            // Started on a block's last frame, a hair past it: Chromium
            // still sets the wave's place in this block, at its pitch here.
            if skip == 1
                && lo == end
                && let Pitch::Steady { freq, detune } = pitch
            {
                self.lead(within(freq * (detune / 1200.0).exp2(), nyquist), rate_scale);
            }
            return (0, 0);
        }
        let (lo, hi) = ((lo - block) as usize, (hi - block) as usize);
        let n = hi - lo;
        match pitch {
            Pitch::Steady { freq, detune } => {
                let f = within(freq * (detune / 1200.0).exp2(), nyquist);
                let incr = f * rate_scale;
                if first {
                    self.lead(f, rate_scale);
                }
                let pick = wave.pick(f);
                let mut index = self.index;
                for y in out.iter_mut().skip(lo).take(n) {
                    *y = wave.read(index, pick);
                    index = wrap_to(index + incr as f64, size);
                }
                // Chromium moves on by the whole block at once.
                self.index = wrap_to(self.index + (n as f32 * incr) as f64, size);
            }
            Pitch::Moving { freq, detune } => {
                // The step at every frame, as Chromium works it out: the
                // frequencies, times 2^(cents/1200), clamped to the Nyquist
                // frequency, times the table's rate; in 32-bit floats.
                let mut incr = [0.0f32; QUANTUM];
                let mut scale = rate_scale;
                match freq {
                    Part::Moving(f) => incr = **f,
                    Part::Steady(f) => scale *= *f,
                }
                match detune {
                    Part::Moving(d) => {
                        let k = (1.0f64 / 1200.0) as f32;
                        let moving = matches!(freq, Part::Moving(_));
                        for (i, c) in incr.iter_mut().zip(d.iter()) {
                            let m = (c * k).exp2();
                            *i = if moving { m * *i } else { m };
                        }
                    }
                    Part::Steady(c) => scale *= (c / 1200.0).exp2(),
                }
                for i in incr.iter_mut() {
                    *i = within(*i, nyquist) * scale;
                }
                // The first block reads its steps from the block's start;
                // see the module notes.
                let shift = if first { lo } else { 0 };
                let inverse = 1.0 / rate_scale;
                let steps = incr.get(lo - shift..hi - shift).unwrap_or(&[]);
                let mut index = self.index;
                for (y, &step) in out.iter_mut().skip(lo).zip(steps) {
                    *y = wave.read(index, wave.pick(inverse * step));
                    index = wrap_to(index + step as f64, size);
                }
                self.index = index;
            }
        }
        (lo, hi)
    }
}

impl TableOsc {
    /// The block from frame `block` at a steady `freq`, as `render` would
    /// play it, without reading the table: only its place in the table
    /// moves. For a host that starts rendering after the oscillator began
    /// (the wobble's LFOs, `master`).
    pub fn skip(&mut self, block: u64, wave: &Wave, freq: f32, rate: f32) {
        let end = block + QUANTUM as u64;
        let first = self.start >= block && self.start < end;
        let skip = u64::from(first && self.at > self.start as f64);
        let lo = self.start.max(block) + skip;
        let hi = self.stop.min(end);
        let f = within(freq, rate / 2.0);
        let rate_scale = wave.rate_scale();
        if lo >= hi {
            if skip == 1 && lo == end {
                self.lead(f, rate_scale);
            }
            return;
        }
        if first {
            self.lead(f, rate_scale);
        }
        let n = (hi - lo) as f32;
        self.index = wrap_to(self.index + (n * (f * rate_scale)) as f64, wave.size() as f64);
    }
}

impl Default for TableOsc {
    fn default() -> Self {
        Self::new()
    }
}

/// `f` held within plus or minus `limit`. Not `f32::clamp`, which checks
/// its bounds and would bring the panic machinery into the `.wasm`.
fn within(f: f32, limit: f32) -> f32 {
    f.max(-limit).min(limit)
}

fn wrap_to(index: f64, size: f64) -> f64 {
    index - (index / size).floor() * size
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wave::{Fft, Waves};

    const RATE: f64 = 44100.0;

    // The waves are 1.8 MB, built on a thread with room for them.
    fn waves() -> Box<Waves> {
        std::thread::Builder::new()
            .stack_size(1 << 26)
            .spawn(|| {
                let mut w = Box::new(Waves::new());
                w.build(RATE as f32, &mut Box::new(Fft::new()));
                w
            })
            .and_then(|t| t.join().map_err(|_| std::io::Error::other("panicked")))
            .expect("waves")
    }

    // A sine through the table: Chromium's own interpolation error is
    // about 1e-5 at most, so that is the tolerance here.
    fn sine(phase: f64) -> f32 {
        (phase * core::f64::consts::TAU).sin() as f32
    }

    fn run(
        osc: &mut TableOsc,
        w: &Waves,
        freq: impl Fn(u64) -> f32,
        moving: bool,
        frames: usize,
    ) -> Vec<f32> {
        let mut all = Vec::new();
        let mut block = 0u64;
        while all.len() < frames {
            let mut f = [0.0; QUANTUM];
            for (i, v) in f.iter_mut().enumerate() {
                *v = freq(block + i as u64);
            }
            let mut out = [0.0; QUANTUM];
            let pitch = if moving {
                Pitch::Moving {
                    freq: Part::Moving(&f),
                    detune: Part::Steady(0.0),
                }
            } else {
                Pitch::Steady {
                    freq: f[0],
                    detune: 0.0,
                }
            };
            osc.render(block, &w.sine, &pitch, RATE as f32, &mut out);
            all.extend_from_slice(&out);
            block += QUANTUM as u64;
        }
        all
    }

    #[test]
    fn starts_and_stops_on_the_next_whole_frame() {
        let w = waves();
        let mut osc = TableOsc::new();
        // Inside the first block, so no lead.
        osc.schedule(100.37 / RATE, 3000.6 / RATE, RATE);
        let out = run(&mut osc, &w, |_| 1000.0, false, 4096);
        assert_eq!(out[100], 0.0);
        assert!(out[101].abs() < 1e-6); // the top of the table
        assert!((out[102] - sine(1000.0 / RATE)).abs() < 1e-5);
        assert!(out[3000] != 0.0);
        assert_eq!(out[3001], 0.0);
    }

    #[test]
    fn a_hair_past_a_frame_is_that_frame() {
        let w = waves();
        let mut osc = TableOsc::new();
        // Starts on frame 1000 but plays from 1001, as it would have from
        // 1000.0003; stops on frame 3000, which it does not play.
        osc.schedule(1000.0003 / RATE, 3000.0003 / RATE, RATE);
        assert_eq!(osc.start_frame(), 1000);
        assert_eq!(osc.stop_frame(), 3000);
        let out = run(&mut osc, &w, |_| 1000.0, false, 4096);
        assert_eq!(out[1000], 0.0);
        assert!((out[1001] - sine(1000.0 * 0.9997 / RATE)).abs() < 1e-5);
        assert!(out[2999] != 0.0);
        assert_eq!(out[3000], 0.0);
    }

    #[test]
    fn a_start_on_a_blocks_last_frame_takes_that_blocks_pitch() {
        let w = waves();
        let mut osc = TableOsc::new();
        // Frame 1023 is the last of the block 896..1024: the note starts
        // there and sounds from 1024, from where 1000 Hz (that block's
        // pitch, not the next one's) would have put it.
        osc.schedule(1023.0003 / RATE, 1.0, RATE);
        let out = run(
            &mut osc,
            &w,
            |k| if k >= 1024 { 2000.0 } else { 1000.0 },
            false,
            2048,
        );
        assert_eq!(out[1023], 0.0);
        assert!((out[1024] - sine(1000.0 * 0.9997 / RATE)).abs() < 1e-5);
    }

    #[test]
    fn a_steady_pitch_starts_where_it_would_have_been() {
        let w = waves();
        let mut osc = TableOsc::new();
        osc.schedule(1000.3 / RATE, 1.0, RATE);
        let out = run(&mut osc, &w, |_| 1000.0, false, 2048);
        assert!((out[1001] - sine(1000.0 * 0.7 / RATE)).abs() < 1e-5);
    }

    #[test]
    fn a_moving_pitch_reads_its_first_block_from_the_block_start() {
        let w = waves();
        let mut osc = TableOsc::new();
        osc.schedule(1000.3 / RATE, 1.0, RATE);
        // 440 until frame 1001, 110 after: the first block (896..1024)
        // reads frames 896.. for its 23 samples, all of them 440.
        let out = run(
            &mut osc,
            &w,
            |k| if k >= 1001 { 110.0 } else { 440.0 },
            true,
            2048,
        );
        let mut phase = 0.0f64;
        for k in 1001..1100u64 {
            assert!((out[k as usize] - sine(phase)).abs() < 1e-5, "frame {k}");
            phase += if k < 1024 { 440.0 } else { 110.0 } / RATE;
        }
    }
}
