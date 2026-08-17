/**
 * build-battlemaps.ts — 전장 76곳에 **다리를 놓는다**.
 *
 * 왜 필요한가: 상류 파이프라인(pipeline/build_battlemaps.py)이 만든 전장은
 * 실제 해안선과 하천을 그대로 잘라 온 것이라, 강이 판을 두 쪽으로 가르는 곳이
 * 있다. 76곳 중 **8곳**이 육군 기준으로 갈라져 있었다 —
 * 한성·웅진·사비·발라·울산·계립령·웅진구·패수. 전부 강·해안 거점이다.
 *
 * 그대로 두면 무슨 일이 나는가: 실제로 돌려 보니 한성에서 양군이 한강을
 * 사이에 두고 **아홉 시간을 마주 본 채 지쳐 쓰러졌다.** 여울이 다섯 칸뿐인
 * 데다 한복판을 성벽이 막고 있어, 길은 있어도 10km 를 돌아야 했다.
 *
 * 그래서 갈라진 곳마다 가장 좁은 물목에 다리를 놓는다. 손으로 찍지 않고
 * 생성기로 만드는 이유는 늘 같다 — 판이 재현 가능해야 하고, 상류에서 지도가
 * 바뀌면 다시 돌리면 되어야 한다.
 *
 * 다리는 **좁다.** 그것이 요점이다. 대군이 한 줄로 몰릴 수밖에 없으므로
 * 다리를 먼저 점하는 것 자체가 전술이 된다 (기획서 §4.7-1 「행군」 국면).
 *
 * 실행:  npm run build:battlemaps
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

interface RawMap {
  id: string;
  name: string;
  w: number;
  h: number;
  tiles: string[];
  [k: string]: unknown;
}
interface File {
  legend: Record<string, string>;
  maps: Record<string, RawMap>;
}

const file: File = JSON.parse(
  readFileSync(resolve(ROOT, 'src/data/source/battlemaps-raw.json'), 'utf8')
);

/** 육군이 못 지나는 칸 */
const BLOCK = new Set(['~', 's', 'X', 'W']);
/** 다리를 놓을 수 있는 칸 — 물만. 성벽과 절벽에는 못 놓는다 */
const BRIDGEABLE = new Set(['~', 's']);
/** 이 크기 이상인 덩어리만 「진짜 땅」으로 본다. 자잘한 섬까지 이을 이유는 없다 */
const MIN_COMPONENT = 40;
/** 물목이 이보다 넓으면 다리를 놓지 않는다 (바다를 가로지를 수는 없다) */
const MAX_SPAN = 10;

type Grid = string[][];

const toGrid = (m: RawMap): Grid => m.tiles.map((r) => r.split(''));
const toTiles = (g: Grid): string[] => g.map((r) => r.join(''));

/** 육군 기준 연결 덩어리에 번호를 매긴다 */
function components(g: Grid): { id: Int32Array; sizes: number[]; W: number; H: number } {
  const H = g.length;
  const W = Math.max(...g.map((r) => r.length));
  const id = new Int32Array(W * H).fill(-1);
  const sizes: number[] = [];
  const at = (x: number, y: number) => (y < H && x < g[y].length ? g[y][x] : 's');

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (BLOCK.has(at(x, y)) || id[y * W + x] >= 0) continue;
      const c = sizes.length;
      let n = 0;
      const stack = [[x, y]];
      id[y * W + x] = c;
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        n++;
        for (const [ox, oy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = cx + ox;
          const ny = cy + oy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          if (BLOCK.has(at(nx, ny)) || id[ny * W + nx] >= 0) continue;
          id[ny * W + nx] = c;
          stack.push([nx, ny]);
        }
      }
      sizes.push(n);
    }
  }
  return { id, sizes, W, H };
}

/**
 * 가장 좁은 물목을 찾아 다리를 놓는다.
 * 직선으로 물을 건너 반대편 땅에 닿는 구간 가운데 제일 짧은 것을 고른다.
 */
function addBridge(g: Grid, exclude: Set<string>): { span: number; cells: string[] } | null {
  const { id, sizes, W, H } = components(g);
  const big = sizes.map((n, i) => [i, n] as const).filter(([, n]) => n >= MIN_COMPONENT);
  if (big.length <= 1) return null;

  const at = (x: number, y: number) => (y < H && x < g[y].length ? g[y][x] : 's');
  let best: { span: number; cells: string[] } | null = null;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const from = id[y * W + x];
      if (from < 0 || sizes[from] < MIN_COMPONENT) continue;
      for (const [ox, oy] of [
        [1, 0],
        [0, 1],
        [1, 1],
        [1, -1],
      ]) {
        const cells: string[] = [];
        for (let s = 1; s <= MAX_SPAN + 1; s++) {
          const nx = x + ox * s;
          const ny = y + oy * s;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) break;
          const ch = at(nx, ny);
          if (BRIDGEABLE.has(ch)) {
            cells.push(`${nx},${ny}`);
            continue;
          }
          // 물을 다 건넜다 — 반대편이 다른 덩어리인가?
          const to = id[ny * W + nx];
          if (to >= 0 && to !== from && sizes[to] >= MIN_COMPONENT && cells.length > 0) {
            const key = cells.join('|');
            if (!exclude.has(key) && (!best || cells.length < best.span)) {
              best = { span: cells.length, cells };
            }
          }
          break;
        }
      }
    }
  }
  if (!best) return null;
  for (const c of best.cells) {
    const [cx, cy] = c.split(',').map(Number);
    g[cy][cx] = 'B';
  }
  return best;
}

