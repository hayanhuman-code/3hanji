/**
 * scale.ts — 음계와 가락 생성. **Web Audio 를 모른다.**
 *
 * 소리를 내는 부분(`voices.ts`·`bgm.ts`)은 브라우저 없이는 한 줄도 돌릴 수 없다.
 * 그래서 「무엇을 연주할 것인가」만 여기로 떼어 냈다 — 순수 함수이므로
 * `npm test` 가 검사한다. 음이 음계를 벗어나거나 같은 씨앗에서 다른 가락이 나오면
 * 거기서 잡힌다.
 *
 * 왜 12평균율인가:
 *   국악의 12율(黃鍾…應鍾)은 삼분손익법으로 뽑은 순정률이라 평균율과 몇 센트씩
 *   어긋난다. 그러나 이 게임의 소리는 합주가 아니라 배경이고, 평균율로 두면
 *   브라우저 오실레이터에 그대로 실린다. 율명은 이름으로만 남긴다.
 */

import { RngCursor } from '../../core/rng';

/** 12율명 — 황종을 0 으로 한 반음 거리 */
export const YULMYEONG = [
  '黃', // 황종 0
  '大', // 대려 1
  '太', // 태주 2
  '夾', // 협종 3
  '姑', // 고선 4
  '仲', // 중려 5
  '蕤', // 유빈 6
  '林', // 임종 7
  '夷', // 이칙 8
  '南', // 남려 9
  '無', // 무역 10
  '應', // 응종 11
] as const;

/**
 * 조(調) — 국악의 두 음계.
 *
 * 평조(平調)는 밝고 너그럽다. 계면조(界面調)는 반음이 끼어 애조를 띤다.
 * 둘 다 5음이다 — 7음 음계로 만들면 순식간에 서양 배경음악이 된다.
 */
export const MODES = {
  /** 평조 — 황 태 중 임 남 */
  pyeongjo: [0, 2, 5, 7, 9],
  /** 계면조 — 황 협 중 임 무 */
  gyemyeonjo: [0, 3, 5, 7, 10],
} as const;

export type ModeName = keyof typeof MODES;

/**
 * 음계의 도(度)를 반음 거리로 옮긴다. 5를 넘어가면 옥타브가 올라간다.
 * 음수도 받는다 — 가락이 아래로 흐를 수 있어야 한다.
 */
export function degreeToSemitone(mode: ModeName, degree: number): number {
  const steps = MODES[mode];
  const n = steps.length;
  // % 는 음수에서 음수를 낸다. 파이썬처럼 감아 준다.
  const octave = Math.floor(degree / n);
  const index = degree - octave * n;
  return steps[index]! + octave * 12;
}

/** 반음 거리를 주파수로. `base` 는 그 조의 황종 주파수다. */
export function hz(base: number, semitone: number): number {
  return base * 2 ** (semitone / 12);
}

/** 음 하나 — 언제(박), 어느 도, 얼마나 */
export interface Note {
  /** 악구 시작부터의 박 수 */
  at: number;
  /** 음계의 도. `degreeToSemitone` 에 넣는다 */
  degree: number;
  /** 길이(박) */
  len: number;
  /** 0~1. 셈여림 */
  velocity: number;
  /** 농현(弄絃) — 이 음을 흔들거나 흘려 낸다 */
  bend: boolean;
}

/** 가락을 지을 때의 성격 */
export interface PhraseShape {
  /** 악구 길이(박) */
  beats: number;
  /** 도의 범위 [최저, 최고] */
  range: [number, number];
  /** 쉼이 될 확률 0~1. 국악은 빈 자리가 많다 — 0.3 아래로 내리면 수다스러워진다 */
  rest: number;
  /** 한 음의 기본 길이(박) */
  step: number;
}

/**
 * 악구(樂句) 하나를 짓는다.
 *
 * 규칙은 셋뿐이다.
 *  ① 큰 도약 뒤에는 되짚어 내려온다 — 제자리로 돌아오지 않으면 가락이 흩어진다.
 *  ② 악구의 끝은 으뜸음(0도)이나 5도로 앉는다.
 *  ③ 긴 음에는 농현을 건다. 국악에서 흔들리지 않는 긴 음은 죽은 음이다.
 *
 * 같은 씨앗은 언제나 같은 악구를 낸다 — 코어의 난수와 같은 규칙이다.
 */
export function makePhrase(seed: number, shape: PhraseShape): Note[] {
  const rng = new RngCursor(seed);
  const [lo, hi] = shape.range;
  const notes: Note[] = [];
  let degree = 0;
  let at = 0;
  let lastLeap = 0;

  while (at < shape.beats) {
    if (rng.next() < shape.rest) {
      at += shape.step;
      continue;
    }

    // ① 직전에 크게 뛰었으면 반대 방향으로 한 걸음 되짚는다.
    let move: number;
    if (Math.abs(lastLeap) >= 2) {
      move = -Math.sign(lastLeap);
    } else {
      const r = rng.next();
      move = r < 0.42 ? 1 : r < 0.84 ? -1 : r < 0.92 ? 2 : -2;
    }
    degree = Math.max(lo, Math.min(hi, degree + move));
    lastLeap = move;

    // 길이는 한 박이 기본이고 가끔 늘어진다. 늘어진 음이 악구의 숨이 된다.
    const long = rng.next() < 0.22;
    const len = shape.step * (long ? 2.5 : 1);

    notes.push({
      at,
      degree,
      len,
      velocity: 0.55 + rng.next() * 0.35,
      // ③ 긴 음에만 농현
      bend: long || rng.next() < 0.18,
    });
    at += len;
  }

  // ② 마침음. 없는 악구는 끝나지 않은 것처럼 들린다.
  const last = notes[notes.length - 1];
  if (last) {
    last.degree = rng.next() < 0.7 ? 0 : 3;
    last.len = Math.max(last.len, shape.step * 2);
    last.bend = true;
  }
  return notes;
}

/**
 * 장단(長短) — 북의 자리.
 *
 * 진양조는 느리게 세 번, 중모리는 여섯, 자진모리는 몰아친다.
 * 값은 「한 주기 안에서 북이 울리는 박」이다. 1 은 센 가락(合), 0.5 는 여린 가락.
 */
export const JANGDAN = {
  /** 진양조 — 가장 느리다. 지도 화면 */
  jinyang: { beats: 12, hits: [[0, 1] as const, [6, 0.45] as const, [9, 0.35] as const] },
  /** 중모리 — 보통. 전운이 감돌 때 */
  jungmori: {
    beats: 12,
    hits: [[0, 1] as const, [3, 0.4] as const, [6, 0.7] as const, [9, 0.4] as const],
  },
  /** 자진모리 — 몰아친다. 전장 */
  jajinmori: {
    beats: 8,
    hits: [
      [0, 1] as const,
      [2, 0.5] as const,
      [3, 0.35] as const,
      [4, 0.8] as const,
      [6, 0.5] as const,
      [7, 0.35] as const,
    ],
  },
} as const;

export type JangdanName = keyof typeof JANGDAN;
