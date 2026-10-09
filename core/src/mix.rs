//! The mixing stage: the synth's five channels, their reverb and echo
//! sends, the kick's duck, the echo, the reverb and the tails, summed into
//! the bus that feeds the master chain (queue item 29). The graph is
//! `_build()` in synth.js, node for node:
//!
//! ```text
//! channel gain ─┬─ drums ───────────────────────────────┐
//!               ├─ the rest ─ pumpBus (duck) ──────────────┤
//!               ├─ verb send ─ reverbIn ─ six combs (three on lite)
//!               │     ─ combSum ─ reverbOut ─ preDelay ─┐   │
//!               └─ echo send ─ echoIn ─ echo ─ echoTone ─ tails ─ preBus
//!                                  └─ echoFb ─┘
//! ```
//!
//! Each comb is a delay with a lowpass and a gain in its feedback; its
//! output, taken before the lowpass, is what combSum sums. The echo's
//! feedback is taken after its lowpass.
//!
//! **The loops, as Chromium renders them.** A node renders once a block,
//! and one pulled again while it is rendering hands over the block it
//! rendered last (`AudioHandler::ProcessIfNecessary`). A comb is reached
//! through its delay, the only node of the loop anything outside pulls: the
//! delay pulls its feedback gain, which pulls the lowpass, which finds the
//! delay mid-render and filters the delay's last block. The echo is reached
//! through its lowpass (tails pulls it): the lowpass pulls the delay, the
//! delay pulls the feedback gain, and the gain finds the lowpass mid-render
//! and takes its last block. So each loop goes round a block (128 frames)
//! later than its delay alone, and here each keeps its last block for the
//! next, in the same place.
//!
//! **The parameters** are `Timeline`s, Chromium's AudioParam timeline, and
//! the delays `Delay`s, Chromium's delay line; the lowpasses are the same
//! `Biquad` the voices use. Gains that never move are plain numbers, each a
//! 32-bit float as the node holds it. Where several signals meet at one node
//! Chromium does not fix the order it adds them in, so sums here can differ
//! in the last bit.

use crate::delay::{Delay, buffer_len};
use crate::filter::{Biquad, Kind};
use crate::timeline::Timeline;
use crate::{BASS_CHANNEL, CHANNELS, CHORDS, DRUMS_CHANNEL, MELODY, QUANTUM, TEXTURE_CHANNEL};

type Block = [f32; QUANTUM];

/// The highest sample rate the mix holds its delays for. A host at a
/// higher rate gets no mix (`Mix::ready`).
pub const MAX_RATE: f64 = 96000.0;

// The longest delay each line is made for, in seconds (`createDelay`).
const COMB_MAX: f64 = 0.5;
const PRE_DELAY_MAX: f64 = 0.2;
const ECHO_MAX: f64 = 2.0;

/// The delay lines' memory: six combs, the pre-delay and the echo, at
/// `MAX_RATE`, a block longer each (`delay::buffer_len`). All zeros, so it
/// costs nothing in the `.wasm`.
pub const MEMORY: usize = 6 * (QUANTUM + 48000) + (QUANTUM + 19200) + (QUANTUM + 192000);

/// The channels' gains, sends and order, in the core's channel numbers
/// (`MELODY` and the rest), as `_build()` sets them.
const GAIN: [f64; CHANNELS] = [0.58, 0.44, 0.62, 0.5, 0.82];
const VERB: [f64; CHANNELS] = [0.28, 0.35, 0.05, 0.6, 0.1];
const ECHO: [f64; CHANNELS] = [0.12, 0.15, 0.0, 0.25, 0.05];
/// The order `_build()` makes the channels in; sums run in it.
const ORDER: [u32; CHANNELS] = [DRUMS_CHANNEL, BASS_CHANNEL, CHORDS, MELODY, TEXTURE_CHANNEL];
/// The channels the duck presses: all but the drums.
const PUMPED: [u32; 4] = [BASS_CHANNEL, CHORDS, MELODY, TEXTURE_CHANNEL];