/* ------------------------------------------------------------------ */

file.legend['B'] = 'bridge';

let bridged = 0;
const report: string[] = [];
for (const m of Object.values(file.maps)) {
  const g = toGrid(m);
  const exclude = new Set<string>();
  const spans: number[] = [];

  // ① 갈라진 곳을 잇는다
  for (let guard = 0; guard < 6; guard++) {
    const r = addBridge(g, exclude);
    if (!r) break;
    exclude.add(r.cells.join('|'));
    spans.push(r.span);
  }

  /*
   * ② 이어진 뒤에도 물목이 하나뿐이면 다리 하나를 더 놓는다.
   *    건널 곳이 하나면 「어느 다리를 먼저 점할 것인가」라는 판단이 없다.
   *    두 곳이 되어야 §4.7-1 의 행군 국면이 선택이 된다.
   */
  if (spans.length === 1) {
    const before = toTiles(g).join('');
    // 방금 놓은 다리를 잠시 물로 되돌리고 다른 물목을 찾는다
    const g2 = toGrid({ ...m, tiles: toTiles(g) } as RawMap);
    for (const c of exclude) {
      for (const cell of c.split('|')) {
        const [cx, cy] = cell.split(',').map(Number);
        g2[cy][cx] = '~';
      }
    }
    const alt = addBridge(g2, exclude);
    if (alt) {
      for (const c of alt.cells) {
        const [cx, cy] = c.split(',').map(Number);
        g[cy][cx] = 'B';
      }
      spans.push(alt.span);
    }
    void before;
  }

  if (spans.length) {
    m.tiles = toTiles(g);
    bridged++;
    report.push(`  ${m.id.padEnd(12)} ${m.name.padEnd(10)} 다리 ${spans.length}개 (폭 ${spans.join('·')}칸)`);
  }
}

writeFileSync(
  resolve(ROOT, 'src/data/battlemaps.json'),
  JSON.stringify(file, null, 0) + '\n',
  'utf8'
);

console.log(`전장 ${Object.keys(file.maps).length}곳 → src/data/battlemaps.json`);
console.log(`다리를 놓은 전장 ${bridged}곳`);
for (const r of report) console.log(r);

/* --------------------------- 검증 ---------------------------
 *
 * 남은 덩어리가 전부 「끊긴 땅」인 것은 아니다. 성벽과 절벽으로 둘러싸인
 * 곳은 **산성 안쪽**이고, 거기는 원래 성문으로만 들어간다 — 절벽에 다리를
 * 놓아 뚫어 줄 자리가 아니다. 둘을 갈라서 본다.
 */
const walled: string[] = [];
let split = 0;
for (const m of Object.values(file.maps)) {
  const g = toGrid(m);
  const { id, sizes, W, H } = components(g);
  const bigs = sizes.map((n, i) => [i, n] as const).filter(([, n]) => n >= MIN_COMPONENT);
  if (bigs.length <= 1) continue;

  // 가장 큰 덩어리가 본토. 나머지가 무엇에 둘러싸여 있는지 본다
  const main = bigs.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  for (const [c, n] of bigs) {
    if (c === main) continue;
    let wall = 0;
    let total = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (id[y * W + x] !== c) continue;
        for (const [ox, oy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          if (id[ny * W + nx] === c) continue;
          const ch = ny < H && nx < g[ny].length ? g[ny][nx] : 's';
          total++;
          if (ch === 'W' || ch === 'X') wall++;
        }
      }
    }
    if (total > 0 && wall / total > 0.8) {
      walled.push(`${m.id}(${m.name}) ${n}칸`);
    } else {
      split++;
      console.warn(`  ! ${m.id} (${m.name}) 의 ${n}칸이 아직 끊겨 있습니다`);
    }
  }
}
if (walled.length) {
  console.log(`성벽·절벽으로 둘러싸인 안쪽 ${walled.length}곳 — 성문으로만 들어간다`);
  for (const w of walled) console.log(`    ${w}`);
}
console.log(split === 0 ? '갈 수 있는 땅은 모두 이어졌다.' : `아직 끊긴 곳 ${split}곳`);
