//! A sine oscillator that starts, runs and stops the way a Web Audio
//! `OscillatorNode` does in Chromium, measured rather than read off the
//! spec. The JavaScript synth is the reference, and these are the places
//! a plain sine would not null against it:
//!
//! - **Start and stop** land on whole sample frames: the first frame at or
//!   after the start time, and the stop time likewise. The phase starts at
//!   zero and moves on after each sample, by the frequency at that sample.
//! - **The fraction of a frame.** A note rarely starts on a frame. When the
//!   oscillator's frequency is steady in the render block it starts in
//!   (nothing automated, nothing connected to it), Chromium starts the
//!   phase where it would have been at that frame had the note begun
//!   between frames. Not in the very first block a context renders, and
//!   not when the frequency moves (below): there the phase starts at zero.
//! - **The first block of a moving frequency.** When the frequency moves
//!   in the block the note starts in (something is connected to it, as FM
//!   is, or it has an automation event at or after the block's start), the
//!   block reads its frequencies from the start of the
//!   block rather than from the note's first frame: the note's first
//!   sample takes the block's first frequency, and so on. So a frequency
//!   set at the note's start time does not reach it until a block later,
//!   and the oscillator runs at whatever came before -- an automated
//!   frequency's intrinsic value, or an FM carrier's own pitch with no
//!   modulation -- for up to a block. That is in every JavaScript note
//!   today, so it is here too. From the next block on, frames line up.
//!
//! Blocks are Web Audio's render quantum, `QUANTUM` frames, on frame
//! numbers that are multiples of it: the host hands every block to the
//! core in order, and these rules are counted from frame 0.

use crate::QUANTUM;

pub struct Sine {
    /// In cycles, kept in [0, 1).
    phase: f64,
    /// The first frame it plays, and the first it no longer does.
    start: u64,
    stop: u64,
    /// The start time, in frames: how far into its first frame the note
    /// already is decides where a steady frequency's phase starts.
    at: f64,
}

/// The first frame at or after `time` seconds.
pub fn frame_at(time: f64, rate: f64) -> u64 {
    let f = (time * rate).ceil();
    if f > 0.0 { f as u64 } else { 0 }
}

impl Sine {
    pub const fn new() -> Self {
        Sine {
            phase: 0.0,
            start: 0,
            stop: 0,
            at: 0.0,
        }
    }

    /// Start at `start` and stop at `stop` seconds.
    pub fn schedule(&mut self, start: f64, stop: f64, rate: f64) {
        self.start = frame_at(start, rate);
        self.stop = frame_at(stop, rate);
        self.at = start * rate;
        self.phase = 0.0;
    }

    pub fn start_frame(&self) -> u64 {
        self.start
    }

    pub fn stop_frame(&self) -> u64 {
        self.stop
    }

    /// Render the block of frames from `block`, given the frequency, in Hz,
    /// at each of its frames, and whether it moves in this block (only the
    /// block the note starts in asks). Writes every sample of `out`: the
    /// sine where it plays, zero elsewhere. Returns the range of `out` it
    /// played in.
    pub fn render(
        &mut self,
        block: u64,
        freq: &[f32; QUANTUM],
        moving: bool,
        rate: f64,
        out: &mut [f32; QUANTUM],
    ) -> (usize, usize) {
        out.fill(0.0);
        let end = block + QUANTUM as u64;
        let lo = self.start.max(block);
        let hi = self.stop.min(end);
        if lo >= hi {
            return (0, 0);
        }
        let first = self.start >= block;
        let (lo, hi) = ((lo - block) as usize, (hi - block) as usize);
        // Where this block reads its frequencies from: frame for frame, or,
        // in the first block of a moving frequency, from the block's start.
        let shift = if first && moving { lo } else { 0 };
        if first {
            let lead = if moving || self.start < QUANTUM as u64 {
                0.0
            } else {
                self.start as f64 - self.at
            };
            let f = freq.get(lo - shift).copied().unwrap_or(0.0) as f64;
            self.phase = wrap(lead * f / rate);
        }
        let reads = freq.get(lo - shift..hi - shift).unwrap_or(&[]);
        let writes = out.get_mut(lo..hi).unwrap_or(&mut []);
        for (y, &f) in writes.iter_mut().zip(reads) {
            *y = (self.phase * core::f64::consts::TAU).sin() as f32;
            self.phase = wrap(self.phase + f as f64 / rate);
        }
        (lo, hi)
    }
}

impl Default for Sine {
    fn default() -> Self {
        Self::new()
    }
}

fn wrap(phase: f64) -> f64 {
    phase - phase.floor()
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: f64 = 44100.0;

    fn run(osc: &mut Sine, freq: impl Fn(u64) -> f32, moving: bool, frames: usize) -> Vec<f32> {
        let mut all = Vec::new();
        let mut block = 0u64;
        while all.len() < frames {
            let mut f = [0.0; QUANTUM];
            for (i, v) in f.iter_mut().enumerate() {
                *v = freq(block + i as u64);
            }
            let mut out = [0.0; QUANTUM];
            osc.render(block, &f, moving, RATE, &mut out);
            all.extend_from_slice(&out);
            block += QUANTUM as u64;
        }
        all
    }

    #[test]
    fn starts_and_stops_on_the_next_whole_frame() {
        let mut osc = Sine::new();
        // Inside the first block, so no lead.
        osc.schedule(100.37 / RATE, 3000.6 / RATE, RATE);
        let out = run(&mut osc, |_| 1000.0, false, 4096);
        assert_eq!(out[100], 0.0);
        assert_eq!(out[101], 0.0); // sin(0)
        let step = (core::f64::consts::TAU * 1000.0 / RATE).sin() as f32;
        assert!((out[102] - step).abs() < 1e-6);
        assert!(out[3000] != 0.0);
        assert_eq!(out[3001], 0.0);
    }

    #[test]
    fn a_steady_frequency_starts_where_it_would_have_been() {
        let mut osc = Sine::new();
        osc.schedule(1000.3 / RATE, 1.0, RATE);
        let out = run(&mut osc, |_| 1000.0, false, 2048);
        let want = (core::f64::consts::TAU * 1000.0 * 0.7 / RATE).sin() as f32;
        assert!((out[1001] - want).abs() < 1e-6);
    }

    #[test]
    fn a_moving_frequency_reads_its_first_block_from_the_block_start() {
        let mut osc = Sine::new();
        osc.schedule(1000.3 / RATE, 1.0, RATE);
        // 440 until frame 1001, 110 after: the first block (896..1024)
        // reads frames 896.. for its 23 samples, all of them 440.
        let out = run(
            &mut osc,
            |k| if k >= 1001 { 110.0 } else { 440.0 },
            true,
            2048,
        );
        let mut phase = 0.0f64;
        for k in 1001..1100u64 {
            let want = (phase * core::f64::consts::TAU).sin() as f32;
            assert!((out[k as usize] - want).abs() < 1e-6, "frame {k}");
            phase += if k < 1024 { 440.0 } else { 110.0 } / RATE;
        }
    }
}