const COMB_TIMES_FULL: [f64; 6] = [0.0297, 0.0371, 0.0411, 0.0437, 0.0503, 0.0577];
const COMB_TIMES_LITE: [f64; 3] = [0.0297, 0.0411, 0.0503];
const COMB_FEEDBACK: f64 = 0.8;
const COMB_LOWPASS: f64 = 2400.0;
const REVERB_OUT: f64 = 0.8;
const PRE_DELAY: f64 = 0.02;
const ECHO_TIME: f64 = 0.36;
const ECHO_FEEDBACK: f64 = 0.34;
const ECHO_LOWPASS: f64 = 2000.0;
/// A BiquadFilterNode's Q, untouched.
const Q: f32 = 1.0;

/// The parameters a host can move, by number (`Core::param`). Each is one
/// AudioParam of synth.js, or, for the combs, the same one of each comb,
/// which `setTone` always moves together.
pub const GAINS: u32 = 0; // to 4: each channel's gain, by channel number
pub const PUMP: u32 = 5;
pub const TAILS: u32 = 6;
pub const ECHO_DELAY: u32 = 7;
pub const COMB_FB: u32 = 8;
pub const COMB_FREQ: u32 = 9;
pub const COMB_SUM: u32 = 10;
pub const REVERB_GAIN: u32 = 11;
/// The last of the mix's parameters; the master chain's follow
/// (`master`), numbered by the core (`TONE_FREQ` and the rest in lib.rs).
pub const LAST_PARAM: u32 = REVERB_GAIN;

/// How a parameter is moved: the AudioParam call.
pub const SET: u32 = 0;
pub const LINEAR: u32 = 1;
pub const TARGET: u32 = 2;
pub const CANCEL: u32 = 3;

// Events each parameter holds at once. The duck takes two for every kick,
// and the measure harness schedules a whole render ahead -- up to seventy
// seconds of kicks.
const PUMP_EVENTS: usize = 2048;
const TAIL_EVENTS: usize = 256;
const EVENTS: usize = 64;

const fn f(x: f64) -> f32 {
    x as f32
}

pub struct Mix {
    rate: f64,
    ready: bool,
    combs: usize,
    gains: [Timeline<EVENTS>; CHANNELS],
    pump: Timeline<PUMP_EVENTS>,
    tails: Timeline<TAIL_EVENTS>,
    echo_time: Timeline<EVENTS>,
    comb_fb: Timeline<EVENTS>,
    comb_freq: Timeline<EVENTS>,
    comb_sum: Timeline<EVENTS>,
    reverb_out: Timeline<EVENTS>,
    comb_delays: [Delay; 6],
    comb_times: [f32; 6],
    comb_lps: [Biquad; 6],
    /// Each comb's delay output from the block before: what its lowpass
    /// filters this block.
    comb_last: [Block; 6],
    pre_delay: Delay,
    echo: Delay,
    echo_lp: Biquad,
    /// The echo's lowpass output from the block before: what its feedback
    /// takes this block.
    echo_last: Block,
    memory: [f32; MEMORY],
    bus: Block,
}

impl Mix {
    /// An empty mix, all zeros (so a core in a static costs nothing in
    /// the `.wasm`); `init` builds it.
    pub const fn new() -> Self {
        Mix {
            rate: 0.0,
            ready: false,
            combs: 0,
            gains: [const { Timeline::new(0.0, 0.0, 0.0) }; CHANNELS],
            pump: Timeline::new(0.0, 0.0, 0.0),
            tails: Timeline::new(0.0, 0.0, 0.0),
            echo_time: Timeline::new(0.0, 0.0, 0.0),
            comb_fb: Timeline::new(0.0, 0.0, 0.0),
            comb_freq: Timeline::new(0.0, 0.0, 0.0),
            comb_sum: Timeline::new(0.0, 0.0, 0.0),
            reverb_out: Timeline::new(0.0, 0.0, 0.0),
            comb_delays: [const { Delay::new() }; 6],
            comb_times: [0.0; 6],
            comb_lps: [const { Biquad::new() }; 6],
            comb_last: [[0.0; QUANTUM]; 6],
            pre_delay: Delay::new(),
            echo: Delay::new(),
            echo_lp: Biquad::new(),
            echo_last: [0.0; QUANTUM],
            memory: [0.0; MEMORY],
            bus: [0.0; QUANTUM],
        }
    }

