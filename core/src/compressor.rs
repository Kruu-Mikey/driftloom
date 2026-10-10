//! Chromium's `DynamicsCompressorNode` (queue item 31): the kernel of
//! `dynamics_compressor.cc` (Chromium 141), which the synth's bus
//! compressor (`comp`) and its limiter (`ceiling`) both are.
//!
//! - **The static curve.** Linear up to the threshold, then a knee, an
//!   exponential that leaves the line with its slope matched, and past
//!   `threshold + knee` a constant ratio in decibels. The knee's sharpness
//!   `k` is searched for so the curve's slope at the knee's end is
//!   `1 / ratio` (`KAtSlope`, fifteen halvings of a geometric interval).
//! - **The detector.** Each frame, the loudest channel's level, through the
//!   curve, as an attenuation; the detector falls to a lower one at once
//!   and climbs back to a higher one at a rate that is faster the more the
//!   curve is pressing (`kSatReleaseTime`).
//! - **The envelope.** Every 32 frames the gain the detector asks for is
//!   pre-warped (`asin`), and the compressor's own gain slews towards it:
//!   attacking at a rate set by the largest step asked for so far, or
//!   releasing exponentially at a rate from a fourth-order polynomial in how
//!   far it has to go (the "adaptive release", 0 to -12 dB). Each frame the
//!   gain is warped back through `sin`, and the makeup gain applied.
//! - **The lookahead.** The signal itself is delayed 6 ms (a power-of-two
//!   ring), so the gain arrives before what it is for.
//! - **The makeup gain.** `(1 / curve(1)) ^ 0.6`, applied to everything.
//! - **The metering.** The reduction in decibels, taking peaks at once and
//!   releasing with a time constant of 0.325 s; the node's `reduction`.
//!
//! Detection is linked across channels, as Chromium's is: with `C`
//! channels, one detector reads the loudest of them each frame and one gain
//! goes to all. The synth's graph is mono, and Chromium's compressor runs a
//! mono input as two identical channels, so `C = 1` renders what it does;
//! a stereo host gives it two.
//!
//! Every step is in Chromium's precisions and order of operations: 32-bit
//! floats, with `exp` and `sin` in 64 bits as Chromium calls them, and
//! `asin` and the attack's `pow` in 64 bits rounded to 32 (Chromium's
//! `fdlibm::asinf` and `fdlibm::powf`). `powf` and `log10f` are the
//! platform's, in Chromium and here.
//!
//! The parameters are fixed when the synth builds its nodes and never move,
//! so they are plain numbers here (`set`); Chromium reads each one's value
//! once a block, as this does.

use crate::QUANTUM;

type Block = [f32; QUANTUM];

/// The lookahead's ring (`kMaxPreDelayFrames`).
const RING: usize = 1024;
const MASK: usize = RING - 1;
/// Where the ring starts before the first block sets the lookahead
/// (`kDefaultPreDelayFrames`).
const DEFAULT_PRE_DELAY: usize = 256;
/// The most `settle` plays out: about four seconds at 44.1 kHz (it rests
/// well before).
const SETTLE_BLOCKS: usize = 1400;
/// The lookahead, in seconds (`kPreDelay`).
const PRE_DELAY: f32 = 0.006;
/// Frames per envelope step (`kNumberOfDivisionFrames`).
const DIVISION: usize = 32;
/// The detector's release (`kSatReleaseTime`).
const SAT_RELEASE: f32 = 0.0025;
/// The metering's release (`kMeteringReleaseTimeConstant`).
const METERING_RELEASE: f64 = 0.325;
/// `kPiOverTwoFloat`.
const PI_OVER_TWO: f32 = core::f32::consts::FRAC_PI_2;
/// What a curve parameter holds before it is first worked out
/// (`kUninitializedValue`).
const UNSET: f32 = -1.0;

