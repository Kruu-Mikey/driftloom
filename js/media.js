// Making the phone treat Driftloom as a music player.
//
// Web Audio on its own is just noise coming out of a web page. Android
// gives it no lock-screen controls, no notification, and no claim on the
// Bluetooth transport buttons, and it feels free to stop it when the
// screen goes off.
//
// The fix is to send the finished mix through a hidden <audio> element
// instead of straight at the speakers. Once a media element is playing,
// the page becomes a media session: it gets the notification, the lock
// screen controls, and the headset buttons, and the OS stops treating it
// as an idle tab.
//
// Some Android builds mishandle a MediaStream on an <audio> element, so
// this verifies the element is really advancing and falls back to the
// direct connection if it isn't. Falling back costs the lock-screen
// controls but never costs you the sound.

export class MediaBridge {
  constructor(ctx) {
    this.ctx = ctx;
    this.source = null;
    this.dest = null;
    this.audio = null;
    this.mode = 'direct';
    this.handlers = {};
  }

  attach(sourceNode) {
    this.source = sourceNode;
    sourceNode.disconnect();
    try {
      this.dest = this.ctx.createMediaStreamDestination();
      this.audio = document.createElement('audio');
      this.audio.setAttribute('playsinline', '');
      this.audio.preload = 'auto';
      this.audio.autoplay = false;
      this.audio.srcObject = this.dest.stream;
      // Keep it in the document; detached elements get collected on some
      // browsers while still notionally playing.
      this.audio.style.display = 'none';
      document.body.appendChild(this.audio);
      sourceNode.connect(this.dest);
      this.mode = 'element';
    } catch {
      sourceNode.connect(this.ctx.destination);
      this.mode = 'direct';
    }
  }

  _fallBackToDirect() {
    if (this.mode === 'direct') return;
    try {
      this.audio.pause();
      this.audio.srcObject = null;
      this.audio.remove();
    } catch { /* already gone */ }
    try {
      this.source.disconnect();
    } catch { /* nothing connected */ }
    this.source.connect(this.ctx.destination);
    this.mode = 'direct';
  }

  async start() {
    if (this.mode !== 'element') return this.mode;
    try {
      await this.audio.play();
    } catch {
      this._fallBackToDirect();
      return this.mode;
    }
    // Confirm it is actually running. A promise that resolves is not proof
    // that the clock is moving.
    const before = this.audio.currentTime;
    await new Promise((r) => setTimeout(r, 350));
    if (this.audio.currentTime <= before && !this.audio.paused) {
      this._fallBackToDirect();
    }
    return this.mode;
  }

  stop() {
    if (this.mode === 'element' && this.audio) {
      // Leave the element loaded so the next Play does not have to
      // renegotiate the stream; just stop feeding the session.
      this.audio.pause();
    }
  }

  async resume() {
    if (this.mode === 'element' && this.audio && this.audio.paused) {
      try {
        await this.audio.play();
      } catch { /* the next user gesture will get it */ }
    }
  }

  // ------------------------------------------------------------ session

  setHandlers({ onPlay, onPause, onNext, onPrev }) {
    if (!('mediaSession' in navigator)) return;
    this.handlers = { onPlay, onPause, onNext, onPrev };
    const set = (action, fn) => {
      try {
        navigator.mediaSession.setActionHandler(action, fn);
      } catch { /* this browser does not offer that action */ }
    };
    set('play', () => onPlay && onPlay());
    set('pause', () => onPause && onPause());
    set('stop', () => onPause && onPause());
    set('nexttrack', () => onNext && onNext());
    set('previoustrack', () => onPrev && onPrev());
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
}
