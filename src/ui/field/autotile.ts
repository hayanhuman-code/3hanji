/**
 * autotile.ts — 지형 경계에 쓸 전환 타일을 고른다.
 *
 * 전환 타일 자체는 파이프라인이 만든다(tools/asset_pipeline, `--autotile-only`).
 * 여기서 하는 일은 「이 칸에 어떤 전환 타일을 얹을 것인가」를 정하는 것뿐이고,
 * 그 결과는 전장마다 한 번만 계산해 캐시한다 — 48×32 칸을 매 프레임 다시
 * 재면 배속에서 무너진다.
 *
 * 규칙은 파이프라인의 `autotile_pick()` 과 같다.
 *   1. 8방향 이웃 중 나보다 우선순위가 높은 지형을 찾는다 (가장 높은 하나)
 *   2. 그 지형이 상하좌우 어디에 있는지를 4비트로 (N=1,E=2,S=4,W=8) → 패턴 1~15
 *   3. 상하좌우엔 없고 대각선에만 있으면 모서리 패턴 16~19
 *
 * 렌더링 전용이다. 어떤 칸이 어떻게 보이든 통행·방어 판정은 core 의 지형
 * 코드가 그대로 정한다.
 */

import type { Battlefield, TerrainCode } from '../../core/field/types';
import { TERRAIN_TILE } from './sprites';

/** 낮은 쪽 위에 높은 쪽이 얹힌다. 파이프라인의 TERRAIN_PRIORITY 와 같은 순서 */
const PRIORITY = [
  'grass', 'road', 'sand', 'forest', 'hill', 'ridge', 'mountain', 'ford', 'river',
];
const RANK = new Map(PRIORITY.map((t, i) => [t, i]));

/** 지형 코드 → 우선순위 이름 (`tile_grass` → `grass`). 전환이 없는 코드는 null */
function terrainName(c: string): string | null {
  const tile = TERRAIN_TILE[c as TerrainCode];
  if (!tile) return null;
  const name = tile.slice('tile_'.length);
  return RANK.has(name) ? name : null;
}

const cache = new Map<string, Array<string | null>>();

/**
 * 칸마다 얹을 전환 타일 이름(`autotile/grass_river_06`). 없으면 null.
 * 인덱스는 `ty * w + tx` 이고 w 는 첫 줄의 길이다.
 */
export function autotileMap(f: Battlefield): Array<string | null> {
  const hit = cache.get(f.id);
  if (hit) return hit;

  const h = f.tiles.length;
  const w = h > 0 ? f.tiles[0].length : 0;
  const out: Array<string | null> = new Array(w * h).fill(null);

  // 지형 이름을 먼저 한 벌 만들어 둔다 — 이웃을 볼 때마다 문자열을 자르지 않게
  const names: Array<string | null> = new Array(w * h).fill(null);
  for (let y = 0; y < h; y++) {
    const row = f.tiles[y];
    for (let x = 0; x < w; x++) names[y * w + x] = terrainName(row[x] ?? '.');
  }
  const at = (x: number, y: number, fallback: string | null) =>
    x < 0 || y < 0 || x >= w || y >= h ? fallback : names[y * w + x];

  const CARDINAL: Array<[number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const DIAGONAL: Array<[number, number]> = [[1, -1], [1, 1], [-1, 1], [-1, -1]];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const mine = names[y * w + x];
      if (mine === null) continue; // 성벽·바다처럼 전환을 두지 않는 칸
      const myRank = RANK.get(mine)!;

      // 1. 8방향에서 가장 우선순위 높은 이웃 지형
      let best: string | null = null;
      let bestRank = myRank;
      for (const [dx, dy] of [...CARDINAL, ...DIAGONAL]) {
        const t = at(x + dx, y + dy, mine);
        if (t === null) continue;
        const r = RANK.get(t)!;
        if (r > bestRank) {
          best = t;
          bestRank = r;
        }
      }
      if (best === null) continue;

      // 2. 상하좌우 비트마스크
      let mask = 0;
      for (let i = 0; i < 4; i++) {
        const [dx, dy] = CARDINAL[i];
        if (at(x + dx, y + dy, mine) === best) mask |= 1 << i;
      }
      // 3. 상하좌우에 없으면 대각 모서리
      if (mask === 0) {
        for (let i = 0; i < 4; i++) {
          const [dx, dy] = DIAGONAL[i];
          if (at(x + dx, y + dy, mine) === best) {
            mask = 16 + i;
            break;
          }
        }
        if (mask === 0) continue;
      }

      const pattern = String(mask).padStart(2, '0');
      out[y * w + x] = `autotile/${mine}_${best}_${pattern}`;
    }
  }

  cache.set(f.id, out);
  return out;
}