// The adaptive release's polynomial, through four points: 0.09, 0.16,
// 0.42 and 0.98 of the release time at 0, -5, -10 and -15 dB to go. Folded
// in 32-bit floats, as Chromium's `constexpr float`s are.
const ZONE1: f32 = 0.09;
const ZONE2: f32 = 0.16;
const ZONE3: f32 = 0.42;
const ZONE4: f32 = 0.98;
const A_BASE: f32 = 0.999_999_999_999_999_8_f32 * ZONE1 + 1.843_221_968_432_392_3e-16_f32 * ZONE2
    - 1.937_339_435_167_642_3e-16_f32 * ZONE3
    + 8.824_516_011_816_245e-18_f32 * ZONE4;
const B_BASE: f32 = -1.578_832_035_284_588_8_f32 * ZONE1 + 2.330_583_703_207_428_6_f32 * ZONE2
    - 0.914_119_420_484_042_9_f32 * ZONE3
    + 0.162_367_752_561_203_2_f32 * ZONE4;
const C_BASE: f32 = 0.533_414_286_910_642_4_f32 * ZONE1 - 1.272_736_789_213_631_f32 * ZONE2
    + 0.925_885_604_220_751_2_f32 * ZONE3
    - 0.186_563_101_917_762_26_f32 * ZONE4;
const D_BASE: f32 = 0.087_834_631_382_072_34_f32 * ZONE1 - 0.169_416_296_792_562_2_f32 * ZONE2
    + 0.085_880_579_515_952_72_f32 * ZONE3
    - 0.004_298_914_105_462_83_f32 * ZONE4;
const E_BASE: f32 = -0.042_416_883_008_123_074_f32 * ZONE1 + 0.111_569_382_798_760_2_f32 * ZONE2
    - 0.097_646_763_252_658_72_f32 * ZONE3
    + 0.028_494_263_462_021_576_f32 * ZONE4;

/// A `DynamicsCompressorNode`'s settings: threshold and knee in dB, the
/// ratio, attack and release in seconds.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Settings {
    pub threshold: f32,
    pub knee: f32,
    pub ratio: f32,
    pub attack: f32,
    pub release: f32,
}

// `audio_utilities::DecibelsToLinear` and `LinearToDecibels`.
fn to_linear(db: f32) -> f32 {
    10.0f32.powf(0.05 * db)
}

fn to_db(linear: f32) -> f32 {
    20.0 * linear.log10()
}

// `fdlibm::powf` and `fdlibm::asinf`: the 64-bit function, rounded.
fn pow64(x: f32, y: f32) -> f32 {
    (x as f64).powf(y as f64) as f32
}

fn asin64(x: f32) -> f32 {
    (x as f64).asin() as f32
}

fn finite_or(x: f32, default: f32) -> f32 {
    if x.is_finite() { x } else { default }
}

// `std::max(a, b)` and `std::min(a, b)` with a constant `a`, as written.
fn max_of(a: f32, b: f32) -> f32 {
    if a < b { b } else { a }
}

fn min_of(a: f32, b: f32) -> f32 {
    if b < a { b } else { a }
}

// `DenormalDisabler::FlushDenormalFloatToZero`.
fn flush(x: f32) -> f32 {
    if x.abs() < f32::MIN_POSITIVE { 0.0 } else { x }
}

pub struct Compressor<const C: usize> {
    rate: f32,
    settings: Settings,
    detector_average: f32,
    compressor_gain: f32,
    metering_release_k: f32,
    metering_gain: f32,
    /// The least attenuation the curve has asked for since `deepest` was
    /// last asked: how hard the signal has pressed.
    deepest: f32,
    last_pre_delay_frames: usize,
    ring: [[f32; RING]; C],
    read: usize,
    write: usize,
    max_attack_diff: f32,
    // The static curve, worked out when the settings change.
    ratio: f32,
    slope: f32,
    linear_threshold: f32,
    db_threshold: f32,
    db_knee: f32,
    knee_threshold: f32,
    db_knee_threshold: f32,
    db_yknee_threshold: f32,
    k: f32,
    // The gain warped through `sin`, and in dB, for the gain it was last
    // worked out for: a compressor that is not pressing holds its gain at 1
    // for frame after frame.
    warp_for: f32,
    warped: f32,
    warped_db: f32,
}

