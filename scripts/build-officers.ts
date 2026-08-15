/**
 * build-officers.ts — 인물 명부(officers.json)를 만든다.
 *
 * 두 개의 원본을 합친다.
 *
 *  1. `source/officers-300.json` — 300명 로스터. 등급·역할·출전·특기가 붙어 있고
 *     **압축 캠페인용 나이(age/lifespan)** 를 가진다. 700년을 50년으로 접어
 *     광개토대왕과 김유신이 같은 판에 서게 하려고 만든 데이터다 (docs/officers.md).
 *  2. `source/officers-legacy.json` — 642·551년 시나리오를 위해 손으로 만든 46명.
 *     여기에는 **역사 모드용 활동 연도**가 들어 있다.
 *
 * 왜 합치는가: 300명 로스터의 `histAppear`/`histRetire` 만으로 642년을 걸러 내면
 * 살아 있는 인물이 전체 17명뿐이다(고구려 3명). 700년에 235명을 흩뿌린 결과다.
 * 반대로 46명만으로는 76 거점을 채울 수 없다. 그래서 사람은 하나로 합치되
 * **명부 창(window)을 두 벌** 갖게 한다.
 *
 *   - 역사 시나리오(642·551) → appear/retire
 *   - 압축 시나리오(원년)     → age/lifespan
 *
 * 실행:  npm run build:officers
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const read = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'));

/* ------------------------------------------------------------------ *
 * 원본 스키마
 * ------------------------------------------------------------------ */

interface Stats {
  lead: number;
  war: number;
  int: number;
  pol: number;
  chr: number;
}

interface Source300 {
  id: string;
  name: string;
  faction: string;
  tier: 1 | 2 | 3;
  histAppear: number | null;
  histRetire: number | null;
  role: 'general' | 'civil' | 'royal' | 'monk' | 'artisan';
  stats: Stats;
  skills: string[];
  loyalty: 'loyal' | 'ambitious' | 'mercenary';
  source: string;
  note: string;
  age: number;
  lifespan: number;
  ruler: boolean;
}

interface Legacy {
  id: string;
  name: string;
  faction: string | null;
  birth: number;
  death: number;
  stats: Stats;
  skills: string[];
  loyalty_type: 'loyal' | 'ambitious' | 'mercenary';
  home?: string | null;
  note?: string;
}

const roster: Source300[] = read('src/data/source/officers-300.json');
const legacy: Legacy[] = read('src/data/source/officers-legacy.json');
const castles: Array<{ id: string; type: string }> = read('src/data/castles.json');
const mapCastles: Array<{ id: string; f: string }> = read('src/data/mapdata.json').castles;

/* ================================================================== *
 * 1. 같은 사람인데 id 가 다른 것 — 46명 쪽을 300명 쪽 id 로 맞춘다
 * ================================================================== */

const ALIAS: Record<string, string> = {
  eulji_mundeok: 'eulji',
  yeon_gaesomun: 'yeongaesomun',
  yang_manchun: 'yangmanchun',
  go_geonmu: 'gongeonmu',
  on_sanmun: 'onsamun',
  on_dal: 'ondal',
  buyeo_yung: 'buyeoyung',
  kim_muryeok: 'kimmuryeok',
  kim_yusin: 'kimyusin',
  kim_chunchu: 'kimchunchu',
  kim_pumseok: 'pumseok',
  bidam: 'bipam',
  kim_inmun: 'kiminmun',
  kim_beommin: 'munmu', // 김법민 = 문무왕
  kim_gugyeong: 'gyeongdeung', // 김구형 = 김구해(구형왕)
};

/**
 * 300명 로스터에 아예 없는 사람. 46명 쪽 기록을 그대로 살린다.
 * 전부 역사 시나리오 전용이므로 압축 모드용 나이는 주지 않는다.
 */
const LEGACY_ONLY_META: Record<string, { tier: 1 | 2 | 3; role: Source300['role']; source: string }> =
  {
    go_yeonsu: { tier: 2, role: 'general', source: '삼국사기' },
    go_hyejin: { tier: 2, role: 'general', source: '삼국사기' },
    seondohae: { tier: 2, role: 'civil', source: '삼국사기' },
    go_heul: { tier: 2, role: 'general', source: '삼국사기' },
    yangwon: { tier: 2, role: 'royal', source: '삼국사기' },
    pyeongwon_wang: { tier: 2, role: 'royal', source: '삼국사기' },
    chugun: { tier: 2, role: 'general', source: '삼국사기' },
    godeokgwan: { tier: 2, role: 'general', source: '삼국사기' },
    buyeo_chang: { tier: 2, role: 'royal', source: '삼국사기' },
    wang_hyorin: { tier: 2, role: 'civil', source: '삼국사기' },
  };

