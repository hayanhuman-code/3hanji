/**
 * castleLayout.ts — 공성전 성곽의 연출 배치를 타일 데이터에서 계산한다.
 *
 * 전부 **렌더링 전용**이다. 어느 칸이 길로 보이든, 어디에 망루가 서든
 * 판정(통행·방어)은 core 의 지형 코드가 그대로 정한다.
 *
 * 배치 규칙은 `src/data/castleLayout.json` 이 정의한다 — default 에
 * 공통 규칙, overrides 에 거점 id 별 부분 오버라이드. 하드코딩 대신
 * 데이터로 두어 나중에 성마다 다르게 만들 수 있다.
 *
 * 성곽이 단순 사각형이 아니므로(한성은 외성+내성 이중 링):
 *   - 내부: 성벽·성문을 벽으로 삼아 맵 가장자리에서 플러드필 →
 *     닿지 않는 비(非)성벽 칸이 성 내부다
 *   - 모서리: 양축(가로+세로)에 성벽 이웃을 가진 성벽 타일 후보 중
 *     사분면별로 성곽 bbox 모서리에 가장 가까운 것 하나씩
 */

import rawLayout from '../../data/castleLayout.json';
import type { Battlefield } from '../../core/field/types';

interface LayoutRule {
  towerCorners: boolean;
  towerScaleTiles: number;
  roadTile: string;
  groundTile: string;
  plazaRadius: number;
  centralCross: boolean;
  decor: Array<{ name: string; every: number }>;
}

interface LayoutFile {
  default: LayoutRule;
  overrides: Record<string, Partial<LayoutRule>>;
}

const FILE = rawLayout as unknown as LayoutFile;

export interface CastleLayout {
  rule: LayoutRule;
  /** 망루가 설 모서리 성벽 타일 */
  towers: Array<{ tx: number; ty: number }>;
  /** 칸 인덱스(ty*w+tx) → 덮어 그릴 타일 이름 (길/광장/바닥) */
  overlay: Map<number, string>;
  /** 칸 인덱스 → 장식 오브젝트 이름 */
  decor: Map<number, string>;
}

const WALL = new Set(['W', 'T', 'O']);
const BLOCK = new Set(['W', 'T', 'O', 'G']); // 플러드필 기준 — 성문은 닫힌 문

const hash = (x: number, y: number) => (((x + 7) * 73856093) ^ ((y + 3) * 19349663)) >>> 0;

const cache = new Map<string, CastleLayout | null>();

export function castleLayout(f: Battlefield): CastleLayout | null {
  const hit = cache.get(f.id);
  if (hit !== undefined) return hit;
  const out = compute(f);
  cache.set(f.id, out);
  return out;
}

function compute(f: Battlefield): CastleLayout | null {
  const rule: LayoutRule = { ...FILE.default, ...(FILE.overrides[f.id] ?? {}) };
  const h = f.tiles.length;
  const w = h > 0 ? f.tiles[0].length : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || y >= h || x >= w ? '.' : f.tiles[y][x]);

  const wallCells: Array<[number, number]> = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (WALL.has(at(x, y))) wallCells.push([x, y]);
  }
  if (wallCells.length === 0) return null;

  /* --- 내부 판정: 가장자리에서 성벽을 못 뚫는 플러드필 --- */
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    const i = y * w + x;
    if (!outside[i] && !BLOCK.has(at(x, y))) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  const interior: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!outside[i] && !BLOCK.has(at(i % w, (i / w) | 0))) interior.push(i);
  }

  /* --- 모서리 성벽 타일: 양축에 성벽 이웃 → 사분면별 최외곽 하나 --- */
  const towers: Array<{ tx: number; ty: number }> = [];
  if (rule.towerCorners) {
    const isWall = (x: number, y: number) => WALL.has(at(x, y));
    const candidates = wallCells.filter(
      ([x, y]) => (isWall(x - 1, y) || isWall(x + 1, y)) && (isWall(x, y - 1) || isWall(x, y + 1))
    );
    const xs = wallCells.map(([x]) => x);
    const ys = wallCells.map(([, y]) => y);
    const bbox = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    for (const [cx, cy] of [
      [bbox[0], bbox[2]],
      [bbox[1], bbox[2]],
      [bbox[0], bbox[3]],
      [bbox[1], bbox[3]],
    ]) {
      let best: [number, number] | null = null;
      let bd = Infinity;
      for (const [x, y] of candidates) {
        const d = Math.hypot(x - cx, y - cy);
        if (d < bd) {
          bd = d;
          best = [x, y];
        }
      }
      if (best && !towers.some((t) => t.tx === best![0] && t.ty === best![1])) {
        towers.push({ tx: best[0], ty: best[1] });
      }
    }
  }

  /* --- 내부 구역: 성문 앞 광장 + 중앙 통로는 길, 나머지 평지는 바닥 --- */
  const overlay = new Map<number, string>();
  const gates: Array<[number, number]> = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (at(x, y) === 'G') gates.push([x, y]);
  }
  let cx = 0;
  let cy = 0;
  for (const i of interior) {
    cx += i % w;
    cy += (i / w) | 0;
  }
  if (interior.length) {
    cx = Math.round(cx / interior.length);
    cy = Math.round(cy / interior.length);
  }
  for (const i of interior) {
    const x = i % w;
    const y = (i / w) | 0;
    if (at(x, y) !== '.') continue; // 성 안의 숲·물 등은 실지형 그대로 보인다
    const nearGate = gates.some(
      ([gx, gy]) => Math.max(Math.abs(gx - x), Math.abs(gy - y)) <= rule.plazaRadius
    );
    const onCross = rule.centralCross && (x === cx || y === cy);
    overlay.set(i, nearGate || onCross ? rule.roadTile : rule.groundTile);
  }

  /* --- 장식: 내부 가장자리(성벽에 붙은 평지)에 드문드문. 길은 비운다 --- */
  const decor = new Map<number, string>();
  for (const i of interior) {
    const x = i % w;
    const y = (i / w) | 0;
    if (at(x, y) !== '.' || overlay.get(i) === rule.roadTile) continue;
    let nearWall = false;
    for (let dy = -1; dy <= 1 && !nearWall; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (WALL.has(at(x + dx, y + dy))) {
          nearWall = true;
          break;
        }
      }
    }
    if (!nearWall) continue;
    for (const d of rule.decor) {
      if (hash(x, y) % d.every === 0) {
        decor.set(i, d.name);
        break;
      }
    }
  }

  return { rule, towers, overlay, decor };
}