impl<const C: usize> Compressor<C> {
    /// All zeros, so a host's static core costs nothing in the `.wasm`;
    /// `init` builds it.
    pub const fn new() -> Self {
        Compressor {
            rate: 0.0,
            settings: Settings {
                threshold: 0.0,
                knee: 0.0,
                ratio: 0.0,
                attack: 0.0,
                release: 0.0,
            },
            detector_average: 0.0,
            compressor_gain: 0.0,
            metering_release_k: 0.0,
            metering_gain: 0.0,
            deepest: 0.0,
            last_pre_delay_frames: 0,
            ring: [[0.0; RING]; C],
            read: 0,
            write: 0,
            max_attack_diff: 0.0,
            ratio: 0.0,
            slope: 0.0,
            linear_threshold: 0.0,
            db_threshold: 0.0,
            db_knee: 0.0,
            knee_threshold: 0.0,
            db_knee_threshold: 0.0,
            db_yknee_threshold: 0.0,
            k: 0.0,
            warp_for: 0.0,
            warped: 0.0,
            warped_db: 0.0,
        }
    }

    /// A new node at `rate` with these settings, as the synth builds one
    /// (the constructor and `Reset`): nothing heard yet, the curve not yet
    /// worked out.
    pub fn init(&mut self, rate: f64, settings: Settings) {
        *self = Self::new();
        self.rate = rate as f32;
        self.settings = settings;
        self.compressor_gain = 1.0;
        self.metering_gain = 1.0;
        self.deepest = 1.0;
        self.last_pre_delay_frames = DEFAULT_PRE_DELAY;
        self.write = DEFAULT_PRE_DELAY;
        self.max_attack_diff = -1.0;
        for x in [
            &mut self.ratio,
            &mut self.slope,
            &mut self.linear_threshold,
            &mut self.db_threshold,
            &mut self.db_knee,
            &mut self.knee_threshold,
            &mut self.db_knee_threshold,
            &mut self.db_yknee_threshold,
            &mut self.k,
        ] {
            *x = UNSET;
        }
        self.warp_for = f32::NAN;
        // `DiscreteTimeConstantForSampleRate`, in 64 bits.
        self.metering_release_k = (1.0 - (-1.0 / (rate * METERING_RELEASE)).exp()) as f32;
    }

    /// Start warm: as if the node had just been listening to silence, at
    /// rest. Right after `init`, before the first block. Chromium's `Reset`
    /// (which `init` is) leaves the detector at 0, as if the signal were
    /// infinitely loud, so a node that has just been built dips whatever
    /// first reaches it, by up to 9 dB (the bus compressor) or 14 dB (the
    /// ceiling), for the next hundred milliseconds or so while the detector
    /// climbs back and the gain follows. The core is Driftloom's own
    /// engine, not a copy of Chromium's: this plays that settling out on
    /// silence, so the node starts where Chromium's own ends up, and only
    /// the dip is gone. (Where that is, is Chromium's too: the detector's
    /// climb to 1 stalls in 32-bit floats a hair short of it, which leaves
    /// the gain 0.03 dB under unity until something presses.)
    pub fn settle(&mut self) {
        let silence = [[0.0; QUANTUM]; C];
        let mut out = [[0.0; QUANTUM]; C];
        let mut still = 0;
        let mut last = (self.detector_average.to_bits(), self.compressor_gain.to_bits());
        for _ in 0..SETTLE_BLOCKS {
            self.process(&silence, &mut out);
            let now = (self.detector_average.to_bits(), self.compressor_gain.to_bits());
            still = if now == last { still + 1 } else { 0 };
            last = now;
            // At rest: nothing has moved for a while.
            if still >= 4 {
                break;
            }
        }
        // Nothing has pressed yet, and nothing has been heard.
        self.deepest = 1.0;
    }

    /// The node's `reduction`: the metered gain reduction in dB, as of the
    /// last block.
    pub fn reduction(&self) -> f32 {
        self.metering_gain
    }

