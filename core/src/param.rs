//! A parameter that moves the way a Web Audio `AudioParam` does.
//!
//! The JavaScript synth shapes every note with `setValueAtTime`, the two
//! ramps and `setTargetAtTime`, so a ported voice has to read the same
//! curves off the same calls. This is the automation timeline as the Web
//! Audio spec defines it (section 1.6.3, "AudioParam"), evaluated at the time
//! of each sample frame:
//!
//! - Events are kept in time order. One added at the time of an existing
//!   event goes after it.
//! - Before the first event the parameter holds its intrinsic value (the
//!   `value` attribute), unless that first event is a ramp, which starts
//!   from the intrinsic value at the time it was added.
//! - After a `setValueAtTime` or a ramp the value holds until the next
//!   event, unless the next event is a ramp. A ramp runs from where the
//!   event before it left off, (T0, V0), to its own time and value. That is
//!   "where a ramp starts", and it is the previous event's time, not the
//!   time the ramp was added.
//! - After a `setTargetAtTime` the value falls exponentially toward the
//!   target, from the value it had when the event began. A ramp that
//!   follows one starts where the target curve is when the ramp was added,
//!   or, if the target had not started yet, replaces it from its start.
//! - An exponential ramp from or to zero, or across zero, holds V0 until it
//!   ends and then jumps to V1, as the spec says.
//!
//! Values are 32-bit floats, as an `AudioParam`'s are. Times are seconds on
//! the host's clock, in 64-bit floats. A parameter holds a fixed number of
//! events and never allocates; one added past that is dropped and the call
//! returns false. Every voice knows how many it schedules, so this is a
//! guard and not a policy.

use crate::QUANTUM;

/// The most events one parameter holds. A JavaScript voice schedules at
/// most five on any one parameter.
pub const MAX_EVENTS: usize = 8;

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Set,
    Linear,
    Exponential,
    Target,
}

#[derive(Clone, Copy)]
struct Event {
    kind: Kind,
    time: f64,
    value: f32,
    /// setTargetAtTime's time constant. Unused by the other kinds.
    tau: f64,
    /// The clock time the event was added: a ramp that follows a target
    /// curve, or has nothing before it, starts there.
    added: f64,
    /// Where this event's curve starts, worked out whenever the list
    /// changes: (T0, V0) for a ramp, and V0 at `time` for a target.
    t0: f64,
    v0: f64,
}

const EMPTY: Event = Event {
    kind: Kind::Set,
    time: 0.0,
    value: 0.0,
    tau: 0.0,
    added: 0.0,
    t0: 0.0,
    v0: 0.0,
};

pub struct Param {
    intrinsic: f32,
    events: [Event; MAX_EVENTS],
    len: usize,
}

impl Param {
    pub const fn new(intrinsic: f32) -> Self {
        Param {
            intrinsic,
            events: [EMPTY; MAX_EVENTS],
            len: 0,
        }
    }

    /// Back to a fresh parameter with this intrinsic value, for a voice
    /// slot being reused.
    pub fn reset(&mut self, intrinsic: f32) {
        self.intrinsic = intrinsic;
        self.len = 0;
    }

    pub fn set_value_at_time(&mut self, value: f32, time: f64) -> bool {
        self.insert(Kind::Set, time, value, 0.0, time)
    }

    /// `now` is the host's current time when the call is made: a ramp
    /// with nothing before it, or after a target curve already under way,
    /// starts there.
    pub fn linear_ramp_to_value_at_time(&mut self, value: f32, time: f64, now: f64) -> bool {
        self.insert(Kind::Linear, time, value, 0.0, now)
    }

    pub fn exponential_ramp_to_value_at_time(&mut self, value: f32, time: f64, now: f64) -> bool {
        self.insert(Kind::Exponential, time, value, 0.0, now)
    }

    pub fn set_target_at_time(&mut self, target: f32, time: f64, tau: f64) -> bool {
        self.insert(Kind::Target, time, target, tau, time)
    }

