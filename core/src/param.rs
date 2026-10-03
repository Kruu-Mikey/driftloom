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

    /// Whether the parameter moves from `t` on: an event at or after it, or
    /// a target curve, which never arrives. Web Audio renders a parameter
    /// like that sample by sample for the block starting at `t`, and holds
    /// one that has nothing left to do at a single value. An oscillator
    /// starts differently in each case (see `osc`).
    pub fn moving_from(&self, t: f64) -> bool {
        match self.list().last() {
            None => false,
            Some(last) => last.kind == Kind::Target || last.time >= t,
        }
    }
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
        assert!(!p.moving_from(0.0));
        p.set_value_at_time(110.0, 1.0);
        assert!(p.moving_from(0.5));
        assert!(p.moving_from(1.0));
        // A note set at 1.0 that first sounds in a block starting just
        // after it: steady there.
        assert!(!p.moving_from(1.0001));
        p.set_target_at_time(0.0, 2.0, 0.1);
        assert!(p.moving_from(9.0));
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
