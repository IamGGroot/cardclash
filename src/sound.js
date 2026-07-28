// Tiny synthesized SFX (no audio files) plus mobile haptics — both a lot of
// juice for very little weight. The AudioContext needs a user gesture to
// start, so it's created lazily on first play() call rather than at import.
let ctx = null;
let enabled = true;
let hapticsEnabled = true;

function getCtx() {
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = new AudioCtx();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, start, duration, type = 'sine', gain = 0.15) {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  osc.connect(g);
  g.connect(c.destination);
  const t0 = c.currentTime + start;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

function play(fn) {
  if (!enabled) return;
  try {
    fn();
  } catch {
    // audio can fail to init in odd embedded contexts — never let it break gameplay
  }
}

export function setSoundEnabled(v) {
  enabled = v;
}

export function isSoundEnabled() {
  return enabled;
}

export function setHapticsEnabled(v) {
  hapticsEnabled = v;
}

export function isHapticsEnabled() {
  return hapticsEnabled;
}

export const sfx = {
  click: () => play(() => tone(700, 0, 0.06, 'sine', 0.08)),
  deploy: () =>
    play(() => {
      tone(440, 0, 0.08, 'triangle', 0.12);
      tone(660, 0.05, 0.1, 'triangle', 0.1);
    }),
  cast: () =>
    play(() => {
      tone(520, 0, 0.1, 'sine', 0.1);
      tone(780, 0.06, 0.12, 'sine', 0.08);
    }),
  attack: () => play(() => tone(140, 0, 0.12, 'sawtooth', 0.18)),
  damage: () => play(() => tone(200, 0, 0.18, 'sawtooth', 0.15)),
  heal: () =>
    play(() => {
      tone(500, 0, 0.1, 'sine', 0.1);
      tone(700, 0.08, 0.14, 'sine', 0.1);
    }),
  win: () =>
    play(() => {
      tone(523, 0, 0.15, 'triangle', 0.15);
      tone(659, 0.15, 0.15, 'triangle', 0.15);
      tone(784, 0.3, 0.25, 'triangle', 0.15);
    }),
  lose: () =>
    play(() => {
      tone(400, 0, 0.2, 'sawtooth', 0.12);
      tone(300, 0.2, 0.25, 'sawtooth', 0.12);
    }),
  coin: () =>
    play(() => {
      tone(880, 0, 0.06, 'square', 0.08);
      tone(1200, 0.05, 0.08, 'square', 0.08);
    }),
};

// navigator.vibrate is Android-only (no-op on iOS Safari / desktop) — always
// safe to call, so call sites don't need to feature-detect themselves.
export function vibrate(pattern) {
  if (!hapticsEnabled) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // ignore
  }
}