    /// Drop every event at or after `time`. A ramp is at the time it ends,
    /// so one still under way at `time` goes too, as in the spec.
    pub fn cancel_scheduled_values(&mut self, time: f64) {
        self.len = self.list().iter().take_while(|e| e.time < time).count();
    }

    // The events in use. Never indexes past the array, so nothing here
    // can panic.
    fn list(&self) -> &[Event] {
        self.events.get(..self.len).unwrap_or(&[])
    }

    fn insert(&mut self, kind: Kind, time: f64, value: f32, tau: f64, added: f64) -> bool {
        if self.len >= MAX_EVENTS || !time.is_finite() {
            return false;
        }
        // After every event at the same time or earlier: the events from
        // there on move up one, and the new one takes the gap.
        let at = self.list().iter().take_while(|e| e.time <= time).count();
        let Some(tail) = self.events.get_mut(at..=self.len) else {
            return false;
        };
        let mut new = Event {
            kind,
            time,
            value,
            tau,
            added,
            t0: 0.0,
            v0: 0.0,
        };
        for e in tail.iter_mut() {
            core::mem::swap(e, &mut new);
        }
        self.len += 1;
        self.resolve();
        true
    }

    // Where each curve starts depends on the events before it, so it is
    // worked out again, front to back, whenever the list changes.
    fn resolve(&mut self) {
        let intrinsic = self.intrinsic as f64;
        let mut prev: Option<Event> = None;
        let len = self.len;
        for e in self.events.iter_mut().take(len) {
            match e.kind {
                Kind::Linear | Kind::Exponential => {
                    let (t0, v0) = match prev {
                        None => (e.added, intrinsic),
                        Some(p) if p.kind == Kind::Target => {
                            if e.added <= p.time {
                                // Not started yet: the ramp takes its place.
                                (p.time, p.v0)
                            } else {
                                (e.added, target_at(&p, e.added))
                            }
                        }
                        Some(p) => (p.time, p.value as f64),
                    };
                    e.t0 = t0;
                    e.v0 = v0;
                }
                Kind::Target => {
                    e.t0 = e.time;
                    e.v0 = match prev {
                        None => intrinsic,
                        Some(p) if p.kind == Kind::Target => target_at(&p, e.time),
                        Some(p) => p.value as f64,
                    };
                }
                Kind::Set => {}
            }
            prev = Some(*e);
        }
    }

    /// The value at time `t`, in seconds.
    pub fn value_at(&self, t: f64) -> f32 {
        let events = self.list();
        // The last event at or before t, and the one after it.
        let n = events.iter().take_while(|e| e.time <= t).count();
        let next = events.get(n);
        if let Some(r) = next
            && is_ramp(r)
            && t >= r.t0
        {
            return ramp_at(r, t) as f32;
        }
        match n.checked_sub(1).and_then(|i| events.get(i)) {
            None => self.intrinsic,
            Some(e) if e.kind == Kind::Target => target_at(e, t) as f32,
            Some(e) => e.value,
        }
    }

