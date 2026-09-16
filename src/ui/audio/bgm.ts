/**
 * bgm.ts — 배경음. 악보 없이 그때그때 짓는다.
 *
 * 곡 파일을 두지 않는 이유는 `voices.ts` 와 같다. 덤으로 얻는 것이 있다 —
 * **곡이 반복되지 않는다.** 30초짜리 루프는 세 번째부터 귀에 걸리는데,
 * 악구를 매번 새로 지으면 그 자리가 생기지 않는다.
 *
 * 예약 방식(look-ahead):
 *   `setInterval` 은 정확하지 않다. 그 위에서 음을 내면 박이 흔들린다.
 *   그래서 타이머는 **앞으로 SCHEDULE_AHEAD 초 안에 들어올 음을 미리 예약만** 하고,
 *   실제 시각은 AudioContext 의 시계가 잡는다. Web Audio 의 표준 방식이다.
 */

import { audioContext, bgmDestination, fadeBgm } from './engine';
import {
  JANGDAN,
  MODES,
  degreeToSemitone,
  hz,
  makePhrase,
  type JangdanName,
  type ModeName,
  type Note,
} from './scale';
import { ajaeng, buk, daegeum, gayageum, pyeongyeong } from './voices';
import type { FactionId } from '../../core/types';

/** 이만큼 앞의 음까지 미리 예약한다(초) */
const SCHEDULE_AHEAD = 0.6;
/** 예약 타이머 간격(ms). AHEAD 의 절반보다 짧아야 빈틈이 없다 */
const TICK_MS = 180;

type Instrument = 'daegeum' | 'gayageum' | 'ajaeng' | 'pyeongyeong';

/**
 * 세력마다 다른 악기와 조(調)를 준다.
 * 근거는 `docs/design-tokens.md` §1.2 의 세력색과 같은 자리다 — 색을 고른 이유가
 * 소리를 고른 이유이기도 하다.
 */
const VOICE: Record<FactionId, { lead: Instrument; mode: ModeName; base: number }> = {
  // 북방 현무. 굵고 낮게, 애조를 띤다
  goguryeo: { lead: 'daegeum', mode: 'gyemyeonjo', base: 174.61 },
  // 왕실 자주. 활로 켜는 지속음
  baekje: { lead: 'ajaeng', mode: 'gyemyeonjo', base: 196 },
  // 금관의 금. 뜯는 소리, 밝은 조
  silla: { lead: 'gayageum', mode: 'pyeongjo', base: 261.63 },
  // 철의 나라. 쇠와 돌
  gaya: { lead: 'pyeongyeong', mode: 'pyeongjo', base: 293.66 },
};

const PLAY: Record<
  Instrument,
  (ctx: BaseAudioContext, dest: AudioNode, t: number, o: { freq: number; dur: number; gain: number; bend?: boolean }) => void
> = { daegeum, gayageum, ajaeng, pyeongyeong };

/** 어떤 판인가 — 화면과 국면이 장단과 속도를 정한다 */
export type Track = 'title' | 'map' | 'battle';

interface TrackShape {
  jangdan: JangdanName;
  /** 분당 박 */
  bpm: number;
  /** 쉼 확률. 높을수록 성기다 */
  rest: number;
  /**
   * 가락이 놓이는 칸(박).
   *
   * 1 로 두었더니 진양조(12박·52bpm)가 13.8초에 여섯 음이었다 — 성긴 것이 아니라
   * 비어 있었다. 장단은 그대로 느리게 두고 가락만 반박으로 쪼갠다.
   */
  step: number;
  /** 북을 칠 것인가 */
  drums: boolean;
  gain: number;
}

const TRACKS: Record<Track, TrackShape> = {
  // 시작 화면 — 고르는 동안 방해하지 않는다. 북 없이 가락만.
  title: { jangdan: 'jinyang', bpm: 44, rest: 0.4, step: 0.5, drums: false, gain: 0.5 },
  // 지도 — 진양조. 가장 느린 장단이다. 오래 켜 두는 화면이라 성글어야 한다.
  map: { jangdan: 'jinyang', bpm: 52, rest: 0.36, step: 0.5, drums: true, gain: 0.45 },
  // 전장 — 자진모리. 몰아친다.
  battle: { jangdan: 'jajinmori', bpm: 116, rest: 0.26, step: 0.5, drums: true, gain: 0.6 },
};

/* ------------------------------------------------------------------ *
 * 상태
 * ------------------------------------------------------------------ */

let timer: ReturnType<typeof setInterval> | null = null;
let track: Track | null = null;
let faction: FactionId = 'silla';
/** 다음으로 예약해야 할 시각(컨텍스트 시계) */
let cursor = 0;
/** 악구 번호. 씨앗으로 쓴다 — 같은 판에서 같은 순서가 나온다 */
let phraseNo = 0;
let phrase: Note[] = [];
/** 이번 악구가 시작한 시각과 한 박의 길이 */
let phraseAt = 0;
let beat = 0;
/** 이번 악구에서 몇 번째 음까지 예약했는가 */
let noteAt = 0;
let drumAt = 0;
let seed = 0x5ee7;

