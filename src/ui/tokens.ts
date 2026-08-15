/**
 * tokens.ts — 디자인 토큰의 TypeScript 사본.
 *
 * 값의 출처는 `docs/design-tokens.md` §1 이다. 대비비 검증(§1.3)을 통과한 값이므로
 * **눈대중으로 고치지 않는다.** 고칠 일이 있으면 문서를 먼저 고친다.
 *
 * 왜 CSS 와 TS 두 벌인가:
 *   `BattleScreen.tsx` 의 Canvas 는 CSS 커스텀 속성을 읽지 못한다.
 *   `getComputedStyle` 로 매번 긁어 올 수도 있지만 전투 한 프레임에 수백 번 칠하므로
 *   상수로 두는 편이 맞다.
 *
 * 두 벌이 갈라지는 것은 `npm test` 의 "디자인 토큰" 검사가 막는다 —
 * `tokens.css` 의 모든 `--x: #hex` 가 여기에 같은 값으로 있는지 대조한다.
 */

export const T = {
  /* --- 지(紙)와 묵(墨) --- */
  /** 한지 바탕. 육지, 패널 배경 */
  ji: '#DDD0B2',
  /** 한 단계 어두운 지. 게이지 트랙, 길 노반 */
  jiDeep: '#CFC09C',
  /** 최외곽 테두리 */
  jiEdge: '#B5A47E',
  /** 바다 */
  hae: '#B9C3BC',
  /** 먹. 본문, 윤곽선, 반전 버튼 배경 */
  meok: '#241F1A',
  /** 담묵. 보조 텍스트, 길 선 */
  meokMid: '#554C40',
  /** 캡션 전용. 8~10px 작은 라벨 (지 위 5.10:1) */
  meokCap: '#5A5143',
  /** 테두리 전용. 지 위 2.60:1 이므로 **텍스트에 쓰지 말 것** */
  meokThin: '#8A7E6C',
  /** 진사(주사). 선택 표시, 경고, 개발 한계선 */
  jinsa: '#A83232',
  /** 수(水). 강, 항로 */
  su: '#4E7480',
  /** 결빙 상태의 강 */
  suIce: '#CBD3CD',
  /** 세력색 위에 얹는 밝은 글자 */
  onDark: '#F2EADA',

  /* --- 세력색 (문서 §1.2 — 오방색과 실제 유물에서 따온 값. 임의로 바꾸지 말 것) --- */
  /** 고구려 — 북방 현무, 짙은 군청 */
  goguryeo: '#26485C',
  /** 백제 — 백제 왕실 자주 */
  baekje: '#73315A',
  /** 신라 — 금관의 금 */
  silla: '#A8862B',
  /** 가야 — 청동 녹청 (철의 나라) */
  gaya: '#4A6B5A',
} as const;

/* ================================================================== *
 * 대비 계산
 *
 * 문서 §1.2 의 배지 규칙("세력색 위에 글자를 얹을 땐 대비 4.5:1 을 넘는 쪽을 쓴다")을
 * 표로 적어 두는 대신 계산한다. 그래야 색을 바꿔도 저절로 맞는다.
 * ================================================================== */

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 상대 휘도 */
export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 명암비 (1 ~ 21) */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 이 배경 위에 얹을 글자색 — 먹과 밝은 지 중 대비가 큰 쪽 */
export function textOn(background: string): string {
  return contrast(background, T.meok) >= contrast(background, T.onDark) ? T.meok : T.onDark;
}