    /// How hard the signal has pressed since this was last asked: the
    /// deepest the static curve has gone under the line, in dB (0 if it
    /// has stayed under the threshold); and from now on, start again. The
    /// envelope then follows it as the attack and release allow.
    pub fn deepest(&mut self) -> f32 {
        to_db(core::mem::replace(&mut self.deepest, 1.0))
    }

    /// The gain the envelope is at, before the makeup gain and the warp.
    pub fn gain(&self) -> f32 {
        self.compressor_gain
    }

    /// One block (`Process`): `input`, one block a channel, compressed
    /// into `out`.
    pub fn process(&mut self, input: &[Block; C], out: &mut [Block; C]) {
        let Settings {
            threshold,
            knee,
            ratio,
            attack,
            release,
        } = self.settings;
        let rate = self.rate;
        let k = self.curve(threshold, knee, ratio);

        // The makeup gain, empirically tuned.
        let post_gain = pow64(1.0 / self.saturate(1.0, k), 0.6);
        let attack_frames = max_of(0.001, attack) * rate;
        let release_frames = rate * release;
        let sat_release_frames = SAT_RELEASE * rate;
        let a = release_frames * A_BASE;
        let b = release_frames * B_BASE;
        let c = release_frames * C_BASE;
        let d = release_frames * D_BASE;
        let e = release_frames * E_BASE;
        // The detector's release at the least it ever is, 2 dB: the rate
        // for any attenuation of 0.8 or more (-1.94 dB).
        let sat_release_least = to_linear(2.0 / sat_release_frames) - 1.0;

        self.set_pre_delay(PRE_DELAY);

        let mut frame = 0usize;
        for _ in 0..QUANTUM / DIVISION {
            self.detector_average = finite_or(self.detector_average, 1.0);
            let desired_gain = self.detector_average;
            // Pre-warped, so the gain is the one asked for after `sin`.
            let scaled_desired_gain = asin64(desired_gain) / PI_OVER_TWO;

            let releasing = scaled_desired_gain > self.compressor_gain;
            let mut diff = if scaled_desired_gain == 0.0 {
                if releasing { -1.0 } else { 1.0 }
            } else {
                to_db(self.compressor_gain / scaled_desired_gain)
            };
            let envelope_rate = if releasing {
                self.max_attack_diff = -1.0;
                diff = finite_or(diff, -1.0);
                // From -12 dB to 0, scaled to 0 to 3.
                let x = diff.max(-12.0).min(0.0);
                let x = 0.25 * (x + 12.0);
                let x2 = x * x;
                let x3 = x2 * x;
                let x4 = x2 * x2;
                let release = a + b * x + c * x2 + d * x3 + e * x4;
                to_linear(5.0 / release)
            } else {
                diff = finite_or(diff, 1.0);
                if self.max_attack_diff == -1.0 || self.max_attack_diff < diff {
                    self.max_attack_diff = diff;
                }
                let eff = max_of(0.5, self.max_attack_diff);
                1.0 - pow64(0.25 / eff, 1.0 / attack_frames)
            };

            let mut detector_average = self.detector_average;
            let mut compressor_gain = self.compressor_gain;
            for _ in 0..DIVISION {
                // The lookahead: the signal goes into the ring, and the gain
                // is worked out from it as it arrives.
                let mut level = 0.0f32;
                for (ring, x) in self.ring.iter_mut().zip(input.iter()) {
                    let s = x.get(frame).copied().unwrap_or(0.0);
                    if let Some(slot) = ring.get_mut(self.write) {
                        *slot = s;
                    }
                    let abs = if s > 0.0 { s } else { -s };
                    if level < abs {
                        level = abs;
                    }
                }

                // Through the curve, as an attenuation.
                let shaped = self.saturate(level, k);
                let attenuation = if level <= 0.0001 { 1.0 } else { shaped / level };
                if attenuation < self.deepest {
                    self.deepest = attenuation;
                }
                let sat_release = if attenuation >= 0.8 {
                    sat_release_least
                } else {
                    let db = max_of(2.0, -to_db(attenuation));
                    to_linear(db / sat_release_frames) - 1.0
                };
                let step = if attenuation > detector_average { sat_release } else { 1.0 };
                detector_average += (attenuation - detector_average) * step;
                detector_average = min_of(1.0, detector_average);
                detector_average = finite_or(detector_average, 1.0);

                if envelope_rate < 1.0 {
                    // Attack: down to the gain asked for.
                    compressor_gain += (scaled_desired_gain - compressor_gain) * envelope_rate;
                } else {
                    // Release: up towards 1.
                    compressor_gain *= envelope_rate;
                    compressor_gain = min_of(1.0, compressor_gain);
                }

                // Warped, to smooth the exponential's corners.
                if compressor_gain.to_bits() != self.warp_for.to_bits() {
                    self.warp_for = compressor_gain;
                    self.warped = ((PI_OVER_TWO * compressor_gain) as f64).sin() as f32;
                    self.warped_db = to_db(self.warped);
                }
                let total_gain = post_gain * self.warped;

                // Metering: peaks at once, release slowly.
                if self.warped_db < self.metering_gain {
                    self.metering_gain = self.warped_db;
                } else {
                    self.metering_gain += (self.warped_db - self.metering_gain) * self.metering_release_k;
                }

                for (ring, y) in self.ring.iter().zip(out.iter_mut()) {
                    let s = ring.get(self.read).copied().unwrap_or(0.0);
                    if let Some(slot) = y.get_mut(frame) {
                        *slot = s * total_gain;
                    }
                }
                frame += 1;
                self.read = (self.read + 1) & MASK;
                self.write = (self.write + 1) & MASK;
            }
            self.detector_average = flush(detector_average);
            self.compressor_gain = flush(compressor_gain);
        }
    }

