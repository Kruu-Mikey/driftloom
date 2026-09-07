// Making the phone treat Driftloom as a music player.
//
// Web Audio on its own gets no lock-screen controls, no notification, and
// no claim on the Bluetooth transport buttons.
//
// The obvious fix — pipe the mix through an <audio> element using a
// MediaStreamAudioDestinationNode — does not work on Chrome for Android.
// Stream-backed elements are classed as *communications* audio, the same
// category as a WebRTC call, and communications audio is deliberately
// excluded from media notifications. It also adds a resampling stage that
// glitches under CPU pressure. It was tried; it produced sound and nothing
// else.
//
// What does work is playing a real encoded file. Chrome grants a media
// session to an element playing an actual resource, so this loops a two
// second WAV at about -58 dBFS: inaudible in practice, but not digital
// silence, because a stream Chrome considers silent loses the session.
// The music itself goes straight to the speakers, untouched.

const KEEPALIVE = 'audio/keepalive.wav';

export class MediaBridge {
  constructor(ctx) {
    this.ctx = ctx;
    this.source = null;
    this.audio = null;
    this.mode = 'pending';
    this.lastError = '';
    this.handlersSet = 0;
  }

  attach(sourceNode) {
    // The synth already reaches the speakers on its own. Nothing is
    // re-routed here any more; re-routing was the mistake.
    this.source = sourceNode;

    try {
      this.audio = document.createElement('audio');
      this.audio.src = KEEPALIVE;
      this.audio.loop = true;
      this.audio.preload = 'auto';
      // Quiet content, not a quiet element. A muted or zero-volume element
      // forfeits the media session.
      this.audio.volume = 1;
      this.audio.setAttribute('playsinline', '');
      this.audio.style.display = 'none';
      document.body.appendChild(this.audio);
      this.audio.load();
      this.mode = 'ready';
    } catch (err) {
      this.mode = 'unavailable';
      this.lastError = String(err);
    }
  }

  async start() {
    if (!this.audio) return this.mode;
    try {
      await this.audio.play();
      this.mode = 'session';
    } catch (err) {
      // Autoplay refused, or the file is missing. The music is unaffected;
      // only the lock-screen controls are lost.
      this.mode = 'no-session';
      this.lastError = String(err && err.name ? err.name : err);
    }
    return this.mode;
  }

  stop() {
    if (this.audio) this.audio.pause();
  }

  async resume() {
    if (this.audio && this.audio.paused) {
      try {
        await this.audio.play();
      } catch { /* the next tap will get it */ }
    }
  }

  // ------------------------------------------------------------ session

  setHandlers({ onPlay, onPause, onNext, onPrev }) {
    if (!('mediaSession' in navigator)) return;
    const set = (action, fn) => {
      try {
        navigator.mediaSession.setActionHandler(action, fn);
        return true;
      } catch {
        return false; // this browser does not offer that action
      }
    };
    const ok = [
      set('play', () => onPlay && onPlay()),
      set('pause', () => onPause && onPause()),
      set('stop', () => onPause && onPause()),
      set('nexttrack', () => onNext && onNext()),
      set('previoustrack', () => onPrev && onPrev()),
    ];
    this.handlersSet = ok.filter(Boolean).length;
  }

  setMetadata(title, subtitle) {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title,
        artist: subtitle,
        album: 'Driftloom',
        artwork: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      });
    } catch { /* metadata is a nicety, not a requirement */ }
  }

  setPlaybackState(playing) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    } catch { /* older browser */ }
  }

  report() {
    const ms = 'mediaSession' in navigator;
    return {
      keepalive: this.mode,
      keepaliveErr: this.lastError || '-',
      keepalivePlaying: this.audio ? !this.audio.paused : false,
      keepaliveTime: this.audio ? +this.audio.currentTime.toFixed(1) : 0,
      mediaSession: ms,
      handlers: this.handlersSet,
      metadata: ms && navigator.mediaSession.metadata
        ? navigator.mediaSession.metadata.title : '(none)',
      playbackState: ms ? navigator.mediaSession.playbackState : '-',
    };
  }
}
