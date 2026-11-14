// All sound is synthesised with WebAudio: no audio files, no network. A shared noise
// buffer feeds gunfire, impacts and explosions; oscillators make beeps, thumps and the
// round stingers. The context is created on the first user gesture (the play click).
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let ambientStarted = false;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      const length = ctx.sampleRate * 1.2;
      noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      ctx = null;
      return false;
    }
    return true;
  }

  function noise(duration, filterType, frequency, gainValue, when = 0) {
    if (!ctx) return;
    const time = ctx.currentTime + when;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    source.connect(filter).connect(gain).connect(master);
    source.start(time);
    source.stop(time + duration + 0.05);
  }

  function tone(frequency, duration, type, gainValue, slideTo = 0, when = 0) {
    if (!ctx) return;
    const time = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, time);
    if (slideTo > 0) osc.frequency.exponentialRampToValueAtTime(slideTo, time + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    osc.connect(gain).connect(master);
    osc.start(time);
    osc.stop(time + duration + 0.05);
  }

  function startAmbient() {
    if (!ctx || ambientStarted) return;
    ambientStarted = true;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 220;
    const gain = ctx.createGain();
    gain.gain.value = 0.035;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.015;
    lfo.connect(lfoGain).connect(gain.gain);
    source.connect(filter).connect(gain).connect(master);
    source.start();
    lfo.start();
  }

  const SHOT_GAIN = { pistol: 0.5, smg: 0.42, rifle: 0.62, sniper: 0.85, shotgun: 0.8 };

  return {
    ensure,
    startAmbient,
    shot(kind) {
      if (!ctx) return;
      const gain = SHOT_GAIN[kind] ?? 0.5;
      noise(0.14, 'highpass', 900, gain);
      tone(kind === 'sniper' || kind === 'shotgun' ? 150 : 220, 0.1, 'sine', gain * 0.7, 55);
      if (kind === 'sniper') noise(0.5, 'bandpass', 300, 0.25, 0.02);
    },
    distantShot() {
      if (!ctx) return;
      noise(0.18, 'lowpass', 500, 0.16);
      tone(140, 0.12, 'sine', 0.12, 50);
    },
    dryFire() {
      if (!ctx) return;
      tone(1800, 0.03, 'square', 0.08);
    },
    reload() {
      if (!ctx) return;
      tone(900, 0.04, 'square', 0.1);
      tone(600, 0.04, 'square', 0.12, 0, 0.18);
      tone(1100, 0.05, 'square', 0.12, 0, 0.55);
    },
    hit() {
      if (!ctx) return;
      tone(1400, 0.05, 'square', 0.14);
    },
    kill() {
      if (!ctx) return;
      tone(880, 0.07, 'sine', 0.16);
      tone(1320, 0.1, 'sine', 0.16, 0, 0.07);
    },
    hurt() {
      if (!ctx) return;
      noise(0.12, 'lowpass', 400, 0.25);
      tone(110, 0.16, 'sine', 0.22, 60);
    },
    footstep(run) {
      if (!ctx) return;
      noise(0.06, 'lowpass', 300, run ? 0.09 : 0.05);
    },
    explosion() {
      if (!ctx) return;
      noise(0.9, 'lowpass', 700, 0.9);
      tone(90, 0.7, 'sine', 0.7, 32);
      noise(0.3, 'highpass', 2000, 0.3, 0.05);
    },
    beep(final = false) {
      if (!ctx) return;
      tone(final ? 1560 : 1180, final ? 0.16 : 0.08, 'sine', 0.16);
    },
    plantDone() {
      if (!ctx) return;
      tone(660, 0.12, 'sine', 0.18);
      tone(990, 0.18, 'sine', 0.18, 0, 0.12);
    },
    buy() {
      if (!ctx) return;
      tone(740, 0.06, 'sine', 0.14);
      tone(1108, 0.09, 'sine', 0.14, 0, 0.06);
    },
    denied() {
      if (!ctx) return;
      tone(220, 0.12, 'square', 0.1);
      tone(180, 0.16, 'square', 0.1, 0, 0.1);
    },
    roundWin() {
      if (!ctx) return;
      [523, 659, 784, 1046].forEach((frequency, index) => tone(frequency, 0.22, 'triangle', 0.16, 0, index * 0.11));
    },
    roundLose() {
      if (!ctx) return;
      [392, 330, 262, 196].forEach((frequency, index) => tone(frequency, 0.26, 'triangle', 0.14, 0, index * 0.13));
    },
    flash() {
      if (!ctx) return;
      tone(2400, 0.4, 'sine', 0.2, 900);
    },
  };
}