    /// Build the graph as `_build()` does at `rate`: six combs on full
    /// quality, three on lite. Everything starts silent.
    pub fn init(&mut self, rate: f64, full: bool) {
        self.rate = rate;
        self.ready = rate > 0.0 && rate <= MAX_RATE;
        let nyquist = f(rate / 2.0);
        let any = (f32::MIN, f32::MAX);
        for (g, &base) in self.gains.iter_mut().zip(GAIN.iter()) {
            g.configure(f(base), any.0, any.1);
        }
        self.pump.configure(1.0, any.0, any.1);
        self.tails.configure(1.0, any.0, any.1);
        self.echo_time.configure(f(ECHO_TIME), 0.0, f(ECHO_MAX));
        self.comb_fb.configure(f(COMB_FEEDBACK), any.0, any.1);
        self.comb_freq.configure(f(COMB_LOWPASS), 0.0, nyquist);
        let times: &[f64] = if full {
            &COMB_TIMES_FULL
        } else {
            &COMB_TIMES_LITE
        };
        self.combs = times.len();
        self.comb_sum
            .configure(f(0.2 / times.len() as f64), any.0, any.1);
        self.reverb_out.configure(f(REVERB_OUT), any.0, any.1);
        let mut at = 0;
        for ((d, t), &time) in self
            .comb_delays
            .iter_mut()
            .zip(self.comb_times.iter_mut())
            .zip(times.iter())
        {
            at = d.place(COMB_MAX, rate, at);
            *t = f(time).max(0.0).min(d.max);
        }
        at = self.pre_delay.place(PRE_DELAY_MAX, rate, at);
        at = self.echo.place(ECHO_MAX, rate, at);
        if at > MEMORY {
            self.ready = false;
        }
        for lp in self.comb_lps.iter_mut() {
            lp.reset();
        }
        self.echo_lp.reset();
        self.echo_lp
            .set(Kind::Lowpass, f(ECHO_LOWPASS), Q, 0.0, f(rate));
        self.comb_last = [[0.0; QUANTUM]; 6];
        self.echo_last = [0.0; QUANTUM];
        self.memory.fill(0.0);
        self.bus = [0.0; QUANTUM];
    }

    /// The last block's bus.
    pub fn bus(&self) -> &Block {
        &self.bus
    }

    /// Whether the mix can play at this rate (`MAX_RATE`).
    pub fn ready(&self) -> bool {
        self.ready
    }

    /// Move a parameter (`GAINS` and the rest) by `op` (`SET`, `LINEAR`,
    /// `TARGET`, `CANCEL`), as the AudioParam call of the same name: to
    /// `value`, at `time`, with time constant `tau` for a target. `now` is
    /// the host's current time. False if there is no such parameter or it
    /// is full.
    pub fn param(&mut self, id: u32, op: u32, value: f32, time: f64, tau: f64, now: f64) -> bool {
        match id {
            GAINS..=4 => match self.gains.get_mut(id as usize) {
                Some(t) => apply(t, op, value, time, tau, now),
                None => false,
            },
            PUMP => apply(&mut self.pump, op, value, time, tau, now),
            TAILS => apply(&mut self.tails, op, value, time, tau, now),
            ECHO_DELAY => apply(&mut self.echo_time, op, value, time, tau, now),
            COMB_FB => apply(&mut self.comb_fb, op, value, time, tau, now),
            COMB_FREQ => apply(&mut self.comb_freq, op, value, time, tau, now),
            COMB_SUM => apply(&mut self.comb_sum, op, value, time, tau, now),
            REVERB_GAIN => apply(&mut self.reverb_out, op, value, time, tau, now),
            _ => false,
        }
    }