    // `SetPreDelayTime`: a new lookahead clears the ring.
    fn set_pre_delay(&mut self, seconds: f32) {
        let frames = ((seconds * self.rate) as usize).min(RING - 1);
        if self.last_pre_delay_frames != frames {
            self.last_pre_delay_frames = frames;
            for ring in self.ring.iter_mut() {
                ring.fill(0.0);
            }
            self.read = 0;
            self.write = frames;
        }
    }

    // `KneeCurve`: the line up to the threshold, then an exponential that
    // leaves it with its slope and approaches `threshold + 1 / k`.
    fn knee_curve(&self, x: f32, k: f32) -> f32 {
        if x < self.linear_threshold {
            return x;
        }
        let lt = self.linear_threshold;
        lt + (1.0 - ((-k * (x - lt)) as f64).exp() as f32) / k
    }

    // `Saturate`: the whole curve, a constant ratio past the knee.
    fn saturate(&self, x: f32, k: f32) -> f32 {
        if x < self.knee_threshold {
            return self.knee_curve(x, k);
        }
        let db_x = to_db(x);
        let db_y = self.db_yknee_threshold + self.slope * (db_x - self.db_knee_threshold);
        to_linear(db_y)
    }

    // `KAtSlope`: the knee's `k` whose slope, in dB, is `desired` at the
    // knee's end.
    fn k_at_slope(&self, desired: f32) -> f32 {
        let db_x = self.db_threshold + self.db_knee;
        let x = to_linear(db_x);
        let (mut x2, mut db_x2) = (1.0f32, 0.0f32);
        let above = !(x < self.linear_threshold);
        if above {
            x2 = (x as f64 * 1.001) as f32;
            db_x2 = to_db(x2);
        }
        let (mut min_k, mut max_k, mut k) = (0.1f32, 10000.0f32, 5.0f32);
        let mut slope = 1.0f32;
        for _ in 0..15 {
            if above {
                let db_y = to_db(self.knee_curve(x, k));
                let db_y2 = to_db(self.knee_curve(x2, k));
                slope = (db_y2 - db_y) / (db_x2 - db_x);
            }
            if slope < desired {
                max_k = k;
            } else {
                min_k = k;
            }
            k = (min_k * max_k).sqrt();
        }
        k
    }