function shape(): TrackShape {
  return TRACKS[track ?? 'map'];
}

/** 다음 악구를 짓는다. 장단 한 주기에 맞춘다. */
function nextPhrase(now: number): void {
  const s = shape();
  const jd = JANGDAN[s.jangdan];
  beat = 60 / s.bpm;
  phraseAt = now;
  noteAt = 0;
  drumAt = 0;
  phraseNo++;
  seed = (Math.imul(seed, 0x9e3779b1) + phraseNo) >>> 0;
  phrase = makePhrase(seed, {
    beats: jd.beats,
    // 가락은 한 옥타브 반 안에서 논다. 더 넓히면 배경음이 아니라 독주가 된다.
    range: [-3, 6],
    rest: s.rest,
    step: s.step,
  });
}

function scheduleUntil(limit: number): void {
  const ctx = audioContext();
  const dest = bgmDestination();
  if (!ctx || !dest || !track) return;

  const s = shape();
  const jd = JANGDAN[s.jangdan];
  const v = VOICE[faction];
  const lead = PLAY[v.lead];

  for (let guard = 0; guard < 200; guard++) {
    const phraseEnd = phraseAt + jd.beats * beat;

    // 이번 악구의 음들
    while (noteAt < phrase.length) {
      const n = phrase[noteAt]!;
      const t = phraseAt + n.at * beat;
      if (t > limit) return;
      // 지나간 음은 버린다. 예약 시각이 과거면 Web Audio 가 「지금」으로 당겨
      // 울리므로, 밀린 음이 한꺼번에 터진다 (아래 tick 의 주석 참조).
      if (t < ctx.currentTime) {
        noteAt++;
        continue;
      }
      lead(ctx, dest, t, {
        freq: hz(v.base, degreeToSemitone(v.mode, n.degree)),
        dur: Math.max(0.25, n.len * beat * 0.92),
        gain: n.velocity * s.gain,
        bend: n.bend,
      });
      noteAt++;
    }

    // 장단
    if (s.drums) {
      while (drumAt < jd.hits.length) {
        const [at, strength] = jd.hits[drumAt]!;
        const t = phraseAt + at * beat;
        if (t > limit) return;
        if (t < ctx.currentTime) {
          drumAt++;
          continue;
        }
        buk(ctx, dest, t, strength * s.gain * 0.75);
        drumAt++;
      }
    }

    if (phraseEnd > limit) return;
    nextPhrase(phraseEnd);
  }
}

function tick(): void {
  const ctx = audioContext();
  if (!ctx || !track) return;
  if (!bgmDestination()) return; // 배경음이 꺼졌다 — 예약을 멈춘다

  /*
   * 시계가 저 혼자 흘러간 동안을 따라잡지 않는다.
   *
   * 두 가지 경우에 예약기가 멈춰 선다 — 설정에서 배경음을 껐다가 다시 켤 때와,
   * 탭을 떠나 있어 브라우저가 setInterval 을 분 단위로 조인 동안이다. 그동안
   * `phraseAt` 은 한참 과거에 남는다. 그 자리에서 이어 예약하면 **밀린 음이
   * 통째로 지금으로 당겨져 한꺼번에 터진다.**
   *
   * 그래서 한 악구 이상 밀렸으면 따라잡지 말고 지금 자리에서 새로 시작한다.
   * 음악은 이어지는 것이지 밀린 일감이 아니다.
   */
  const jd = JANGDAN[shape().jangdan];
  if (phraseAt + jd.beats * beat < ctx.currentTime - 0.5) nextPhrase(ctx.currentTime + 0.1);

  const limit = ctx.currentTime + SCHEDULE_AHEAD;
  if (cursor < ctx.currentTime) cursor = ctx.currentTime;
  scheduleUntil(limit);
  cursor = limit;
}

/* ------------------------------------------------------------------ *
 * 바깥에서 쓰는 것
 * ------------------------------------------------------------------ */

/**
 * 이 판을 틀어 둔다. 같은 판을 다시 걸면 아무 일도 하지 않는다 —
 * 리렌더마다 곡이 처음부터 다시 시작하면 안 된다.
 */
export function setTrack(next: Track | null, who?: FactionId): void {
  const changedFaction = who !== undefined && who !== faction;
  if (next === track && !changedFaction) return;

  if (who !== undefined) faction = who;
  track = next;

  if (!next) {
    stop();
    return;
  }
  const ctx = audioContext();
  if (!ctx) return;

  // 판이 바뀌면 악구도 새로 시작한다. 진행 중이던 음은 제 길이만큼 울리고 끝난다.
  nextPhrase(ctx.currentTime + 0.25);
  cursor = ctx.currentTime;
  fadeBgm(0.42, 1.2);
  if (!timer) timer = setInterval(tick, TICK_MS);
  tick();
}

export function stop(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  track = null;
  fadeBgm(0, 0.6);
}

/** 지금 무엇이 걸려 있는가 (설정을 켤 때 되살리려고 둔다) */
export function currentTrack(): Track | null {
  return track;
}

/** 곡이 음계를 벗어나지 않는지 화면 없이 확인할 때 쓴다 (`npm test`) */
export const _internals = { VOICE, TRACKS, MODES };
