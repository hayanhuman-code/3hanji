/**
 * hex.ts — 헥스 그리드 기하.
 *
 * 내부 좌표는 axial(q, r), 맵 생성·표시는 odd-r offset(col, row)을 쓴다.
 * 렌더링은 pointy-top 기준.
 */

export interface Axial {
  q: number;
  r: number;
}

export const HEX_DIRECTIONS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function hexKey(q: number, r: number): string {
  return `${q},${r}`;
}

export function parseKey(key: string): Axial {
  const [q, r] = key.split(',').map(Number);
  return { q, r };
}

export function hexEquals(a: Axial, b: Axial): boolean {
  return a.q === b.q && a.r === b.r;
}

export function hexDistance(a: Axial, b: Axial): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

export function hexNeighbors(a: Axial): Axial[] {
  return HEX_DIRECTIONS.map((d) => ({ q: a.q + d.q, r: a.r + d.r }));
}

/** odd-r offset (col, row) → axial */
export function offsetToAxial(col: number, row: number): Axial {
  return { q: col - ((row - (row & 1)) >> 1), r: row };
}

/** axial → odd-r offset */
export function axialToOffset(a: Axial): { col: number; row: number } {
  return { col: a.q + ((a.r - (a.r & 1)) >> 1), row: a.r };
}

/** 화면 좌표 (pointy-top, size = 헥스 외접원 반지름) */
export function hexToPixel(a: Axial, size: number): { x: number; y: number } {
  return {
    x: size * Math.sqrt(3) * (a.q + a.r / 2),
    y: size * 1.5 * a.r,
  };
}

/** 화면 좌표 → 가장 가까운 헥스 */
export function pixelToHex(x: number, y: number, size: number): Axial {
  const q = ((Math.sqrt(3) / 3) * x - (1 / 3) * y) / size;
  const r = ((2 / 3) * y) / size;
  return hexRound(q, r);
}

export function hexRound(qf: number, rf: number): Axial {
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

/** 육각형 꼭짓점 (pointy-top) */
export function hexCorners(cx: number, cy: number, size: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    pts.push([cx + size * Math.cos(angle), cy + size * Math.sin(angle)]);
  }
  return pts;
}
