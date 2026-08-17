/**
 * field/battlefield.ts — 전장 76곳을 읽고 지형을 묻는다.
 *
 * `src/data/battlemaps.json` 은 거점마다 실제 해안선·하천을 7×5km 로 잘라
 * 48×32 타일로 만든 것이다(pipeline/build_battlemaps.py). 전략맵이 실제
 * 경위도인 것과 같은 이유로, 전장도 그 자리의 실제 지형이어야 한다 —
 * 살수와 안시성이 달라 보이지 않으면 실지형을 쓸 까닭이 없다.
 */

import raw from '../../data/battlemaps.json';
import { TERRAIN } from './balance';
import type { Battlefield, TerrainCode } from './types';

interface RawFile {
  legend: Record<string, string>;
  maps: Record<string, Battlefield>;
}

const FILE = raw as unknown as RawFile;

export const BATTLEFIELDS: Record<string, Battlefield> = FILE.maps;
export const BATTLEFIELD_IDS: string[] = Object.keys(FILE.maps);

export function battlefield(id: string): Battlefield {
  const f = FILE.maps[id];
  if (!f) throw new Error(`없는 전장: ${id}`);
  return f;
}

/** 타일 하나의 실제 크기(m). 7000/48 ≈ 146m × 5000/32 ≈ 156m */
export function tileSize(f: Battlefield): [number, number] {
  return [(f.kmW * 1000) / f.w, (f.kmH * 1000) / f.h];
}

export function fieldSizeM(f: Battlefield): [number, number] {
  return [f.kmW * 1000, f.kmH * 1000];
}

/** 미터 좌표 → 타일 기호. 밖이면 평지로 본다 */
export function terrainAt(f: Battlefield, x: number, y: number): TerrainCode {
  const [tw, th] = tileSize(f);
  const cx = Math.floor(x / tw);
  const cy = Math.floor(y / th);
  if (cx < 0 || cy < 0 || cy >= f.tiles.length) return '.';
  const row = f.tiles[cy];
  if (cx >= row.length) return '.';
  const c = row[cx] as TerrainCode;
  return TERRAIN[c] ? c : '.';
}

export function specAt(f: Battlefield, x: number, y: number) {
  return TERRAIN[terrainAt(f, x, y)];
}

/**
 * 육군이 지나갈 수 있는가.
 *
 * 험지(X)와 물(강·바다)은 못 지난다. 험지는 전체 타일의 0.8% 뿐이지만
 * 17개 전장에 몰려 있어(살수 31%) 거기서는 통로가 극도로 좁아진다.
 * 대군이 좁은 여울로 몰릴 수밖에 없고, 거기서 수계를 맞으면 끝난다 —
 * **지형이 전술을 강제하는 것**이 실지형을 쓰는 값이다 (§5.3).
 */
export function passable(f: Battlefield, x: number, y: number, navy: boolean): boolean {
  const [w, h] = fieldSizeM(f);
  if (x < 0 || y < 0 || x > w || y > h) return false;
  const code = terrainAt(f, x, y);
  const s = TERRAIN[code];
  if (navy) return !!s.water || code === 'P';
  // 하천은 누구나 뗏목으로 건넌다. 다만 물 위에서는 거의 못 싸운다(balance.ts).
  // 먼바다는 열지 않는다 — 뗏목으로 외해를 건너지는 못한다.
  return s.move > 0;
}

/** 지금 물 위에 있는가. 이동 속도와 전투력이 통째로 달라지는 자리다 */
export function onWater(f: Battlefield, x: number, y: number): boolean {
  return !!TERRAIN[terrainAt(f, x, y)].water;
}

/** 그 변의 한가운데 좌표 — 진입 방향에서 전장으로 들어온다 (§5.4) */
export function edgeEntry(f: Battlefield, edge: 'N' | 'E' | 'S' | 'W'): { x: number; y: number } {
  const [w, h] = fieldSizeM(f);
  const pad = 200;
  switch (edge) {
    case 'N':
      return { x: w / 2, y: pad };
    case 'S':
      return { x: w / 2, y: h - pad };
    case 'W':
      return { x: pad, y: h / 2 };
    case 'E':
      return { x: w - pad, y: h / 2 };
  }
}

/** 마주 보는 변 */
export function oppositeEdge(e: 'N' | 'E' | 'S' | 'W'): 'N' | 'E' | 'S' | 'W' {
  return e === 'N' ? 'S' : e === 'S' ? 'N' : e === 'E' ? 'W' : 'E';
}

/** 전장 요약 — 편성 화면에서 어디로 갈지 고를 때 보여 준다 */
export function fieldSummary(f: Battlefield): string {
  const counts = new Map<TerrainCode, number>();
  let total = 0;
  for (const row of f.tiles) {
    for (const ch of row) {
      const c = ch as TerrainCode;
      if (!TERRAIN[c]) continue;
      counts.set(c, (counts.get(c) ?? 0) + 1);
      total++;
    }
  }
  const pct = (c: TerrainCode) => Math.round(((counts.get(c) ?? 0) / total) * 100);
  const parts: string[] = [];
  if (pct('m') > 5) parts.push(`산악 ${pct('m')}%`);
  if (pct('X') > 0) parts.push(`험지 ${pct('X')}%`);
  if (pct('f') > 10) parts.push(`숲 ${pct('f')}%`);
  if (f.hasRiver) parts.push('하천');
  if (f.hasSea) parts.push('바다');
  return parts.join(' · ') || '평지';
}