    /// The value at every frame of the block that starts at frame `block`.
    /// The same curve as `value_at`, but each exponential ramp and target
    /// curve is stepped from frame to frame by a constant factor, as
    /// Chromium steps them, where `value_at` takes a power or an exponential
    /// at every frame. In 64-bit floats, a ramp of a hundred thousand frames
    /// drifts from the closed form by about one part in 10^11.
    pub fn fill(&self, block: u64, rate: f64, out: &mut [f32; QUANTUM]) {
        let mut i = 0;
        while i < QUANTUM {
            let t = (block + i as u64) as f64 / rate;
            let (curve, until) = self.curve(t);
            let mut v = match curve {
                Curve::Hold(v) => v,
                Curve::Linear(e) => ramp_at(e, t),
                Curve::Exponential(e) => ramp_at(e, t),
                Curve::Target(e) => target_at(e, t),
            };
            let step = match curve {
                Curve::Exponential(e) => exponential_step(e, rate),
                Curve::Target(e) if e.tau > 0.0 => (-1.0 / (e.tau * rate)).exp(),
                _ => 1.0,
            };
            while i < QUANTUM {
                let t = (block + i as u64) as f64 / rate;
                if t >= until {
                    break;
                }
                if let Some(y) = out.get_mut(i) {
                    *y = match curve {
                        Curve::Linear(e) => ramp_at(e, t) as f32,
                        _ => v as f32,
                    };
                }
                v = match curve {
                    Curve::Exponential(_) => v * step,
                    Curve::Target(e) => e.value as f64 + (v - e.value as f64) * step,
                    _ => v,
                };
                i += 1;
            }
        }
    }

    // The curve in force at `t`, and the time it gives way to the next.
    fn curve(&self, t: f64) -> (Curve<'_>, f64) {
        let events = self.list();
        let n = events.iter().take_while(|e| e.time <= t).count();
        let next = events.get(n);
        if let Some(r) = next
            && is_ramp(r)
            && t >= r.t0
        {
            let curve = if r.kind == Kind::Linear {
                Curve::Linear(r)
            } else {
                Curve::Exponential(r)
            };
            return (curve, r.time);
        }
        // Until the next event, or until a ramp after a target curve takes
        // over from it.
        let until = match next {
            Some(r) if is_ramp(r) => r.t0,
            Some(e) => e.time,
            None => f64::INFINITY,
        };
        let curve = match n.checked_sub(1).and_then(|i| events.get(i)) {
            None => Curve::Hold(self.intrinsic as f64),
            Some(e) if e.kind == Kind::Target => Curve::Target(e),
            Some(e) => Curve::Hold(e.value as f64),
        };
        (curve, until)
    }

    /// Whether Web Audio renders the parameter sample by sample in the block
    /// from `t` to `t + block` seconds, rather than holding one value for it
    /// (Chromium's `HasSampleAccurateValues`). An oscillator starts
    /// differently in each case (see `osc`). With one event, while it is not
    /// in the past (or is a target curve, which never arrives). With more,
    /// until they are all in the past -- and for one block more, the block in
    /// which Chromium notices and folds them into one held value.
    pub fn moving_from(&self, t: f64, block: f64) -> bool {
        let events = self.list();
        match (events.len(), events.last()) {
            (_, None) => false,
            (_, Some(last)) if last.kind == Kind::Target => true,
            (1, Some(only)) => only.time >= t,
            (_, Some(last)) => last.time >= t - block,
        }
    }

    /// Move every event before `t` to `t`, and work out where the curves
    /// start again. Chromium does this to the events an oscillator's
    /// frequency was given, the first time it renders them: in the block the
    /// oscillator starts in, since it renders nothing before. So an event a
    /// fraction of a frame before that block -- a note that starts exactly
    /// on a block -- moves to the block, and a ramp from it starts there. A
    /// gain or a filter renders every block, and never sees its events late.
    pub fn clamp_before(&mut self, t: f64) {
        let len = self.len;
        let mut moved = false;
        for e in self.events.iter_mut().take(len) {
            if e.time < t {
                e.time = t;
                moved = true;
            }
        }
        // Only earlier events move, and only up to `t`, so the order holds.
        if moved {
            self.resolve();
        }
    }
}

