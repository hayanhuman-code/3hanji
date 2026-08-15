/**
 * build-castles.ts — 지도 원본(mapdata.json)에서 거점 정의(castles.json)를 만든다.
 *
 * 왜 생성기인가:
 *   mapdata.json 은 지리 파이프라인(pipeline/build_map.py)이 실제 경위도에서 뽑아낸
 *   "지도"다. 좌표·모양·길은 거기에 다 있지만 **게임 수치는 없다** —
 *   개발치(base/maxDev)·지형 분류·거점 특성·인접 그래프가 그것이다.
 *   그 빈칸을 여기서 규칙으로 채운다. 규칙이 코드로 남아 있어야
 *   지도를 다시 그렸을 때 같은 판이 재현된다.
 *
 * 결과는 커밋한다(런타임 생성이 아니다). 손으로 미세조정할 여지를 남기기 위해서다.
 * 다만 손으로 고친 뒤 이 스크립트를 다시 돌리면 덮어쓰므로,
 * 항구적인 조정은 아래 표에 반영하는 편이 낫다.
 *
 * 실행:  npm run build:castles
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* ------------------------------------------------------------------ *
 * 원본 스키마
 * ------------------------------------------------------------------ */

interface RawCastle {
  id: string;
  name: string;
  type: 'capital' | 'major' | 'fort' | 'port';
  f: string;
  x: number;
  y: number;
  lon: number;
  lat: number;
}

interface RawRoute {
  a: string;
  b: string;
  d: string;
}

interface MapData {
  width: number;
  height: number;
  land: string;
  islets: string;
  lakes: string;
  rivers: Record<string, string>;
  ranges: Record<string, string>;
  castles: RawCastle[];
  routes: { land: RawRoute[]; sea: RawRoute[] };
}

type DevKey = 'agri' | 'commerce' | 'wall' | 'barracks';
type Terrain = 'plain' | 'mountain' | 'river' | 'coast';

const ROOT = resolve(import.meta.dirname, '..');
const map = JSON.parse(readFileSync(resolve(ROOT, 'src/data/mapdata.json'), 'utf8')) as MapData;

/* ================================================================== *
 * 1. 권역 — 지명은 규칙으로 뽑을 수 없으므로 표로 둔다
 * ================================================================== */

const REGIONS: Record<string, string[]> = {
  요동: ['musunra', 'yosu', 'geonan', 'pyeongwon', 'ansi', 'gaemo', 'yodong', 'baekam', 'bisa'],
  북변: ['buyeo', 'sinseong', 'namso', 'jolbon', 'chaekseong'],
  압록: ['gungnae', 'ogol', 'bakjak', 'seoanpyeong'],
  평양: ['pyeong', 'salsu', 'daehaeng', 'paesu', 'daebang', 'nampyeong'],
  동북: ['okjeo', 'dongye'],
  한강: [
    'hanseong',
    'chiljung',
    'maeso',
    'cheonseong',
    'hanganggu',
    'michuhol',
    'deokmul',
    'danghang',
    'usu',
    'gugwon',
  ],
  영동: ['haseulla', 'silji', 'usanguk'],
  금강: [
    'imjon',
    'mokji',
    'samnyeon',
    'gwansan',
    'tanhyeon',
    'hwangsan',
    'ungjin',
    'sabi',
    'ungjingu',
    'gibeolpo',
    'jusan',
    'gyerim',
  ],
  호남: ['iksan', 'wansan', 'gosaburi', 'balla', 'chimmi', 'amak'],
  가야: ['seongju', 'daegaya', 'aragaya', 'goseong', 'samul', 'taksun', 'geumgwan', 'nakdonggu'],
  경상: [
    'sangju',
    'gammun',
    'uiseong',
    'daegu',
    'apdok',
    'changnyeong',
    'daeya',
    'geumseong',
    'sapryang',
    'ulsan',
  ],
  탐라: ['tamna'],
};

const regionOf = new Map<string, string>();
for (const [region, ids] of Object.entries(REGIONS)) {
  for (const id of ids) regionOf.set(id, region);
}

/* ================================================================== *
 * 2. 지형 — 지도 위 실제 거리로 판정한다
 * ================================================================== */

/**
 * SVG path 에서 좌표점만 뽑는다.
 * mapdata 의 지형선은 M/L/Z 로만 이루어져 있고 길은 C 를 쓴다.
 * 거리 판정에는 제어점이 필요 없으므로 숫자쌍을 그대로 훑는다.
 */
function pathPoints(d: string): Array<[number, number]> {
  const nums = d.match(/-?\d+(?:\.\d+)?/g) ?? [];
  const pts: Array<[number, number]> = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([+nums[i], +nums[i + 1]]);
  return pts;
}

