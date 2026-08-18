/**
 * sprites.ts — 전장 픽셀아트 에셋 로더.
 *
 * public/assets/sprites/ (scripts/sync-assets.mjs 가 채운다)의 PNG 를
 * 이름으로 받아 온다. 아직 로드 전이거나 파일이 없으면 null 을 돌려주고,
 * 호출부(FieldCanvas)는 기존 색 블록으로 폴백한다 — 에셋이 없어도
 * 게임은 그대로 돌아야 한다(개발 중 안전장치).
 *
 * 로드가 끝나면 구독자에게 알린다. 일시정지 화면처럼 틱이 멈춘 상태에서도
 * 이미지가 도착하는 즉시 다시 그리기 위해서다.
 */

import type { TerrainCode } from '../../core/field/types';
import type { FactionId, Troop } from '../../core/types';

const BASE = `${import.meta.env.BASE_URL}assets/sprites/`;

/** 지형 코드 → 타일 이미지 이름. 없는 코드는 색 블록으로 남는다 */
export const TERRAIN_TILE: Partial<Record<TerrainCode, string>> = {
  '.': 'tile_grass',
  f: 'tile_forest',
  m: 'tile_mountain',
  // 구릉 — tile_hill 채택(밝은 초지 융기가 구릉에 맞다). tile_ridge 는 예비.
  h: 'tile_hill',
  '~': 'tile_river',
  '=': 'tile_ford',
  r: 'tile_road',
  S: 'tile_sand',
  B: 'tile_bridge',
};

/** 병종 → 스프라이트 이름 조각 */
export const TROOP_SPRITE: Record<Troop, string> = {
  inf: 'infantry',
  cav: 'cavalry',
  arc: 'archer',
  str: 'strategist',
};

/** 진영별 스프라이트가 준비된 세력. 그 외(가야 등)는 원본 스프라이트를 쓴다 */
const FACTION_SPRITES: ReadonlySet<string> = new Set(['goguryeo', 'baekje', 'silla']);

/** 부대 스프라이트 경로 조각. `unit_infantry` 또는 `factions/unit_infantry_silla` */
export function unitSpriteName(troop: Troop, faction: FactionId): string {
  const base = `unit_${TROOP_SPRITE[troop]}`;
  return FACTION_SPRITES.has(faction) ? `factions/${base}_${faction}` : base;
}

const cache = new Map<string, HTMLImageElement>();
const failed = new Set<string>();
const listeners = new Set<() => void>();

/** 이미지가 도착해 다시 그려야 할 때 불린다. 해제 함수를 돌려준다 */
export function onSpriteLoad(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * 이름으로 스프라이트를 얻는다. 로드 전·실패 시 null.
 * 첫 호출에서 로드를 시작하므로 그리기 루프에서 바로 불러도 된다.
 */
export function sprite(name: string): HTMLImageElement | null {
  if (failed.has(name)) return null;
  let img = cache.get(name);
  if (!img) {
    img = new Image();
    img.src = `${BASE}${name}.png`;
    img.onload = () => listeners.forEach((fn) => fn());
    img.onerror = () => {
      failed.add(name);
    };
    cache.set(name, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}
