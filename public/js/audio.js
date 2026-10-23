// 효과음: 외부 파일 없이 WebAudio로 직접 만든다.
  let audioCtx = null;
  let muted = false;
export function sfx(kind) {
    if (muted) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
      const t0 = audioCtx.currentTime;
      const tone = (freq, start, dur, type, vol, slideTo) => {
        const o = audioCtx.createOscillator();
        const gn = audioCtx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, t0 + start);
        if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + start + dur);
        gn.gain.setValueAtTime(vol, t0 + start);
        gn.gain.exponentialRampToValueAtTime(0.001, t0 + start + dur);
        o.connect(gn).connect(audioCtx.destination);
        o.start(t0 + start);
        o.stop(t0 + start + dur + 0.02);
      };
      const noise = (start, dur, vol, cutoff) => {
        const n = Math.floor(audioCtx.sampleRate * dur);
        const buf = audioCtx.createBuffer(1, n, audioCtx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        const f = audioCtx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = cutoff;
        const gn = audioCtx.createGain();
        gn.gain.value = vol;
        src.connect(f).connect(gn).connect(audioCtx.destination);
        src.start(t0 + start);
      };
      if (kind === "click") tone(520, 0, 0.06, "square", 0.04);
      else if (kind === "move") { noise(0, 0.1, 0.07, 1200); noise(0.2, 0.1, 0.07, 1200); noise(0.4, 0.1, 0.07, 1200); }
      else if (kind === "hurt") { tone(180, 0, 0.25, "sawtooth", 0.1, 70); noise(0, 0.15, 0.1, 600); }
      else if (kind === "good") { tone(660, 0, 0.1, "triangle", 0.07); tone(880, 0.1, 0.16, "triangle", 0.07); }
      else if (kind === "bad") tone(220, 0, 0.22, "square", 0.05, 140);
      else if (kind === "boar") { tone(110, 0, 0.35, "sawtooth", 0.1, 60); noise(0, 0.3, 0.1, 500); }
      else if (kind === "wave") noise(0, 0.9, 0.06, 500);
      else if (kind === "win") [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.2, 0.45, "triangle", 0.09));
      else if (kind === "lose") [392, 330, 262, 196].forEach((f, i) => tone(f, i * 0.38, 0.65, "sine", 0.09));
    } catch {}
  }



export function setMuted(v) {
  muted = !!v;
}
export const isMuted = () => muted;