/** 16 거점 판에서 쓰던 거점 id → 76 거점 지도의 id */
const CASTLE_ALIAS: Record<string, string> = {
  pyeongyang: 'pyeong',
  siljik: 'silji',
  gwanmi: 'bisa', // 관미성은 새 지도에 없다. 서해 관문 자리를 비사성이 맡는다.
};

/* ================================================================== *
 * 2. 특기 어휘 통합
 * ================================================================== */

/**
 * 300명 로스터는 70종의 특기를 쓴다. 게임이 실제로 계산에 쓰는 것은 20종이다.
 *
 * 뜻이 같은 것은 **기존 id 쪽으로 모은다**. 반대 방향으로 바꾸면
 * `hasSkill(def, 'cav')` 같은 문자열 호출이 코드 20여 곳에 흩어져 있어
 * 전부 따라 고쳐야 한다 — 데이터를 고치는 편이 싸고 안전하다.
 */
const SKILL_ALIAS: Record<string, string> = {
  cavalry: 'cav',
  navy: 'naval',
  navy_defense: 'naval',
  sea_route: 'naval',
  naval_trade: 'trade',
  siege: 'siegecraft',
  assault: 'siegecraft',
  siege_defense: 'fortify',
  defense: 'fortify',
  architecture: 'fortify',
  last_stand: 'resolve',
  suicide_attack: 'resolve',
  martyr: 'resolve',
  eloquence: 'oratory',
  diplomacy: 'oratory',
  remonstrance: 'oratory',
  insight: 'foresight',
  strategy: 'scheme',
  stratagem: 'scheme',
  spy: 'scheme',
  autocracy: 'autocrat',
  tyranny: 'autocrat',
  temple: 'buddhism',
  ritual: 'buddhism',
  music: 'culture',
  painting: 'culture',
  writing: 'culture',
  history: 'culture',
  philosophy: 'culture',
  education: 'culture',
  literature: 'culture',
  craft: 'trade',
  finance: 'trade',
  iron: 'trade',
  sesok_ogye: 'hwarang',
};

/**
 * 뜻이 겹치지 않아 새로 등록하는 특기.
 * 여기 있는 것 중 계산에 반영된 것은 formulas.ts 의 SKILLS 주석에 표시했다.
 * 나머지는 인물 카드에만 나오는 플레이버다 — 효과는 단계적으로 붙인다.
 */
const NEW_SKILLS = [
  'valor',
  'spear',
  'governance',
  'conquest',
  'ambush',
  'rearguard',
  'raid',
  'law',
  'reform',
  'relief',
  'census',
  'insurgency',
  'rebellion',
  'founding',
  'duel',
  'defect',
  'figurehead',
  'loyalty',
  'popularize',
  'politics',
  'recovery',
  'redemption',
  'rescue',
  'medicine',
  'unify',
];

function normalizeSkills(skills: string[]): string[] {
  const out: string[] = [];
  for (const s of skills) {
    const mapped = SKILL_ALIAS[s] ?? s;
    if (!out.includes(mapped)) out.push(mapped);
  }
  return out;
}

/* ================================================================== *
 * 3. 재야 인물
 * ================================================================== */

/**
 * 300명 로스터는 전원이 어느 세력엔가 속해 있어 재야가 한 명도 없다.
 * 그러면 「탐색」 명령이 할 일이 없어진다.
 *
 * 승려·장인 가운데 3급인 사람을 재야로 돌린다 — 조정의 신하가 아니라
 * 절이나 저잣거리에 있던 사람들이라는 뜻이고, 등용의 대상이 되기에 알맞다.
 * 46명 쪽에서 이미 재야로 잡아 둔 사람은 그대로 둔다.
 */
function isFreeAgent(o: Source300): boolean {
  return (o.role === 'monk' || o.role === 'artisan') && o.tier === 3;
}

/** 재야가 숨어 있을 거점 — 원 소속 세력의 영역 안에서 결정론적으로 고른다. */
const castleIds = new Set(castles.map((c) => c.id));
const byFaction = new Map<string, string[]>();
for (const c of mapCastles) {
  if (!castleIds.has(c.id)) continue;
  if (!byFaction.has(c.f)) byFaction.set(c.f, []);
  byFaction.get(c.f)!.push(c.id);
}
for (const list of byFaction.values()) list.sort();

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function homeFor(o: Source300): string | null {
  const list = byFaction.get(o.faction);
  if (!list || list.length === 0) return null;
  return list[hash(o.id) % list.length];
}

/* ================================================================== *
 * 4. 합치기
 * ================================================================== */