    /// One block: the channels, as the voices and the host left them, in;
    /// the bus out.
    pub fn process(&mut self, block: u64, channels: &[Block; CHANNELS]) -> &Block {
        if !self.ready {
            self.bus.fill(0.0);
            return &self.bus;
        }
        let rate = self.rate;
        let r32 = f(rate);
        let mut g = [0.0f32; QUANTUM];

        // Each channel through its gain.
        let mut outs = [[0.0f32; QUANTUM]; CHANNELS];
        for ((out, input), gain) in outs.iter_mut().zip(channels.iter()).zip(self.gains.iter_mut()) {
            gain.fill(block, rate, &mut g);
            for ((y, &x), &k) in out.iter_mut().zip(input.iter()).zip(g.iter()) {
                *y = x * k;
            }
        }
        let at = |c: u32| outs.get(c as usize).copied().unwrap_or([0.0; QUANTUM]);

        // The sends, each a gain, summed into reverbIn and echoIn; the
        // pump bus, the four channels the duck presses.
        let mut verb_in = [0.0f32; QUANTUM];
        let mut echo_in = [0.0f32; QUANTUM];
        for &c in ORDER.iter() {
            let ch = at(c);
            let send = |sends: &[f64; CHANNELS]| f(sends.get(c as usize).copied().unwrap_or(0.0));
            let (verb, echo) = (send(&VERB), send(&ECHO));
            for i in 0..QUANTUM {
                verb_in[i] += ch[i] * verb;
                echo_in[i] += ch[i] * echo;
            }
        }
        let mut pumped = [0.0f32; QUANTUM];
        for &c in PUMPED.iter() {
            let ch = at(c);
            for (y, &x) in pumped.iter_mut().zip(ch.iter()) {
                *y += x;
            }
        }
        self.pump.fill(block, rate, &mut g);
        for (y, &k) in pumped.iter_mut().zip(g.iter()) {
            *y *= k;
        }

        // The combs. The lowpass filters the delay's last block, its gain
        // feeds that back beside reverbIn, and the delay renders.
        let n = self.combs;
        let mut fb = [0.0f32; QUANTUM];
        let mut freq = [0.0f32; QUANTUM];
        self.comb_fb.fill(block, rate, &mut fb);
        self.comb_freq.fill(block, rate, &mut freq);
        let mut into = [[0.0f32; QUANTUM]; 6];
        for i in 0..QUANTUM {
            let (first, rest) = self.comb_lps.split_at_mut(1);
            let Some(lead) = first.first_mut() else { break };
            lead.set(Kind::Lowpass, freq[i], Q, 0.0, r32);
            let (verb, gain) = (verb_in[i], fb[i]);
            if let (Some(last), Some(y)) = (self.comb_last.first(), into.first_mut()) {
                y[i] = verb + lead.step(last[i]) * gain;
            }
            for ((lp, last), y) in rest
                .iter_mut()
                .zip(self.comb_last.iter().skip(1))
                .zip(into.iter_mut().skip(1))
                .take(n.saturating_sub(1))
            {
                lp.follow(lead);
                y[i] = verb + lp.step(last[i]) * gain;
            }
        }
        let mut comb_sum = [0.0f32; QUANTUM];
        for ((((lp, delay), &time), last), input) in self
            .comb_lps
            .iter_mut()
            .zip(self.comb_delays.iter_mut())
            .zip(self.comb_times.iter())
            .zip(self.comb_last.iter_mut())
            .zip(into.iter())
            .take(n)
        {
            lp.flush();
            let times = [time; QUANTUM];
            delay.process(&mut self.memory, input, &times, r32, last);
            for (y, &x) in comb_sum.iter_mut().zip(last.iter()) {
                *y += x;
            }
        }
        self.comb_sum.fill(block, rate, &mut g);
        for (y, &k) in comb_sum.iter_mut().zip(g.iter()) {
            *y *= k;
        }
        self.reverb_out.fill(block, rate, &mut g);
        for (y, &k) in comb_sum.iter_mut().zip(g.iter()) {
            *y *= k;
        }
        let mut pre = [0.0f32; QUANTUM];
        let pre_times = [f(PRE_DELAY); QUANTUM];
        self.pre_delay
            .process(&mut self.memory, &comb_sum, &pre_times, r32, &mut pre);

        // The echo. Its feedback takes the lowpass's last block, beside
        // echoIn; the delay renders, and the lowpass after it.
        let feedback = f(ECHO_FEEDBACK);
        let mut into_echo = [0.0f32; QUANTUM];
        for ((y, &x), &last) in into_echo.iter_mut().zip(echo_in.iter()).zip(self.echo_last.iter()) {
            *y = x + last * feedback;
        }
        self.echo_time.fill(block, rate, &mut g);
        let mut echoed = [0.0f32; QUANTUM];
        self.echo
            .process(&mut self.memory, &into_echo, &g, r32, &mut echoed);
        for (y, &x) in self.echo_last.iter_mut().zip(echoed.iter()) {
            *y = self.echo_lp.step(x);
        }
        self.echo_lp.flush();

        // Both tails through one gain, and onto the bus with the rest.
        self.tails.fill(block, rate, &mut g);
        let drums = at(DRUMS_CHANNEL);
        for i in 0..QUANTUM {
            let tails = (pre[i] + self.echo_last[i]) * g[i];
            self.bus[i] = tails + pumped[i] + drums[i];
        }
        &self.bus
    }
}

