/**
 * field/pathfind.ts — 전장 안에서 길을 찾는다.
 *
 * 왜 필요한가: 처음에는 부대를 목표 쪽으로 곧장 밀었다. 그랬더니 한성
 * 전장에서 양군이 **한강을 사이에 두고 아홉 시간을 마주 본 채 지쳐 쓰러졌다**.
 * 강가에 닿으면 옆으로 미끄러지기만 할 뿐 여울을 찾아갈 방법이 없었다.
 *
 * 이 파일이 §5.3 을 실제로 성립시킨다. 험지가 통로를 좁히고, 강은 여울로만
 * 건널 수 있고, 길(r)은 빠르다 — 그 셋이 부대의 실제 경로를 바꿔야
 * 「지형이 곧 전술」이라는 말이 값을 한다.
 *
 * 격자는 48×32 = 1,536칸뿐이라 다익스트라를 매번 새로 돌려도 싸다.
 * 그래도 매 틱 돌릴 이유는 없으므로 부대마다 경로를 들고 다니며 가끔 고친다.
 */

import { TERRAIN } from './balance';
import { tileSize } from './battlefield';
import type { Battlefield, TerrainCode } from './types';

export interface Point {
  x: number;
  y: number;
}

/** 이웃 여덟 칸. 매 노드에서 배열을 새로 만들지 않도록 밖에 둔다 */
const NEIGHBORS = [1, 0, -1, 0, 0, 1, 0, -1, 1, 1, 1, -1, -1, 1, -1, -1] as const;

/**
 * 타일 통행 비용. 0 이면 못 지나간다.
 *
 * 육군에게 하천은 **갈 수는 있지만 비싸다.** 뗏목을 엮어 건너는 동안 거의
 * 못 싸우기 때문이다(balance.ts ④-b). 비용을 높게 두면 부대는 웬만하면
 * 여울과 뭍으로 돌아가고, 정말 질러야 할 때만 물에 든다 — 그 선택이
 * 도박이 되는 것이 이 규칙의 목적이다.
 */
const RIVER_COST = 9;

function cost(f: Battlefield, cx: number, cy: number, navy: boolean): number {
  if (cx < 0 || cy < 0 || cy >= f.tiles.length) return 0;
  const row = f.tiles[cy];
  if (cx >= row.length) return 0;
  const code = row[cx] as TerrainCode;
  const s = TERRAIN[code];
  if (!s) return 1;
  if (navy) return s.water || code === 'P' ? 1 : 0;
  if (code === '~') return RIVER_COST;
  return s.move > 0 ? 1 / s.move : 0;
}

function toTile(f: Battlefield, p: Point): [number, number] {
  const [tw, th] = tileSize(f);
  return [Math.floor(p.x / tw), Math.floor(p.y / th)];
}

function toMeters(f: Battlefield, cx: number, cy: number): Point {
  const [tw, th] = tileSize(f);
  return { x: (cx + 0.5) * tw, y: (cy + 0.5) * th };
}

/**
 * 두 점 사이가 곧장 갈 수 있는가.
 *
 * 대부분의 경우 길찾기가 필요 없다 — 앞이 트여 있으면 그냥 가면 된다.
 * 막혔을 때만 비싼 계산을 한다.
 */
export function lineOfMarch(f: Battlefield, a: Point, b: Point, navy: boolean): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  // 타일 하나가 146m 다. 그보다 촘촘히 훑어 봐야 같은 칸을 다시 볼 뿐이고,
  // 이 함수는 부대마다 매 틱 불리므로 상수가 그대로 프레임을 먹는다.
  const steps = Math.min(48, Math.ceil(d / 110));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + dx * t;
    const y = a.y + dy * t;
    const [cx, cy] = toTile(f, { x, y });
    if (cost(f, cx, cy, navy) === 0) return false;
  }
  return true;
}

/**
 * 다익스트라. 지형 비용을 그대로 쓰므로 길로 돌아가는 편이 빠르면 돌아간다.
 *
 * 목표가 갈 수 없는 칸이면(성벽 안 등) 가장 가까이 닿을 수 있는 칸까지 간다.
 * 그래야 공성전에서 부대가 성벽 앞에 붙는다.
 */
