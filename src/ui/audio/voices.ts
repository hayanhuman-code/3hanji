/**
 * voices.ts — 악기(樂器). Web Audio 노드로 소리를 짓는다.
 *
 * **음원 파일을 쓰지 않는다.** 초상(`Portrait.tsx`)이 그림 없이 얼굴을 만든 것과
 * 같은 이유다 — 저장소에 외부 에셋을 들이지 않고, 라이선스를 지고 가지 않으며,
 * 첫 로딩에 한 바이트도 더하지 않는다. 대신 음색을 코드로 적는다.
 *
 * 음색을 고른 근거 (`docs/design-tokens.md` §1.2 의 세력색과 같은 자리에서 온다):
 *   고구려 — 대금·북.  낮고 굵은 세로줄. 북방 현무
 *   백제   — 아쟁.     활로 켜는 지속음. 왕실 자주
 *   신라   — 가야금.   뜯는 소리. 금관의 금
 *   가야   — 편경.     쇠·돌의 울림. 철의 나라
 *
 * 모든 함수는 `(ctx, dest, t0, …)` 를 받아 **예약만 하고 즉시 반환한다.**
 * 스케줄러가 앞당겨 예약하므로 실행 시점에 소리를 내면 이미 늦는다.
 */

/** 잡음 버퍼는 비싸다. 컨텍스트마다 한 장만 만들어 돌려 쓴다. */
const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseCache.get(ctx);
  if (!buf) {
    const len = Math.floor(ctx.sampleRate * 2);
    buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    // 결정론적 잡음 — 매 실행마다 다른 잡음을 쓸 이유가 없다.
    let s = 0x9e3779b9;
    for (let i = 0; i < len; i++) {
      s = (Math.imul(s ^ (s >>> 15), 0x85ebca6b) + 1) >>> 0;
      data[i] = (s / 2147483648 - 1) * 0.999;
    }
    noiseCache.set(ctx, buf);
  }
  return buf;
}

function noiseSource(ctx: BaseAudioContext, t0: number, dur: number): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  // 같은 버퍼를 늘 처음부터 읽으면 「같은 잡음」이 반복으로 들린다. 자리를 흩는다.
  src.start(t0, (t0 * 7919) % 1.8, dur + 0.05);
  src.stop(t0 + dur + 0.05);
  return src;
}

/** 감쇠 포락선. Web Audio 의 지수 감쇠는 0 에 닿지 못하므로 바닥을 둔다. */
function envelope(
  ctx: BaseAudioContext,
  t0: number,
  attack: number,
  dur: number,
  peak: number
): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  g.gain.setValueAtTime(0, t0 + dur + 0.01);
  return g;
}

/**
 * 농현(弄絃) — 음을 흔들고 흘린다.
 *
 * 이것이 있고 없고가 「국악처럼 들린다」와 「신시사이저 소리가 난다」를 가른다.
 * 흔들림 없는 긴 음은 국악에서 죽은 음이다.
 */
function nonghyeon(
  ctx: BaseAudioContext,
  param: AudioParam,
  t0: number,
  freq: number,
  dur: number,
  depth = 0.022
): void {
  const lfo = ctx.createOscillator();
  const amp = ctx.createGain();
  lfo.frequency.setValueAtTime(4.6, t0);
  // 흔들림은 곧바로 걸리지 않는다. 음을 낸 뒤에 얹는다.
  amp.gain.setValueAtTime(0, t0);
  amp.gain.linearRampToValueAtTime(freq * depth, t0 + Math.min(0.35, dur * 0.5));
  lfo.connect(amp).connect(param);
  lfo.start(t0);
  lfo.stop(t0 + dur + 0.05);
}

export interface NoteOpts {
  freq: number;
  dur: number;
  gain: number;
  /** 농현을 걸 것인가 */
  bend?: boolean;
}

/* ------------------------------------------------------------------ *
 * 가락 악기
 * ------------------------------------------------------------------ */

/**
 * 대금(大笒) — 가로로 부는 큰 대나무 피리.
 * 청(淸)이 떨리는 것이 특징이라 삼각파에 잡음을 조금 섞는다.
 */
export function daegeum(ctx: BaseAudioContext, dest: AudioNode, t0: number, o: NoteOpts): void {
  const { freq, dur, gain } = o;
  const g = envelope(ctx, t0, 0.09, dur, gain * 0.5);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(freq * 5, t0);

  for (const [mult, level, detune] of [
    [1, 1, 0],
    [2, 0.22, 4],
  ] as const) {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq * mult, t0);
    osc.detune.setValueAtTime(detune, t0);
    if (o.bend) nonghyeon(ctx, osc.frequency, t0, freq * mult, dur);
    const lv = ctx.createGain();
    lv.gain.value = level;
    osc.connect(lv).connect(lp);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  // 취구(吹口)의 숨소리. 이것이 없으면 피리가 아니라 오르간이 된다.
  const breath = noiseSource(ctx, t0, Math.min(0.18, dur));
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(freq * 3, t0);
  bp.Q.value = 1.2;
  const bg = envelope(ctx, t0, 0.02, Math.min(0.18, dur), gain * 0.1);
  breath.connect(bp).connect(bg).connect(dest);

  lp.connect(g).connect(dest);
}

/**
 * 가야금(伽倻琴) — 뜯는 12현.
 * 뜯은 직후 음이 살짝 처졌다가 제자리로 온다. 그 처짐이 뜯는 소리를 만든다.
 */
