// Sound for the draw piece (owner, 25 Nov 2026): a beep for 3 · 2, a higher one on 1, a click for every
// name that passes the middle row while the reel spins (so it slows down with the reel), and a deep,
// cinematic hit with a warm chord when the winner lands. Made with WebAudio, so there are no files to load.
// OBS plays a Browser Source's sound without a click; in OBS, tick «Control audio via OBS» on the
// source to set its volume in the mixer. URL: &sound=0 turns it off, &vol=0.5 makes it quieter (0–1).

export interface OverlaySound {
  beep(final: boolean): void;
  whoosh(): void;
  tick(progress: number): void;
  win(): void;
}

export function overlaySound(enabled: boolean, volume: number): OverlaySound {
  let ctx: AudioContext | null = null;
  let out: GainNode | null = null;
  let lastTick = 0;
  const get = (): AudioContext | null => {
    if (!enabled) return null;
    try {
      if (!ctx) {
        ctx = new AudioContext();
        out = ctx.createGain();
        out.gain.value = Math.max(0, Math.min(1, volume));
        out.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') void ctx.resume();
      return ctx;
    } catch { return null; }
  };
  /** One note with a quick attack and an exponential fade. */
  const tone = (c: AudioContext, freq: number, at: number, dur: number, type: OscillatorType, gain: number, slideTo?: number) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(out!);
    o.start(at);
    o.stop(at + dur + 0.02);
  };
  // A short room reverb (made once from decaying noise), so the win hit sounds big, not boxy.
  let reverb: ConvolverNode | null = null;
  const room = (c: AudioContext): AudioNode => {
    if (!reverb) {
      const len = Math.floor(c.sampleRate * 2.2);
      const ir = c.createBuffer(2, len, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      }
      reverb = c.createConvolver();
      reverb.buffer = ir;
      const wet = c.createGain();
      wet.gain.value = 0.28;
      reverb.connect(wet).connect(out!);
    }
    return reverb;
  };
  /** A burst of filtered noise (punch or air). */
  const noiseHit = (c: AudioContext, dest: AudioNode, at: number, dur: number, type: BiquadFilterType, freq: number, gain: number) => {
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(at);
    src.stop(at + dur + 0.02);
  };
  return {
    beep(final) {
      const c = get(); if (!c) return;
      const t = c.currentTime;
      if (final) { tone(c, 1046.5, t, 0.42, 'triangle', 0.32); tone(c, 2093, t, 0.3, 'sine', 0.08); }
      else { tone(c, 659.3, t, 0.2, 'triangle', 0.28); tone(c, 1318.5, t, 0.12, 'sine', 0.05); }
    },
    whoosh() {
      const c = get(); if (!c) return;
      const t = c.currentTime;
      const len = Math.floor(c.sampleRate * 0.7);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = c.createBufferSource();
      src.buffer = buf;
      const f = c.createBiquadFilter();
      f.type = 'bandpass'; f.Q.value = 1.4;
      f.frequency.setValueAtTime(500, t);
      f.frequency.exponentialRampToValueAtTime(3200, t + 0.6);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      src.connect(f).connect(g).connect(out!);
      src.start(t);
    },
    tick(progress) {
      const c = get(); if (!c) return;
      const now = performance.now();
      if (now - lastTick < 34) return;   // at full speed, clicks blend instead of piling up
      lastTick = now;
      const t = c.currentTime;
      // A dry click that drops a little in pitch as the reel slows.
      tone(c, 2300 - 700 * progress, t, 0.03, 'square', 0.07);
      tone(c, 900 - 250 * progress, t, 0.025, 'triangle', 0.05);
    },
    win() {
      // A cinematic hit, not a jingle (owner, 25 Nov: the chime sounded like a toy): a deep impact,
      // a warm wide chord that swells and fades, a little icy air, all in a short room reverb.
      const c = get(); if (!c) return;
      const t = c.currentTime;
      const wet = room(c);
      const bus = c.createGain();
      bus.gain.value = 1;
      bus.connect(out!);
      bus.connect(wet);
      // Impact: a low sine falling in pitch, plus a muffled noise punch.
      const boom = c.createOscillator(), bg = c.createGain();
      boom.type = 'sine';
      boom.frequency.setValueAtTime(72, t);
      boom.frequency.exponentialRampToValueAtTime(38, t + 1.1);
      bg.gain.setValueAtTime(0.0001, t);
      bg.gain.exponentialRampToValueAtTime(0.55, t + 0.012);
      bg.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
      boom.connect(bg).connect(bus);
      boom.start(t); boom.stop(t + 1.5);
      noiseHit(c, bus, t, 0.35, 'lowpass', 700, 0.32);
      // The chord (A, E, A, C#, E): detuned saws through a closing low-pass, slow-ish attack.
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass'; lp.Q.value = 0.7;
      lp.frequency.setValueAtTime(2400, t);
      lp.frequency.exponentialRampToValueAtTime(520, t + 2.6);
      const pg = c.createGain();
      pg.gain.setValueAtTime(0.0001, t);
      pg.gain.exponentialRampToValueAtTime(0.13, t + 0.09);
      pg.gain.exponentialRampToValueAtTime(0.0001, t + 2.9);
      lp.connect(pg).connect(bus);
      for (const f of [110, 164.8, 220, 277.2, 329.6]) {
        for (const det of [-7, 7]) {
          const o = c.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = f;
          o.detune.value = det;
          o.connect(lp);
          o.start(t); o.stop(t + 3);
        }
      }
      // Icy air: quiet high noise that fades.
      noiseHit(c, bus, t + 0.05, 1.6, 'highpass', 6500, 0.05);
    },
  };
}