function nearest(pts: Array<[number, number]>, x: number, y: number): number {
  let best = Infinity;
  for (const [px, py] of pts) {
    const d = (px - x) ** 2 + (py - y) ** 2;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

const rangePts = Object.values(map.ranges).flatMap(pathPoints);
const riverPts = Object.values(map.rivers).flatMap(pathPoints);
const coastPts = pathPoints(map.land);

/**
 * 판정 반경(지도 단위). 지도 높이 약 2049 가 대략 1900km 이므로 1 ≈ 0.93km.
 *
 * 해안선 반경을 좁게 잡은 이유: 한반도는 폭이 좁아 반경을 넓히면
 * 내륙 거점까지 전부 '연안'이 되어 버린다. 항구가 아닌데도 연안으로 치는 것은
 * 정말로 바다에 붙어 있는 경우로 한정한다.
 */
const R_MOUNTAIN = 30;
const R_RIVER = 14;
const R_COAST = 10;

/**
 * 거리 판정이 지리와 어긋나는 곳만 손으로 잡아 준다.
 * 산맥 폴리라인이 네 줄기뿐이라 요하 평야가 산악으로 잡히고,
 * 반대로 동해안 거점은 산맥에 먼저 걸려 연안으로 안 잡힌다.
 */
const TERRAIN_OVERRIDE: Record<string, Terrain> = {
  yodong: 'plain', // 요동성 — 요하 충적평야
  musunra: 'plain', // 무려라 — 요하 서안
  hwangsan: 'plain', // 황산벌 — 이름 그대로 벌판
  salsu: 'river', // 살수 — 청천강
  daehaeng: 'river', // 대행성 — 예성강 하구
  okjeo: 'coast', // 옥저 — 동해안
  dongye: 'coast', // 동예 — 영동
  haseulla: 'coast', // 하슬라 — 강릉
};

function deriveTerrain(c: RawCastle): Terrain {
  const forced = TERRAIN_OVERRIDE[c.id];
  if (forced) return forced;
  // 항구는 정의상 물가다.
  if (c.type === 'port') return 'coast';
  if (nearest(rangePts, c.x, c.y) < R_MOUNTAIN) return 'mountain';
  if (nearest(riverPts, c.x, c.y) < R_RIVER) return 'river';
  // 산성(fort)은 본래 산줄기를 끼고 쌓은 것이다. 산맥 폴리라인이
  // 백두대간 등 네 줄기만 그려져 있어 거리 판정에 걸리지 않아도 산악으로 본다.
  if (c.type === 'fort') return 'mountain';
  if (nearest(coastPts, c.x, c.y) < R_COAST) return 'coast';
  return 'plain';
}

/* ================================================================== *
 * 3. 개발치 — 등급별 기준값에 지형 보정을 더한다
 * ================================================================== */

const TYPE_BASE: Record<RawCastle['type'], Record<DevKey, number>> = {
  capital: { agri: 60, commerce: 62, wall: 82, barracks: 72 },
  major: { agri: 48, commerce: 45, wall: 68, barracks: 60 },
  fort: { agri: 30, commerce: 22, wall: 84, barracks: 52 },
  port: { agri: 36, commerce: 55, wall: 62, barracks: 46 },
};

const TYPE_MAX: Record<RawCastle['type'], Record<DevKey, number>> = {
  capital: { agri: 95, commerce: 95, wall: 100, barracks: 100 },
  major: { agri: 82, commerce: 80, wall: 92, barracks: 90 },
  fort: { agri: 58, commerce: 45, wall: 100, barracks: 82 },
  port: { agri: 62, commerce: 92, wall: 85, barracks: 72 },
};

/** 지형 보정 — base 와 maxDev 에 같이 더한다. */
const TERRAIN_MOD: Record<Terrain, Record<DevKey, number>> = {
  plain: { agri: 6, commerce: 2, wall: -2, barracks: 0 },
  mountain: { agri: -8, commerce: -6, wall: 8, barracks: 2 },
  river: { agri: 10, commerce: 4, wall: -4, barracks: 0 },
  coast: { agri: -4, commerce: 8, wall: -2, barracks: 0 },
};

const DEV_KEYS: DevKey[] = ['agri', 'commerce', 'wall', 'barracks'];

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/* ================================================================== *
 * 4. 거점 특성
 * ================================================================== */

/**
 * 철 산지 — 변한·가야의 철은 사서가 거듭 적은 것이고(『삼국지』 위서 동이전),
 * 충주(국원)와 울산 달천은 삼국시대 철 생산지로 알려져 있다.
 */
const IRON = new Set(['geumgwan', 'daegaya', 'aragaya', 'seongju', 'gugwon', 'ulsan', 'nakdonggu']);

/** 곡창 — 큰 강이 만든 충적평야. 세 나라의 곡물 기반이다. */
const GRANARY = new Set([
  'pyeong', // 대동강
  'hanseong', // 한강
  'sabi', // 금강
  'ungjin',
  'iksan',
  'balla', // 영산강
  'wansan',
  'geumseong', // 형산강
  'daegu',
  'sangju',
  'mokji',
]);

/**
 * 농성에 유리한 지세.
 *
 * 산성(fort)이 76 거점 중 40 개다. 전부에 방어 배율(mountainFortressBonus 1.3)을
 * 주면 AI 가 어떤 성도 함락시키지 못한다 — 16 거점 판에서 이미 겪은 문제다
 * (CHANGELOG "산성 농성" 참조). 그래서 **사서가 농성으로 기억하는 곳**으로 한정한다.
 * 15/76 ≈ 20%.
 */
const SIEGE_FORTS = new Set([
  'ansi', // 안시성 — 645년 60일 방어
  'ogol', // 오골성
  'baekam', // 백암성
  'geonan', // 건안성
  'sinseong', // 신성
  'bakjak', // 박작성
  'daehaeng', // 대행성
  'samnyeon', // 삼년산성
  'daeya', // 대야성 — 642년 함락
  'amak', // 아막성
  'chiljung', // 칠중성
  'maeso', // 매소성 — 675년
  'jusan', // 주류성 — 백제부흥군
  'imjon', // 임존성 — 백제부흥군
  'gyerim', // 계립령
]);

function deriveSpecial(c: RawCastle, _terrain: Terrain, seaDegree: number): string | null {
  if (IRON.has(c.id)) return 'iron_mine';
  if (GRANARY.has(c.id)) return 'granary';
  if (SIEGE_FORTS.has(c.id)) return 'siege_defense_bonus';
  if (c.type === 'port' && seaDegree > 0) return 'trade_hub';
  return null;
}

/* ================================================================== *
 * 5. 인접 그래프
 * ================================================================== */

const land = new Map<string, Set<string>>();
const sea = new Map<string, Set<string>>();
for (const c of map.castles) {
  land.set(c.id, new Set());
  sea.set(c.id, new Set());
}

function link(m: Map<string, Set<string>>, a: string, b: string, kind: string): void {
  if (!m.has(a) || !m.has(b)) throw new Error(`${kind} 경로가 없는 거점을 가리킵니다: ${a}-${b}`);
  m.get(a)!.add(b);
  m.get(b)!.add(a);
}

for (const r of map.routes.land) link(land, r.a, r.b, '육로');
for (const r of map.routes.sea) link(sea, r.a, r.b, '수로');

/* ================================================================== *
 * 6. 출력
 * ================================================================== */

/**
 * 가야는 지도에 도성 등급 거점이 없다. 연맹체라 원래 그렇지만,
 * 가야를 플레이할 수 있게 하려면 중심이 필요하다.
 * 금관가야의 금관성을 도성으로 올린다 — 철과 바다를 함께 쥔 자리다.
 */
const TYPE_OVERRIDE: Record<string, RawCastle['type']> = { geumgwan: 'capital' };

const out = map.castles.map((raw) => {
  const c = { ...raw, type: TYPE_OVERRIDE[raw.id] ?? raw.type };
  const terrain = deriveTerrain(c);
  const landNb = [...land.get(c.id)!].sort();
  const seaNb = [...sea.get(c.id)!].sort();

  const base = {} as Record<DevKey, number>;
  const maxDev = {} as Record<DevKey, number>;
  for (const k of DEV_KEYS) {
    const mod = TERRAIN_MOD[terrain][k];
    maxDev[k] = clamp(TYPE_MAX[c.type][k] + mod, 20, 100);
    base[k] = clamp(Math.min(TYPE_BASE[c.type][k] + mod, maxDev[k] - 5), 5, 100);
  }

  const region = regionOf.get(c.id);
  if (!region) throw new Error(`권역이 지정되지 않은 거점: ${c.id} (${c.name})`);

  return {
    id: c.id,
    name: c.name,
    type: c.type,
    region,
    position: { x: c.x, y: c.y },
    /** 육로 + 수로 합집합. 전략 이동 그래프의 간선이다. */
    neighbors: [...new Set([...landNb, ...seaNb])].sort(),
    /** 통행 판정용 구분 — 육군은 sea 전용 간선을 지날 수 없다 */
    routes: { land: landNb, sea: seaNb },
    terrain,
    base,
    maxDev,
    special: deriveSpecial(c, terrain, seaNb.length),
  };
});

writeFileSync(resolve(ROOT, 'src/data/castles.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');

/* --------------------------------- 요약 --------------------------------- */

const byTerrain = new Map<string, number>();
const bySpecial = new Map<string, number>();
for (const c of out) {
  byTerrain.set(c.terrain, (byTerrain.get(c.terrain) ?? 0) + 1);
  const s = c.special ?? '(없음)';
  bySpecial.set(s, (bySpecial.get(s) ?? 0) + 1);
}
const isolated = out.filter((c) => c.neighbors.length === 0).map((c) => c.id);

console.log(`거점 ${out.length}개 생성 → src/data/castles.json`);
console.log(`  지형: ${[...byTerrain].map(([k, v]) => `${k} ${v}`).join(' / ')}`);
console.log(`  특성: ${[...bySpecial].map(([k, v]) => `${k} ${v}`).join(' / ')}`);
console.log(`  육로 ${map.routes.land.length}개 · 수로 ${map.routes.sea.length}개`);
if (isolated.length) console.error(`  ! 고립된 거점: ${isolated.join(', ')}`);