    // `UpdateStaticCurveParameters`.
    fn curve(&mut self, db_threshold: f32, db_knee: f32, ratio: f32) -> f32 {
        if db_threshold != self.db_threshold || db_knee != self.db_knee || ratio != self.ratio {
            self.db_threshold = db_threshold;
            self.linear_threshold = to_linear(db_threshold);
            self.db_knee = db_knee;
            self.ratio = ratio;
            self.slope = 1.0 / self.ratio;
            let k = self.k_at_slope(1.0 / self.ratio);
            self.db_knee_threshold = db_threshold + db_knee;
            self.knee_threshold = to_linear(self.db_knee_threshold);
            self.db_yknee_threshold = to_db(self.knee_curve(self.knee_threshold, k));
            self.k = k;
        }
        self.k
    }
}

impl<const C: usize> Default for Compressor<C> {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: f64 = 44100.0;
    // The synth's two (`_build()`).
    const COMP: Settings = Settings {
        threshold: -10.0,
        knee: 10.0,
        ratio: 3.0,
        attack: 0.006,
        release: 0.25,
    };
    const CEILING: Settings = Settings {
        threshold: -3.0,
        knee: 0.0,
        ratio: 20.0,
        attack: 0.001,
        release: 0.08,
    };

    fn built(settings: Settings) -> Box<Compressor<1>> {
        let mut c = Box::new(Compressor::<1>::new());
        c.init(RATE, settings);
        c
    }

    fn run(c: &mut Compressor<1>, blocks: usize, level: f32) -> Vec<f32> {
        let mut all = Vec::new();
        for b in 0..blocks {
            let input = [core::array::from_fn(|i| {
                let n = (b * QUANTUM + i) as f64;
                level * (2.0 * core::f64::consts::PI * 440.0 * n / RATE).sin() as f32
            })];
            let mut out = [[0.0; QUANTUM]];
            c.process(&input, &mut out);
            all.extend_from_slice(&out[0]);
        }
        all
    }

    // The loudest block's peak against the same tone through a compressor
    // that has been settled on it, in dB.
    fn first_blocks(c: &mut Compressor<1>, amp: f32, blocks: usize) -> Vec<f32> {
        let mut peaks = Vec::new();
        for b in 0..blocks {
            let input = [core::array::from_fn(|i| {
                let n = (b * QUANTUM + i) as f64;
                amp * (2.0 * core::f64::consts::PI * 440.0 * n / RATE).sin() as f32
            })];
            let mut out = [[0.0; QUANTUM]];
            c.process(&input, &mut out);
            peaks.push(out[0].iter().fold(0.0f32, |a, &x| a.max(x.abs())));
        }
        peaks
    }

    #[test]
    fn a_cold_start_dips_the_first_notes_and_a_warm_one_does_not() {
        for (settings, amp, dip) in [(COMP, 0.8, 5.0), (CEILING, 0.2, 8.0)] {
            let mut settled = built(settings);
            let steady = *first_blocks(&mut settled, amp, 600).last().unwrap();
            let mut cold = built(settings);
            let cold_peaks = first_blocks(&mut cold, amp, 12);
            let mut warm = built(settings);
            warm.settle();
            let warm_peaks = first_blocks(&mut warm, amp, 12);
            // Blocks 2-4 are past the lookahead's silence.
            let db = |x: f32| 20.0 * (x / steady).log10();
            let cold_dip = (2..5).map(|b| db(cold_peaks[b])).fold(f32::MAX, f32::min);
            assert!(cold_dip < -dip, "cold {cold_dip}");
            for b in 2..12 {
                assert!(db(warm_peaks[b]).abs() < 0.5, "warm block {b}: {}", db(warm_peaks[b]));
            }
        }
    }