export function findFieldPath(f: Battlefield, from: Point, to: Point, navy: boolean): Point[] {
  const W = f.w;
  const H = f.tiles.length;
  const [sx, sy] = toTile(f, from);
  const [gx, gy] = toTile(f, to);
  if (sx === gx && sy === gy) return [];

  const N = W * H;
  const dist = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const seen = new Uint8Array(N);
  const idx = (x: number, y: number) => y * W + x;

  /*
   * 이진 힙. 처음에는 "칸이 1,536개뿐이니 선형 탐색으로 충분하다"고 두었는데
   * 한 번에 240만 연산이 들어 시뮬레이션이 멎었다. 부대마다 몇 분에 한 번씩
   * 수천 번을 부르는 자리라 상수가 그대로 벽이 된다.
   */
  const heapIdx: number[] = [];
  const heapKey: number[] = [];
  const push = (i: number, k: number) => {
    heapIdx.push(i);
    heapKey.push(k);
    let c = heapIdx.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heapKey[p] <= heapKey[c]) break;
      [heapKey[p], heapKey[c]] = [heapKey[c], heapKey[p]];
      [heapIdx[p], heapIdx[c]] = [heapIdx[c], heapIdx[p]];
      c = p;
    }
  };
  const pop = (): number => {
    const top = heapIdx[0];
    const li = heapIdx.pop()!;
    const lk = heapKey.pop()!;
    if (heapIdx.length) {
      heapIdx[0] = li;
      heapKey[0] = lk;
      let p = 0;
      for (;;) {
        const l = p * 2 + 1;
        const r = l + 1;
        let m = p;
        if (l < heapKey.length && heapKey[l] < heapKey[m]) m = l;
        if (r < heapKey.length && heapKey[r] < heapKey[m]) m = r;
        if (m === p) break;
        [heapKey[p], heapKey[m]] = [heapKey[m], heapKey[p]];
        [heapIdx[p], heapIdx[m]] = [heapIdx[m], heapIdx[p]];
        p = m;
      }
    }
    return top;
  };

  const start = idx(sx, sy);
  dist[start] = 0;
  push(start, 0);
  let goal = -1;
  let goalD = Infinity;

  while (heapIdx.length) {
    const best = pop();
    if (seen[best]) continue;
    seen[best] = 1;
    const cx = best % W;
    const cy = (best / W) | 0;

    // 목표 칸에 닿았거나, 목표에 가장 가까운 칸을 기억해 둔다
    const gd = Math.hypot(cx - gx, cy - gy);
    if (gd < goalD) {
      goalD = gd;
      goal = best;
    }
    if (cx === gx && cy === gy) break;

    for (let k = 0; k < 8; k++) {
      const ox = NEIGHBORS[k * 2];
      const oy = NEIGHBORS[k * 2 + 1];
      const nx = cx + ox;
      const ny = cy + oy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const c = cost(f, nx, ny, navy);
      if (c === 0) continue;
      const diag = ox !== 0 && oy !== 0 ? 1.414 : 1;
      const nd = dist[best] + c * diag;
      const ni = idx(nx, ny);
      if (nd < dist[ni]) {
        dist[ni] = nd;
        prev[ni] = best;
        push(ni, nd);
      }
    }
  }

  if (goal < 0) return [];
  const out: Point[] = [];
  let cur = goal;
  while (cur >= 0 && cur !== start) {
    out.push(toMeters(f, cur % W, (cur / W) | 0));
    cur = prev[cur];
  }
  out.reverse();

  // 꺾이지 않는 구간은 줄인다 — 웨이포인트가 촘촘하면 부대가 갈지자로 간다
  const simple: Point[] = [];
  let anchor = from;
  for (let i = 0; i < out.length; i++) {
    const next = out[i + 1];
    if (!next || !lineOfMarch(f, anchor, next, navy)) {
      simple.push(out[i]);
      anchor = out[i];
    }
  }
  return simple;
}