interface OutOfficer {
  id: string;
  name: string;
  faction: string | null;
  tier: 1 | 2 | 3;
  role: Source300['role'];
  ruler: boolean;
  /** 역사 모드 — 실제 활동 연도. null 이면 역사 시나리오에 등장하지 않는다. */
  appear: number | null;
  retire: number | null;
  /** 압축 모드 — 원년 시점 나이와 사망 나이. null 이면 압축 시나리오에 없다. */
  age: number | null;
  lifespan: number | null;
  stats: Stats;
  skills: string[];
  loyalty_type: Legacy['loyalty_type'];
  home: string | null;
  source: string;
  note: string;
}

const legacyById = new Map<string, Legacy>();
for (const l of legacy) legacyById.set(ALIAS[l.id] ?? l.id, l);

const out: OutOfficer[] = [];
const warnings: string[] = [];

for (const o of roster) {
  const l = legacyById.get(o.id);
  const free = isFreeAgent(o);

  // 역사 창: 46명 쪽에 손으로 잡아 둔 값이 있으면 그쪽을 쓴다.
  // 그 값들은 642·551년 시나리오가 성립하도록 고른 것이라 로스터의
  // 좁은 경력 연도(예: 김유신 629~673)보다 시나리오에 맞다.
  const appear = l ? l.birth + 15 : o.histAppear;
  const retire = l ? l.death : o.histRetire;

  out.push({
    id: o.id,
    name: o.name,
    faction: free ? null : o.faction,
    tier: o.tier,
    role: o.role,
    ruler: o.ruler,
    appear: appear ?? null,
    retire: retire ?? null,
    age: o.age,
    lifespan: o.lifespan,
    stats: o.stats,
    skills: normalizeSkills(o.skills),
    // 성향은 46명 쪽이 게임 안에서 검증된 값이므로 있으면 우선한다.
    loyalty_type: l?.loyalty_type ?? o.loyalty,
    home: free ? homeFor(o) : l?.home ? (CASTLE_ALIAS[l.home] ?? l.home) : null,
    source: o.source,
    note: o.note,
  });

  if (appear !== null && retire !== null && appear >= retire) {
    // 한 해만 기록에 남은 사람(관창·이차돈 등). 최소 한 해는 활동하게 둔다.
    out[out.length - 1].retire = appear + 1;
  }
}

for (const l of legacy) {
  if (legacyById.get(ALIAS[l.id] ?? l.id) === l && roster.some((o) => o.id === (ALIAS[l.id] ?? l.id)))
    continue;
  const meta = LEGACY_ONLY_META[l.id];
  if (!meta) {
    warnings.push(`46명 쪽 인물이 300명 로스터에도 LEGACY_ONLY_META 에도 없습니다: ${l.id}`);
    continue;
  }
  out.push({
    id: l.id,
    name: l.name,
    faction: l.faction,
    tier: meta.tier,
    role: meta.role,
    ruler: false,
    appear: l.birth + 15,
    retire: l.death,
    age: null,
    lifespan: null,
    stats: l.stats,
    skills: normalizeSkills(l.skills),
    loyalty_type: l.loyalty_type,
    home: l.home ? (CASTLE_ALIAS[l.home] ?? l.home) : null,
    source: meta.source,
    note: l.note ?? '',
  });
}

out.sort((a, b) => (a.tier - b.tier) || a.id.localeCompare(b.id));

writeFileSync(resolve(ROOT, 'src/data/officers.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');

/* --------------------------------- 요약 --------------------------------- */

const usedSkills = new Set(out.flatMap((o) => o.skills));
const alive = (y: number) =>
  out.filter((o) => o.appear !== null && o.appear <= y && (o.retire ?? 0) >= y).length;
const compressed = out.filter((o) => o.age !== null && o.age >= 16).length;
const nextGen = out.filter((o) => o.age !== null && o.age < 16).length;

console.log(`인물 ${out.length}명 생성 → src/data/officers.json`);
console.log(`  등급: 1급 ${out.filter((o) => o.tier === 1).length} / 2급 ${out.filter((o) => o.tier === 2).length} / 3급 ${out.filter((o) => o.tier === 3).length}`);
console.log(`  재야 ${out.filter((o) => !o.faction).length}명 · 군주 ${out.filter((o) => o.ruler).length}명`);
console.log(`  역사 모드 생존: 551년 ${alive(551)} · 612년 ${alive(612)} · 642년 ${alive(642)} · 660년 ${alive(660)}`);
console.log(`  압축 모드 원년: 성인 ${compressed} · 차세대 ${nextGen}`);
console.log(`  특기 ${usedSkills.size}종`);
for (const w of warnings) console.warn(`  ! ${w}`);

// 새 특기 목록이 formulas.ts 와 어긋나면 검증기가 잡는다. 여기서는 안내만 한다.
const unregistered = [...usedSkills].filter((s) => !NEW_SKILLS.includes(s));
console.log(`  (기존 특기 ${unregistered.length}종 + 신규 ${usedSkills.size - unregistered.length}종)`);
