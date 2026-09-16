/**
 * engine.ts — 소리의 바탕. AudioContext 하나와 설정을 여기서만 갖는다.
 *
 * 브라우저는 **사람이 손을 대기 전에는 소리를 내주지 않는다**(자동재생 정책).
 * 그래서 컨텍스트를 미리 만들어 두지 않고, 첫 클릭·키·터치에서 깨운다.
 * 깨기 전에 들어온 요청은 조용히 버린다 — 예외를 던지면 게임이 멈춘다.
 * 소리는 있으면 좋은 것이지 게임의 조건이 아니다.
 *
 * 설정은 localStorage 에 남는다. 켜고 끈 것이 새로고침마다 되돌아오면
 * 끄는 의미가 없다.
 */

const KEY = 'samhanji.audio.v1';

export interface AudioSettings {
  /** 효과음 */
  sfx: boolean;
  /** 배경음 */
  bgm: boolean;
  /** 0~1 전체 음량 */
  volume: number;
}

const DEFAULTS: AudioSettings = { sfx: true, bgm: true, volume: 0.7 };

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // 사생활 보호 모드에서 접근 자체가 던진다.
    return null;
  }
}

function load(): AudioSettings {
  const raw = storage()?.getItem(KEY);
  if (!raw) return { ...DEFAULTS };
  try {
    const p = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      sfx: typeof p.sfx === 'boolean' ? p.sfx : DEFAULTS.sfx,
      bgm: typeof p.bgm === 'boolean' ? p.bgm : DEFAULTS.bgm,
      volume:
        typeof p.volume === 'number' && p.volume >= 0 && p.volume <= 1 ? p.volume : DEFAULTS.volume,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

let settings = load();
const watchers = new Set<(s: AudioSettings) => void>();

export function getSettings(): AudioSettings {
  return settings;
}

export function onSettings(fn: (s: AudioSettings) => void): () => void {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

export function setSettings(patch: Partial<AudioSettings>): void {
  settings = { ...settings, ...patch };
  try {
    storage()?.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* 저장하지 못해도 이번 판에서는 적용된다 */
  }
  if (master) master.gain.value = settings.volume;
  watchers.forEach((fn) => fn(settings));
}

/* ------------------------------------------------------------------ *
 * 컨텍스트
 * ------------------------------------------------------------------ */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
/** 효과음 버스. 배경음과 따로 두어야 한쪽만 끌 수 있다. */
let sfxBus: GainNode | null = null;
let bgmBus: GainNode | null = null;

/**
 * 울림(殘響) — 마루와 돌벽의 공간을 짓는다.
 *
 * 없을 때 실측해 보니 진양조 구간에 **1초짜리 완전 무음**이 났다(RMS 0).
 * 국악의 여백은 「아무 소리도 없는 것」이 아니라 「앞 음이 아직 사라지는 중」이다.
 * 잔향이 없으면 그 자리가 여백이 아니라 고장으로 들린다.
 *
 * 임펄스 응답도 파일을 쓰지 않는다 — 지수로 잦아드는 잡음을 그 자리에서 만든다.
 */
function impulseResponse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  let s = 0x2545f491;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 1) >>> 0;
      const noise = s / 2147483648 - 1;
      // 앞부분을 조금 눌러 둔다. 때린 순간에 울림이 같이 터지면 탁해진다.
      const early = Math.min(1, i / (rate * 0.02));
      d[i] = noise * early * (1 - i / len) ** decay;
    }
  }
  return buf;
}

/**
 * 사람이 손을 댔다. 이제 소리를 낼 수 있다.
 * 여러 번 불러도 안전하다 — 이미 깨어 있으면 아무 일도 하지 않는다.
 */
export function unlock(): void {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    return;
  }
  const Ctor =
    typeof window !== 'undefined'
      ? (window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : undefined;
  if (!Ctor) return; // 소리를 못 내는 환경. 게임은 그대로 돈다.

  try {
    ctx = new Ctor();
  } catch {
    return;
  }
  master = ctx.createGain();
  master.gain.value = settings.volume;

  // 전체에 가벼운 압축을 건다. 징과 북이 겹치는 순간에 귀가 아프지 않게.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.ratio.value = 4;
  comp.attack.value = 0.004;
  comp.release.value = 0.22;

  sfxBus = ctx.createGain();
  bgmBus = ctx.createGain();
  // 배경음은 효과음보다 확실히 뒤에 있어야 한다. 앞에 서면 방해가 된다.
  bgmBus.gain.value = 0.42;

  const verb = ctx.createConvolver();
  verb.buffer = impulseResponse(ctx, 2.4, 2.6);
  // 울림에서 고음을 깎는다. 안 깎으면 징이 칠 때마다 쇳소리가 방 안에 남는다.
  const verbTone = ctx.createBiquadFilter();
  verbTone.type = 'lowpass';
  verbTone.frequency.value = 3200;
  verb.connect(verbTone).connect(master);

  // 보내는 양 — 배경음은 넉넉히(공간), 효과음은 조금만(또렷해야 한다).
  const bgmSend = ctx.createGain();
  bgmSend.gain.value = 0.34;
  const sfxSend = ctx.createGain();
  sfxSend.gain.value = 0.16;
  bgmBus.connect(bgmSend).connect(verb);
  sfxBus.connect(sfxSend).connect(verb);

  sfxBus.connect(master);
  bgmBus.connect(master);
  master.connect(comp).connect(ctx.destination);
}

/** 깨어 있는 컨텍스트. 아직이면 null — 호출부는 조용히 넘어간다. */
export function audioContext(): AudioContext | null {
  return ctx && ctx.state !== 'closed' ? ctx : null;
}

export function sfxDestination(): AudioNode | null {
  return settings.sfx ? sfxBus : null;
}

export function bgmDestination(): AudioNode | null {
  return settings.bgm ? bgmBus : null;
}

/** 배경음 버스만 서서히 여닫는다 — 화면이 바뀔 때 뚝 끊기면 흉하다. */
export function fadeBgm(to: number, seconds: number): void {
  const c = audioContext();
  if (!c || !bgmBus) return;
  const t = c.currentTime;
  bgmBus.gain.cancelScheduledValues(t);
  bgmBus.gain.setValueAtTime(Math.max(0.0001, bgmBus.gain.value), t);
  bgmBus.gain.linearRampToValueAtTime(to, t + seconds);
}