#[derive(Clone, Copy)]
enum Curve<'a> {
    Hold(f64),
    Linear(&'a Event),
    Exponential(&'a Event),
    Target(&'a Event),
}

// What an exponential ramp is multiplied by from one frame to the next.
fn exponential_step(e: &Event, rate: f64) -> f64 {
    let (v0, v1, span) = (e.v0, e.value as f64, e.time - e.t0);
    if v0 == 0.0 || v0 * v1 <= 0.0 || span <= 0.0 {
        return 1.0;
    }
    (v1 / v0).powf(1.0 / (span * rate))
}

fn is_ramp(e: &Event) -> bool {
    e.kind == Kind::Linear || e.kind == Kind::Exponential
}

fn ramp_at(e: &Event, t: f64) -> f64 {
    let (t0, v0, t1, v1) = (e.t0, e.v0, e.time, e.value as f64);
    if t1 <= t0 {
        return v1;
    }
    let x = (t - t0) / (t1 - t0);
    match e.kind {
        Kind::Linear => v0 + (v1 - v0) * x,
        _ => {
            if v0 == 0.0 || v0 * v1 <= 0.0 {
                v0
            } else {
                v0 * (v1 / v0).powf(x)
            }
        }
    }
}

fn target_at(e: &Event, t: f64) -> f64 {
    let v1 = e.value as f64;
    if e.tau <= 0.0 {
        return v1;
    }
    v1 + (e.v0 - v1) * (-(t - e.time) / e.tau).exp()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f32, b: f64) -> bool {
        ((a as f64) - b).abs() <= 1e-6 * b.abs().max(1e-3)
    }

    #[test]
    fn holds_the_intrinsic_value_until_the_first_event() {
        let mut p = Param::new(1.0);
        p.set_value_at_time(0.5, 2.0);
        assert_eq!(p.value_at(1.999), 1.0);
        assert_eq!(p.value_at(2.0), 0.5);
        assert_eq!(p.value_at(9.0), 0.5);
    }

    #[test]
    fn a_ramp_starts_at_the_event_before_it() {
        let mut p = Param::new(1.0);
        p.set_value_at_time(0.0001, 1.0);
        // Added long before it runs: it still starts at 1.0, not at 0.
        p.exponential_ramp_to_value_at_time(0.5, 1.002, 0.0);
        p.linear_ramp_to_value_at_time(0.0, 2.0, 0.0);
        let mid = 0.0001f64 * (0.5f64 / 0.0001).powf(0.5);
        assert!(close(p.value_at(1.001), mid));
        assert!(close(p.value_at(1.002), 0.5));
        assert!(close(p.value_at(1.501), 0.5 * (1.0 - 0.499 / 0.998)));
        assert_eq!(p.value_at(2.5), 0.0);
    }

    #[test]
    fn a_ramp_with_nothing_before_it_starts_when_added() {
        let mut p = Param::new(2.0);
        p.linear_ramp_to_value_at_time(4.0, 3.0, 1.0);
        assert!(close(p.value_at(0.5), 2.0));
        assert!(close(p.value_at(2.0), 3.0));
    }

    #[test]
    fn exponential_ramps_across_zero_hold_then_jump() {
        let mut p = Param::new(0.0);
        p.set_value_at_time(-1.0, 0.0);
        p.exponential_ramp_to_value_at_time(1.0, 1.0, 0.0);
        assert!(close(p.value_at(0.5), -1.0));
        assert!(close(p.value_at(1.0), 1.0));
    }

    #[test]
    fn a_target_falls_from_the_value_it_starts_at() {
        let mut p = Param::new(1.0);
        p.set_value_at_time(0.8, 0.0);
        p.set_target_at_time(0.0001, 1.0, 0.1);
        assert!(close(p.value_at(0.9), 0.8));
        let want = 0.0001 + (0.8 - 0.0001) * (-1.0f64).exp();
        assert!(close(p.value_at(1.1), want));
    }

    #[test]
    fn a_ramp_after_a_target_under_way_starts_where_the_curve_is() {
        let mut p = Param::new(1.0);
        p.set_target_at_time(0.0, 0.0, 1.0);
        // Added at 1.0, when the curve is at e^-1.
        p.linear_ramp_to_value_at_time(1.0, 2.0, 1.0);
        let at1 = (-1.0f64).exp();
        assert!(close(p.value_at(0.5), (-0.5f64).exp()));
        assert!(close(p.value_at(1.5), at1 + (1.0 - at1) * 0.5));
    }

    #[test]
    fn a_ramp_after_a_target_not_yet_started_replaces_it() {
        let mut p = Param::new(0.5);
        p.set_target_at_time(0.0, 1.0, 1.0);
        p.linear_ramp_to_value_at_time(1.5, 2.0, 0.0);
        assert!(close(p.value_at(0.5), 0.5));
        assert!(close(p.value_at(1.5), 1.0));
    }

    #[test]
    fn same_time_events_keep_the_order_they_were_added() {
        let mut p = Param::new(0.0);
        p.set_value_at_time(1.0, 1.0);
        p.set_value_at_time(2.0, 1.0);
        assert_eq!(p.value_at(1.0), 2.0);
    }

    #[test]
    fn cancel_drops_events_from_its_time_on() {
        let mut p = Param::new(0.0);
        p.set_value_at_time(1.0, 1.0);
        p.linear_ramp_to_value_at_time(0.0, 3.0, 0.0);
        p.cancel_scheduled_values(2.0);
        assert_eq!(p.value_at(2.5), 1.0);
    }

    #[test]
    fn moves_while_anything_is_left_to_happen() {
        let mut p = Param::new(440.0);
        let b = 0.003;
        assert!(!p.moving_from(0.0, b));
        p.set_value_at_time(110.0, 1.0);
        assert!(p.moving_from(0.5, b));
        assert!(p.moving_from(1.0, b));
        // A note set at 1.0 that first sounds in a block starting just
        // after it: steady there.
        assert!(!p.moving_from(1.0001, b));
        // Two events: one block more.
        p.linear_ramp_to_value_at_time(220.0, 1.5, 0.0);
        assert!(p.moving_from(1.502, b));
        assert!(!p.moving_from(1.504, b));
        p.set_target_at_time(0.0, 2.0, 0.1);
        assert!(p.moving_from(9.0, b));
    }

    #[test]
    fn a_block_filled_matches_the_curve_frame_by_frame() {
        let rate = 44100.0;
        let mut p = Param::new(1.0);
        p.set_value_at_time(0.0001, 0.001);
        p.exponential_ramp_to_value_at_time(0.5, 0.003, 0.0);
        p.linear_ramp_to_value_at_time(0.2, 0.004, 0.0);
        p.set_target_at_time(0.0001, 0.0045, 0.0007);
        p.linear_ramp_to_value_at_time(0.3, 0.02, 0.01);
        for block in 0..8u64 {
            let mut out = [0.0f32; QUANTUM];
            p.fill(block * QUANTUM as u64, rate, &mut out);
            for (i, &y) in out.iter().enumerate() {
                let t = (block * QUANTUM as u64 + i as u64) as f64 / rate;
                let want = p.value_at(t);
                assert!(
                    (y - want).abs() <= 2e-6 * want.abs().max(1e-4),
                    "block {block} frame {i}: {y} {want}"
                );
            }
        }
    }

    #[test]
    fn clamping_moves_a_ramps_start_with_its_event() {
        let mut p = Param::new(440.0);
        p.set_value_at_time(100.0, 0.99);
        p.exponential_ramp_to_value_at_time(200.0, 1.1, 0.0);
        p.clamp_before(1.0);
        assert_eq!(p.value_at(1.0), 100.0);
        let want = 100.0 * 2f64.powf(0.05 / 0.1);
        assert!(close(p.value_at(1.05), want));
    }

    #[test]
    fn a_full_parameter_refuses_more() {
        let mut p = Param::new(0.0);
        for i in 0..MAX_EVENTS {
            assert!(p.set_value_at_time(i as f32, i as f64));
        }
        assert!(!p.set_value_at_time(9.0, 9.0));
        assert_eq!(p.value_at(100.0), (MAX_EVENTS - 1) as f32);
    }
}
