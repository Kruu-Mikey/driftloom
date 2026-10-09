//! A delay line that delays the way a Web Audio `DelayNode` does in
//! Chromium (`delay.cc`, `delay_sse2.cc`, Chromium 141), for the mix.
//!
//! - **The buffer** is one render quantum longer than the longest delay the
//!   node was made for, `maxDelayTime` in frames rounded up
//!   (`BufferLengthForDelay`). Each block is written into it first, then
//!   read, so a delay shorter than a block reads what was just written.
//! - **Every block reads its delay frame by frame.** `delayTime` is an
//!   audio-rate parameter by default, so Chromium takes the a-rate path even
//!   when nothing moves it, and on x86 that path is the SSE loop: the delay
//!   in frames, the read position and the blend between the two samples
//!   either side are all 32-bit floats. The read position is the write
//!   position plus the buffer's length less the delay, so where it lands --
//!   and the blend with it -- depends on where in the buffer the write
//!   position is, which is the number of blocks the node has rendered.
//! - **Cycles.** Chromium adds no delay of its own to a cycle. Each node
//!   renders once a block; a node pulled again while it is rendering hands
//!   over what it rendered the block before. So a feedback loop through a
//!   delay runs a block (128 frames) longer than the delay, in whichever
//!   node of the loop is reached second. The mix builds its loops that way.
//!
//! The samples live in a buffer the caller owns (`mix::Mix`), so a delay is
//! a few numbers and the memory is all in one place.

use crate::QUANTUM;

/// `TimeToSampleFrame(time, rate, kRoundUp)`: the time in frames, to
/// 1/1024 of one, then up to a whole frame.
pub fn frames_up(time: f64, rate: f64) -> usize {
    let f = ((time * rate * 1024.0).round() / 1024.0).ceil();
    if f > 0.0 { f as usize } else { 0 }
}

/// The buffer a delay made for `max` seconds needs at `rate`.
pub fn buffer_len(max: f64, rate: f64) -> usize {
    QUANTUM + frames_up(max, rate)
}

#[derive(Clone, Copy)]
pub struct Delay {
    /// The longest delay, as the parameter's 32-bit maximum.
    pub max: f32,
    /// Where its buffer starts in the caller's, and how long it is.
    at: usize,
    len: usize,
    write: usize,
}

impl Delay {
    pub const fn new() -> Self {
        Delay {
            max: 0.0,
            at: 0,
            len: 0,
            write: 0,
        }
    }

    /// A delay of at most `max` seconds, its buffer at `at` in the
    /// caller's. Returns where the next delay's buffer starts.
    pub fn place(&mut self, max: f64, rate: f64, at: usize) -> usize {
        self.max = max as f32;
        self.at = at;
        self.len = buffer_len(max, rate);
        self.write = 0;
        at + self.len
    }

    /// One block: `input` in, delayed by `times` (seconds, one per frame,
    /// already within 0 and `max`), out to `out`. `rate` is the context's,
    /// as Chromium holds it, a 32-bit float.
    pub fn process(
        &mut self,
        memory: &mut [f32],
        input: &[f32; QUANTUM],
        times: &[f32; QUANTUM],
        rate: f32,
        out: &mut [f32; QUANTUM],
    ) {
        let len = self.len;
        let Some(buffer) = memory.get_mut(self.at..self.at + len) else {
            out.fill(0.0);
            return;
        };
        if len < QUANTUM || self.write >= len {
            out.fill(0.0);
            return;
        }
        // CopyToCircularBuffer.
        let first = (len - self.write).min(QUANTUM);
        let Some((head, tail)) = input.split_at_checked(first) else {
            return;
        };
        if let Some(span) = buffer.get_mut(self.write..self.write + first) {
            span.copy_from_slice(head);
        }
        if let Some(span) = buffer.get_mut(..tail.len()) {
            span.copy_from_slice(tail);
        }
        // ProcessARateVector: every frame in 32-bit floats.
        let len_f = len as f32;
        let wrap = |i: usize| if i >= len { i - len } else { i };
        let mut w = self.write;
        for (k, y) in out.iter_mut().enumerate() {
            let wk = wrap(w);
            // `_mm_max_ps(t, 0)` gives 0 for a NaN.
            let t = times[k];
            let t = if t > 0.0 { t } else { 0.0 };
            let desired = t * rate;
            let mut pos = wk as f32 + (len_f - desired);
            if pos >= len_f {
                pos -= len_f;
            }
            let i1 = wrap(pos as usize);
            let i2 = wrap(i1 + 1);
            let f = pos - i1 as f32;
            let s1 = buffer.get(i1).copied().unwrap_or(0.0);
            let s2 = buffer.get(i2).copied().unwrap_or(0.0);
            *y = s1 + f * (s2 - s1);
            w = wk + 1;
        }
        self.write = wrap(self.write + QUANTUM);
    }
}

impl Default for Delay {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buffers_are_a_block_longer_than_the_delay() {
        assert_eq!(buffer_len(0.5, 44100.0), 22178);
        assert_eq!(buffer_len(2.0, 48000.0), 96128);
        assert_eq!(buffer_len(0.2, 44100.0), 8948);
    }

    #[test]
    fn a_whole_frame_delay_moves_an_impulse_by_that_many_frames() {
        let rate = 44100.0f32;
        let mut d = Delay::new();
        let mut memory = vec![0.0f32; buffer_len(0.5, rate as f64)];
        d.place(0.5, rate as f64, 0);
        // 300 frames, as a 32-bit time: lands within a hair of a frame.
        let t = 300.0f32 / rate;
        let times = [t; QUANTUM];
        let mut input = [0.0f32; QUANTUM];
        input[5] = 1.0;
        let mut seen = Vec::new();
        for b in 0..4 {
            let mut out = [0.0f32; QUANTUM];
            d.process(&mut memory, &input, &times, rate, &mut out);
            input = [0.0; QUANTUM];
            for (i, &y) in out.iter().enumerate() {
                if y.abs() > 1e-3 {
                    seen.push((b * QUANTUM + i, y));
                }
            }
        }
        let total: f32 = seen.iter().map(|&(_, y)| y).sum();
        assert!((total - 1.0).abs() < 1e-3, "{seen:?}");
        assert!(seen.iter().all(|&(i, _)| i == 305 || i == 306), "{seen:?}");
    }

    #[test]
    fn a_zero_delay_passes_the_block_straight_through() {
        let rate = 44100.0f32;
        let mut d = Delay::new();
        let mut memory = vec![0.0f32; buffer_len(0.2, rate as f64)];
        d.place(0.2, rate as f64, 0);
        let input: [f32; QUANTUM] = core::array::from_fn(|i| i as f32);
        let mut out = [0.0f32; QUANTUM];
        d.process(&mut memory, &input, &[0.0; QUANTUM], rate, &mut out);
        assert_eq!(out, input);
    }
}