export function gayageum(ctx: BaseAudioContext, dest: AudioNode, t0: number, o: NoteOpts): void {
  const { freq, dur, gain } = o;
  const g = envelope(ctx, t0, 0.006, dur, gain * 0.55);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(freq * 8, t0);
  lp.frequency.exponentialRampToValueAtTime(Math.max(200, freq * 2), t0 + dur);

  for (const [type, mult, level] of [
    ['triangle', 1, 1],
    ['sawtooth', 1, 0.25],
    ['sine', 2.01, 0.18],
  ] as const) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq * mult * 1.012, t0);
    osc.frequency.exponentialRampToValueAtTime(freq * mult, t0 + 0.05);
    if (o.bend) nonghyeon(ctx, osc.frequency, t0 + 0.1, freq * mult, dur - 0.1, 0.016);
    const lv = ctx.createGain();
    lv.gain.value = level;
    osc.connect(lv).connect(lp);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }
  lp.connect(g).connect(dest);
}

/**
 * 아쟁(牙箏) — 활로 켜는 저음 현.
 * 활이 닿는 순간이 있으므로 붙는 데 시간이 걸리고, 켜는 동안 계속 살아 있다.
 */
export function ajaeng(ctx: BaseAudioContext, dest: AudioNode, t0: number, o: NoteOpts): void {
  const { freq, dur, gain } = o;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * 0.34), t0 + 0.22);
  g.gain.setValueAtTime(gain * 0.34, t0 + Math.max(0.24, dur - 0.3));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(freq * 4.2, t0);

  for (const [mult, level, detune] of [
    [1, 1, -6],
    [1, 0.5, 7],
    [2, 0.14, 0],
  ] as const) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq * mult, t0);
    osc.detune.setValueAtTime(detune, t0);
    if (o.bend) nonghyeon(ctx, osc.frequency, t0, freq * mult, dur, 0.018);
    const lv = ctx.createGain();
    lv.gain.value = level;
    osc.connect(lv).connect(lp);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }
  lp.connect(g).connect(dest);
}

/**
 * 편경(編磬) — 돌·쇠를 쳐서 울린다.
 * 배음이 정수배가 아니다. 그래서 「맑은데 음정이 흐린」 소리가 난다.
 */
export function pyeongyeong(ctx: BaseAudioContext, dest: AudioNode, t0: number, o: NoteOpts): void {
  const { freq, dur, gain } = o;
  const g = envelope(ctx, t0, 0.004, dur, gain * 0.34);
  for (const [mult, level] of [
    [1, 1],
    [2.76, 0.38],
    [5.4, 0.16],
  ] as const) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * mult, t0);
    const lv = ctx.createGain();
    lv.gain.value = level;
    osc.connect(lv).connect(g);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }
  // 채가 닿는 소리
  const tick = noiseSource(ctx, t0, 0.03);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2600;
  tick.connect(hp).connect(envelope(ctx, t0, 0.002, 0.03, gain * 0.12)).connect(dest);
  g.connect(dest);
}

/* ------------------------------------------------------------------ *
 * 타악기와 울림
 * ------------------------------------------------------------------ */

/** 북(鼓) — 가죽. 때리는 순간 음정이 뚝 떨어진다. */
export function buk(ctx: BaseAudioContext, dest: AudioNode, t0: number, gain: number): void {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(164, t0);
  osc.frequency.exponentialRampToValueAtTime(52, t0 + 0.16);
  osc.connect(envelope(ctx, t0, 0.004, 0.42, gain * 0.9)).connect(dest);
  osc.start(t0);
  osc.stop(t0 + 0.5);

  const skin = noiseSource(ctx, t0, 0.09);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  skin.connect(lp).connect(envelope(ctx, t0, 0.002, 0.09, gain * 0.32)).connect(dest);
}

/** 징(鉦) — 놋쇠. 길게 퍼지며 음정이 흐려진다. 전투의 시작과 끝을 알린다. */
export function jing(ctx: BaseAudioContext, dest: AudioNode, t0: number, gain: number): void {
  const dur = 2.6;
  const g = envelope(ctx, t0, 0.02, dur, gain * 0.42);
  for (const [f, level] of [
    [182, 1],
    [268, 0.6],
    [411, 0.38],
    [623, 0.2],
  ] as const) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f, t0);
    // 놋쇠는 울리는 동안 음이 조금씩 내려앉는다.
    osc.frequency.exponentialRampToValueAtTime(f * 0.97, t0 + dur);
    const lv = ctx.createGain();
    lv.gain.value = level;
    osc.connect(lv).connect(g);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }
  const crash = noiseSource(ctx, t0, 0.5);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1800;
  bp.Q.value = 0.7;
  crash.connect(bp).connect(envelope(ctx, t0, 0.005, 0.5, gain * 0.18)).connect(dest);
  g.connect(dest);
}

/** 박(拍) — 나무를 마주쳐 친다. 누름·확정의 소리. */
export function woodTap(ctx: BaseAudioContext, dest: AudioNode, t0: number, gain: number): void {
  const src = noiseSource(ctx, t0, 0.05);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(1500, t0);
  bp.frequency.exponentialRampToValueAtTime(700, t0 + 0.05);
  bp.Q.value = 2.4;
  src.connect(bp).connect(envelope(ctx, t0, 0.002, 0.06, gain)).connect(dest);
}

/** 종이·천이 스치는 소리. 창을 여닫을 때. */
export function paperSlide(
  ctx: BaseAudioContext,
  dest: AudioNode,
  t0: number,
  gain: number,
  up: boolean
): void {
  const src = noiseSource(ctx, t0, 0.14);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 0.8;
  bp.frequency.setValueAtTime(up ? 900 : 2100, t0);
  bp.frequency.exponentialRampToValueAtTime(up ? 2400 : 800, t0 + 0.14);
  src.connect(bp).connect(envelope(ctx, t0, 0.015, 0.14, gain * 0.5)).connect(dest);
}