    #[test]
    fn a_warm_start_rests_where_a_cold_one_ends_up() {
        // What Chromium's own node comes to on silence, the warm one starts
        // at: the same detector and gain, to the bit.
        for settings in [COMP, CEILING] {
            let mut warm = built(settings);
            warm.settle();
            let mut cold = built(settings);
            // Four seconds of silence, plenty.
            let _ = run(&mut cold, 1400, 0.0);
            assert_eq!(warm.detector_average.to_bits(), cold.detector_average.to_bits());
            assert_eq!(warm.compressor_gain.to_bits(), cold.compressor_gain.to_bits());
            // And it is not at 1 exactly: the detector's climb stalls short.
            assert!(warm.compressor_gain < 1.0 && warm.compressor_gain > 0.99, "{}", warm.compressor_gain);
            assert_eq!(warm.deepest.to_bits(), 1.0f32.to_bits());
        }
    }

    #[test]
    fn the_lookahead_is_six_milliseconds() {
        let mut c = built(COMP);
        let mut input = [[0.0; QUANTUM]];
        input[0][5] = 0.01;
        let mut seen = Vec::new();
        for _ in 0..4 {
            let mut out = [[0.0; QUANTUM]];
            c.process(&input, &mut out);
            seen.extend_from_slice(&out[0]);
            input = [[0.0; QUANTUM]];
        }
        let at = seen.iter().position(|&x| x != 0.0);
        // 0.006 * 44100 = 264.6, truncated.
        assert_eq!(at, Some(5 + 264));
    }

    #[test]
    fn quiet_signals_get_only_the_makeup_gain() {
        for settings in [COMP, CEILING] {
            let mut c = built(settings);
            // Long enough for the start's settling to pass, the meter's
            // 0.325 s release included.
            let out = run(&mut c, 1600, 0.01);
            let peak = out[out.len() - 4410..].iter().fold(0.0f32, |a, &x| a.max(x.abs()));
            let makeup = pow64(1.0 / c.saturate(1.0, c.k), 0.6);
            assert!(makeup > 1.0, "{makeup}");
            assert!((peak / 0.01 - makeup).abs() < 1e-3, "{peak} against {makeup}");
            assert!(c.reduction().abs() < 1e-3, "{}", c.reduction());
        }
    }

    #[test]
    fn loud_signals_are_pressed_down_and_metered() {
        let mut c = built(CEILING);
        let out = run(&mut c, 400, 1.0);
        let peak = out[out.len() - 4410..].iter().fold(0.0f32, |a, &x| a.max(x.abs()));
        // 0 dBFS through a 20:1 ceiling at -3 dB, makeup and all.
        assert!(peak < 0.9 && peak > 0.6, "{peak}");
        assert!(c.reduction() < -1.0, "{}", c.reduction());
    }

    #[test]
    fn the_curve_meets_its_slope() {
        let mut c = built(COMP);
        let k = c.curve(COMP.threshold, COMP.knee, COMP.ratio);
        assert!(k > 0.1 && k < 10000.0, "{k}");
        // Past the knee, 3 dB in is 1 dB out.
        let (x1, x2) = (to_linear(5.0), to_linear(8.0));
        let slope = (to_db(c.saturate(x2, k)) - to_db(c.saturate(x1, k))) / 3.0;
        assert!((slope - 1.0 / 3.0).abs() < 1e-3, "{slope}");
    }

    #[test]
    fn linked_channels_share_one_gain() {
        let mut one = Box::new(Compressor::<1>::new());
        let mut two = Box::new(Compressor::<2>::new());
        one.init(RATE, COMP);
        two.init(RATE, COMP);
        for b in 0..200usize {
            let x: Block = core::array::from_fn(|i| ((b * QUANTUM + i) as f32 * 0.05).sin() * 0.9);
            let mut a = [[0.0; QUANTUM]];
            let mut s = [[0.0; QUANTUM]; 2];
            one.process(&[x], &mut a);
            two.process(&[x, x], &mut s);
            // A mono input is Chromium's two identical channels.
            assert_eq!(a[0], s[0]);
            assert_eq!(s[0], s[1]);
        }
    }
}
