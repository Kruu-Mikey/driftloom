// A metronome that survives the screen going off.
//
// Backgrounded pages get their setInterval clamped to roughly one tick a
// second. The scheduler only queues a fraction of a second of audio at a
// time, so once the clamp kicks in it runs dry between wake-ups and the
// music stutters or stops. A Worker keeps its own timer and is throttled
// far less aggressively, so the ticks keep arriving.
//
// The worker is built from a Blob rather than a separate file so there is
// no extra request and nothing to get out of sync in the service worker
// cache.

const WORKER_SOURCE = `
  let id = null;
  self.onmessage = (e) => {
    if (e.data.cmd === 'start') {
      clearInterval(id);
      id = setInterval(() => postMessage(0), e.data.ms);
    } else if (e.data.cmd === 'stop') {
      clearInterval(id);
      id = null;
    }
  };
`;

export class Clock {
  constructor(onTick) {
    this.onTick = onTick;
    this.ms = 50;
    this.worker = null;
    this.timer = null;

    try {
      const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
      this.worker = new Worker(url);
      URL.revokeObjectURL(url);
      this.worker.onmessage = () => this.onTick();
    } catch {
      // Blocked by a policy, or no Worker at all. The plain timer still
      // works; it just gets throttled in the background.
      this.worker = null;
    }
  }

  get usingWorker() {
    return this.worker !== null;
  }

  start(ms = this.ms) {
    this.ms = ms;
    this.stop();
    if (this.worker) this.worker.postMessage({ cmd: 'start', ms });
    else this.timer = setInterval(() => this.onTick(), ms);
  }

  stop() {
    if (this.worker) this.worker.postMessage({ cmd: 'stop' });
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  dispose() {
    this.stop();
    if (this.worker) this.worker.terminate();
  }
}