pub(crate) fn apply<const N: usize>(
    t: &mut Timeline<N>,
    op: u32,
    value: f32,
    time: f64,
    tau: f64,
    now: f64,
) -> bool {
    match op {
        SET => t.set_value_at_time(value, time, now),
        LINEAR => t.linear_ramp_to_value_at_time(value, time, now),
        TARGET => t.set_target_at_time(value, time, tau, now),
        CANCEL => {
            t.cancel_scheduled_values(time, now);
            true
        }
        _ => false,
    }
}

impl Default for Mix {
    fn default() -> Self {
        Self::new()
    }
}

/// The memory the mix needs at `rate`, for a host checking ahead.
pub fn memory_for(rate: f64, full: bool) -> usize {
    let combs = if full { 6 } else { 3 };
    combs * buffer_len(COMB_MAX, rate) + buffer_len(PRE_DELAY_MAX, rate) + buffer_len(ECHO_MAX, rate)
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: f64 = 44100.0;

    fn boxed(full: bool) -> Box<Mix> {
        std::thread::Builder::new()
            .stack_size(1 << 25)
            .spawn(move || {
                let mut m = Box::new(Mix::new());
                m.init(RATE, full);
                m
            })
            .and_then(|t| t.join().map_err(|_| std::io::Error::other("panicked")))
            .expect("mix")
    }

    #[test]
    fn the_memory_holds_every_line_at_the_highest_rate() {
        assert_eq!(memory_for(MAX_RATE, true), MEMORY);
        assert!(memory_for(44100.0, true) < MEMORY);
    }

    #[test]
    fn a_drum_impulse_reaches_the_bus_at_its_gain_then_the_tails_follow() {
        let mut m = boxed(true);
        let mut ch = [[0.0f32; QUANTUM]; CHANNELS];
        ch[DRUMS_CHANNEL as usize][10] = 1.0;
        let first = *m.process(0, &ch);
        assert_eq!(first[10], f(0.82));
        assert!(first[..10].iter().all(|&x| x == 0.0));
        let silent = [[0.0f32; QUANTUM]; CHANNELS];
        // The reverb arrives after its shortest comb and the pre-delay, about
        // 0.05 s; the echo after 0.36 s and a block.
        let mut energy = 0.0f32;
        for b in 1..200 {
            energy += m.process(b * QUANTUM as u64, &silent).iter().map(|x| x * x).sum::<f32>();
        }
        assert!(energy > 1e-4, "{energy}");
    }

    #[test]
    fn a_muted_channel_falls_silent() {
        let mut m = boxed(false);
        assert!(m.param(GAINS + MELODY, TARGET, 0.0, 0.0, 0.03, 0.0));
        let ch = [[1.0f32; QUANTUM]; CHANNELS];
        let mut melody_only = [[0.0f32; QUANTUM]; CHANNELS];
        melody_only[MELODY as usize] = ch[0];
        let mut last = 1.0;
        for b in 0..200 {
            last = m.process(b * QUANTUM as u64, &melody_only)[QUANTUM - 1];
        }
        // Only the tails of what came before are left, and fading.
        assert!(last.abs() < 0.05, "{last}");
    }

    #[test]
    fn unknown_parameters_and_calls_are_refused() {
        let mut m = boxed(true);
        assert!(!m.param(LAST_PARAM + 1, SET, 1.0, 0.0, 0.0, 0.0));
        assert!(!m.param(PUMP, 9, 1.0, 0.0, 0.0, 0.0));
    }

    #[test]
    fn too_high_a_rate_has_no_mix() {
        let mut m = boxed(true);
        m.init(192000.0, true);
        assert!(!m.ready());
        let ch = [[1.0f32; QUANTUM]; CHANNELS];
        assert!(m.process(0, &ch).iter().all(|&x| x == 0.0));
    }
}
