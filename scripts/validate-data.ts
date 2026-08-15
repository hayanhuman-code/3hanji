/**
 * validate-data.ts — JSON 데이터 검증기
 *
 * 관리 원칙(시스템 상세계획 §8): "JSON 오타가 최대 버그 원인이 될 것이므로,
 * 스키마 검증 스크립트를 Phase 0 에서 먼저 만든다."
 *
 * 실행:  npm run validate
 * 오류가 하나라도 있으면 종료 코드 1 로 끝난다(CI 에 걸 수 있다).
 */

import {
  CASTLES,
  EVENTS,
  FACTIONS,
  INSTITUTIONS,
  MAP,
  OFFICERS,
  SCENARIOS,
  UNIT_TYPES,
  officerWindow,
  officersAliveIn,
  routePath,
} from '../src/core/data';
import { KNOWN_EFFECTS, parseEffect } from '../src/core/effects';
import { SKILLS } from '../src/core/formulas';
import { validateCondition } from '../src/core/dsl';
import type { UnitClass } from '../src/core/types';

const errors: string[] = [];
const warnings: string[] = [];

function err(where: string, msg: string): void {
  errors.push(`✗ [${where}] ${msg}`);
}
function warn(where: string, msg: string): void {
  warnings.push(`! [${where}] ${msg}`);
}

const castleIds = new Set(CASTLES.map((c) => c.id));
const factionIds = new Set(FACTIONS.map((f) => f.id));
const officerIds = new Set(OFFICERS.map((o) => o.id));
const institutionIds = new Set(INSTITUTIONS.map((i) => i.id));
const eventIds = new Set(EVENTS.map((e) => e.id));
const UNIT_CLASSES: UnitClass[] = ['infantry', 'spear', 'cavalry', 'archer', 'siege', 'navy'];

function checkDuplicates(name: string, ids: string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) err(name, `중복 id: ${id}`);
    seen.add(id);
  }
}

/* ---------------------------------- 거점 ---------------------------------- */

checkDuplicates('castles', CASTLES.map((c) => c.id));
for (const c of CASTLES) {
  const w = `castles/${c.id}`;
  if (!c.name) err(w, 'name 이 비어 있습니다');
  if (!['capital', 'major', 'fort', 'port'].includes(c.type))
    err(w, `알 수 없는 type: ${c.type}`);
  if (!['plain', 'mountain', 'river', 'coast'].includes(c.terrain))
    err(w, `알 수 없는 terrain: ${c.terrain}`);
  if (c.position.x < 0 || c.position.x > MAP.width || c.position.y < 0 || c.position.y > MAP.height)
    err(w, `position 이 지도 밖입니다 (${c.position.x}, ${c.position.y})`);

  // 육로/수로 구분은 통행 판정의 근거다. 합집합이 neighbors 와 어긋나면 안 된다.
  const union = new Set([...c.routes.land, ...c.routes.sea]);
  if (union.size !== c.neighbors.length || c.neighbors.some((n) => !union.has(n)))
    err(w, 'neighbors 가 routes.land ∪ routes.sea 와 다릅니다 (build-castles.ts 를 다시 돌리세요)');
  for (const nb of c.routes.land) {
    const other = CASTLES.find((x) => x.id === nb);
    if (other && !other.routes.land.includes(c.id)) err(w, `육로가 비대칭입니다: ${nb}`);
  }
  for (const nb of c.routes.sea) {
    const other = CASTLES.find((x) => x.id === nb);
    if (other && !other.routes.sea.includes(c.id)) err(w, `수로가 비대칭입니다: ${nb}`);
    if (!routePath(c.id, nb)) err(w, `수로에 지도 경로가 없습니다: ${nb}`);
  }

  for (const nb of c.neighbors) {
    if (!castleIds.has(nb)) {
      err(w, `없는 인접 거점: ${nb}`);
      continue;
    }
    const other = CASTLES.find((x) => x.id === nb)!;
    if (!other.neighbors.includes(c.id)) err(w, `인접 관계가 비대칭입니다: ${nb} 쪽에 ${c.id} 없음`);
  }
  if (c.neighbors.length === 0) err(w, '고립된 거점입니다 (neighbors 비어 있음)');

  for (const key of ['agri', 'commerce', 'wall', 'barracks'] as const) {
    if (c.base[key] === undefined) err(w, `base.${key} 누락`);
    if (c.maxDev[key] === undefined) err(w, `maxDev.${key} 누락`);
    if (c.base[key] > c.maxDev[key]) err(w, `base.${key}(${c.base[key]}) 가 maxDev(${c.maxDev[key]}) 보다 큽니다`);
    if (c.maxDev[key] > 100) warn(w, `maxDev.${key} 가 100 을 넘습니다 (${c.maxDev[key]})`);
  }
  if (c.special && !['siege_defense_bonus', 'iron_mine', 'trade_hub', 'granary'].includes(c.special))
    warn(w, `알 수 없는 special: ${c.special} (formulas.ts 가 무시합니다)`);
}

// 그래프 연결성
{
  const seen = new Set<string>([CASTLES[0]?.id]);
  const queue = [CASTLES[0]?.id];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const nb of CASTLES.find((c) => c.id === cur)?.neighbors ?? []) {
      if (!seen.has(nb)) {
        seen.add(nb);
        queue.push(nb);
      }
    }
  }
  const unreachable = CASTLES.filter((c) => !seen.has(c.id)).map((c) => c.id);
  if (unreachable.length > 0) err('castles', `그래프가 끊겨 있습니다: ${unreachable.join(', ')}`);
}

/* ---------------------------------- 세력 ---------------------------------- */

checkDuplicates('factions', FACTIONS.map((f) => f.id));
for (const f of FACTIONS) {
  const w = `factions/${f.id}`;
  if (!/^#[0-9a-fA-F]{6}$/.test(f.color)) err(w, `color 형식 오류: ${f.color}`);
  for (const key of ['aggression', 'expansion', 'diplomacy'] as const) {
    const v = f.personality?.[key];
    if (typeof v !== 'number' || v < 0 || v > 1) err(w, `personality.${key} 는 0~1 이어야 합니다 (${v})`);
  }
  if (f.council.support < 0 || f.council.support > 100) err(w, 'council.support 범위 오류');
}

/* ---------------------------------- 인물 ---------------------------------- */

checkDuplicates('officers', OFFICERS.map((o) => o.id));
for (const o of OFFICERS) {
  const w = `officers/${o.id}`;
  if (!o.name) err(w, 'name 이 비어 있습니다');
  if (o.faction && !factionIds.has(o.faction)) err(w, `없는 세력: ${o.faction}`);
  if (o.appear !== null && o.retire !== null && o.appear >= o.retire)
    err(w, `appear(${o.appear}) 가 retire(${o.retire}) 이상입니다`);
  if ((o.appear === null) !== (o.retire === null)) err(w, 'appear 와 retire 는 함께 있거나 함께 없어야 합니다');
  if ((o.age === null) !== (o.lifespan === null)) err(w, 'age 와 lifespan 은 함께 있거나 함께 없어야 합니다');
  if (o.appear === null && o.age === null) err(w, '역사 창도 압축 창도 없어 어떤 시나리오에도 등장하지 않습니다');
  if (o.age !== null && o.lifespan !== null && o.age >= o.lifespan)
    err(w, `age(${o.age}) 가 lifespan(${o.lifespan}) 이상입니다`);
  if (![1, 2, 3].includes(o.tier)) err(w, `알 수 없는 tier: ${o.tier}`);
  if (!['general', 'civil', 'royal', 'monk', 'artisan'].includes(o.role))
    err(w, `알 수 없는 role: ${o.role}`);
  // 등급 상한 — 손으로 공들여 지정한 1급이 항상 정점에 서야 한다 (docs/officers.md).
  const cap = o.tier === 1 ? 100 : o.tier === 2 ? 88 : 80;
  for (const [key, v] of Object.entries(o.stats)) {
    if (typeof v === 'number' && v > cap) warn(w, `${o.tier}급 상한 ${cap} 초과: stats.${key}=${v}`);
  }
  for (const [key, v] of Object.entries(o.stats)) {
    if (typeof v !== 'number' || v < 1 || v > 100) err(w, `stats.${key} 는 1~100 이어야 합니다 (${v})`);
  }
  for (const s of o.skills) {
    if (!SKILLS[s]) err(w, `알 수 없는 특기: ${s}`);
  }
  if (!['loyal', 'ambitious', 'mercenary'].includes(o.loyalty_type))
    err(w, `알 수 없는 loyalty_type: ${o.loyalty_type}`);
  if (o.home && !castleIds.has(o.home)) err(w, `없는 home 거점: ${o.home}`);
  if (!o.faction && !o.home) warn(w, '재야인데 home 이 없어 탐색으로 찾을 수 없습니다');
}

/* ---------------------------------- 병종 ---------------------------------- */

checkDuplicates('unitTypes', UNIT_TYPES.map((u) => u.id));
for (const u of UNIT_TYPES) {
  const w = `unitTypes/${u.id}`;
  if (u.faction && !factionIds.has(u.faction)) err(w, `없는 세력: ${u.faction}`);
  if (!UNIT_CLASSES.includes(u.class)) err(w, `알 수 없는 class: ${u.class}`);
  if (u.range < 1) err(w, 'range 는 1 이상이어야 합니다');
  if (u.move < 1) err(w, 'move 는 1 이상이어야 합니다');
  for (const cls of Object.keys(u.counters)) {
    if (!UNIT_CLASSES.includes(cls as UnitClass)) err(w, `counters 에 알 수 없는 계열: ${cls}`);
  }
  for (const t of Object.keys(u.terrain)) {
    if (!['plain', 'forest', 'hill', 'mountain', 'river', 'mudflat', 'wall', 'gate', 'keep'].includes(t))
      err(w, `terrain 에 알 수 없는 지형: ${t}`);
  }
  if (u.requires && !institutionIds.has(u.requires)) err(w, `없는 요구 제도: ${u.requires}`);
}

/* ---------------------------------- 제도 ---------------------------------- */

checkDuplicates('institutions', INSTITUTIONS.map((i) => i.id));
for (const i of INSTITUTIONS) {
  const w = `institutions/${i.id}`;
  if (i.faction && !factionIds.has(i.faction)) err(w, `없는 세력: ${i.faction}`);
  if (i.requires) {
    const msg = validateCondition(i.requires);
    if (msg) err(w, msg);
  }
  checkEffects(w, i.effects);
}

/* --------------------------------- 이벤트 --------------------------------- */

checkDuplicates('events', EVENTS.map((e) => e.id));
for (const e of EVENTS) {
  const w = `events/${e.id}`;
  if (!e.text) err(w, 'text 가 비어 있습니다');
  if (e.faction && !factionIds.has(e.faction)) err(w, `없는 세력: ${e.faction}`);
  if (e.trigger.condition) {
    const msg = validateCondition(e.trigger.condition);
    if (msg) err(w, msg);
    else checkConditionIds(w, e.trigger.condition);
  }
  if (e.trigger.chance !== undefined && (e.trigger.chance <= 0 || e.trigger.chance > 1))
    err(w, `chance 는 0<x<=1 이어야 합니다 (${e.trigger.chance})`);
  if (
    e.trigger.yearFrom !== undefined &&
    e.trigger.yearTo !== undefined &&
    e.trigger.yearFrom > e.trigger.yearTo
  )
    err(w, 'yearFrom 이 yearTo 보다 큽니다');
  if (!e.choices || e.choices.length === 0) err(w, '선택지가 없습니다');
  for (const [idx, ch] of (e.choices ?? []).entries()) {
    if (!ch.text) err(w, `choices[${idx}].text 가 비어 있습니다`);
    checkEffects(`${w}/choices[${idx}]`, ch.effects);
  }
  if (e.once === false && (e.trigger.year !== undefined || e.trigger.condition?.includes('year =')))
    warn(w, '반복 이벤트인데 특정 연도에 묶여 있습니다');
}

/* -------------------------------- 시나리오 -------------------------------- */

checkDuplicates('scenarios', SCENARIOS.map((s) => s.id));
for (const s of SCENARIOS) {
  const w = `scenarios/${s.id}`;
  const assigned = new Set<string>();
  for (const [faction, list] of Object.entries(s.ownership)) {
    if (!factionIds.has(faction)) err(w, `없는 세력: ${faction}`);
    for (const cid of list) {
      if (!castleIds.has(cid)) err(w, `없는 거점: ${cid}`);
      if (assigned.has(cid)) err(w, `거점이 두 세력에 중복 배정되었습니다: ${cid}`);
      assigned.add(cid);
    }
  }
  const unassigned = CASTLES.filter((c) => !assigned.has(c.id)).map((c) => c.id);
  if (unassigned.length > 0) warn(w, `주인 없는 거점(중립): ${unassigned.join(', ')}`);

  for (const rec of s.recommended) if (!factionIds.has(rec)) err(w, `없는 추천 세력: ${rec}`);

  for (const [oid, cid] of Object.entries(s.placement ?? {})) {
    if (!officerIds.has(oid)) err(w, `없는 인물 배치: ${oid}`);
    if (!castleIds.has(cid)) err(w, `없는 배치 거점: ${cid}`);
    const def = OFFICERS.find((o) => o.id === oid);
    const win = def ? officerWindow(def, s) : null;
    if (def && (win === null || win.appear > s.startYear || win.retire < s.startYear))
      warn(w, `${oid} 은(는) ${s.startYear}년에 활동하지 않아 배치가 무시됩니다`);
  }
  for (const oid of s.dead ?? []) if (!officerIds.has(oid)) err(w, `없는 인물(dead): ${oid}`);
  for (const cid of Object.keys(s.troops ?? {})) {
    if (!castleIds.has(cid)) err(w, `없는 거점(troops): ${cid}`);
    if (!assigned.has(cid)) warn(w, `주인 없는 거점에 병력이 지정되었습니다: ${cid}`);
  }
  for (const fid of Object.keys(s.resources ?? {})) {
    if (!factionIds.has(fid)) err(w, `없는 세력(resources): ${fid}`);
  }
  for (const r of s.relations ?? []) {
    if (!factionIds.has(r.a) || !factionIds.has(r.b)) err(w, `없는 세력(relations): ${r.a}/${r.b}`);
    if (!['war', 'peace', 'alliance', 'tribute'].includes(r.status))
      err(w, `알 수 없는 관계 상태: ${r.status}`);
    if (r.trust < -100 || r.trust > 100) err(w, `trust 범위 오류: ${r.trust}`);
  }
  for (const eid of s.events ?? []) if (!eventIds.has(eid)) err(w, `없는 이벤트: ${eid}`);
  for (const [fid, mod] of Object.entries(s.factionMods ?? {})) {
    if (!factionIds.has(fid)) err(w, `없는 세력(factionMods): ${fid}`);
    if (mod.councilSupport !== undefined && (mod.councilSupport < 0 || mod.councilSupport > 100))
      err(w, `factionMods.${fid}.councilSupport 범위 오류`);
    if (mod.autonomy !== undefined && (mod.autonomy < 0 || mod.autonomy > 100))
      err(w, `factionMods.${fid}.autonomy 범위 오류`);
    for (const [k, v] of Object.entries(mod.personality ?? {})) {
      if (typeof v !== 'number' || v < 0 || v > 1)
        err(w, `factionMods.${fid}.personality.${k} 는 0~1 이어야 합니다 (${v})`);
    }
  }
  if (s.startSeason < 0 || s.startSeason > 3) err(w, `startSeason 은 0~3 이어야 합니다`);

  // 시작 세력에 인물이 하나도 없으면 게임이 진행되지 않는다.
  const rosterAtStart = officersAliveIn(s.startYear, s).filter((o) => !(s.dead ?? []).includes(o.id));
  for (const faction of Object.keys(s.ownership)) {
    const owned = new Set(s.ownership[faction] ?? []);
    const mine = rosterAtStart.filter(
      (o) => o.faction === faction || owned.has(s.placement?.[o.id] ?? '')
    );
    if (mine.length === 0) err(w, `${faction} 에 ${s.startYear}년 시점의 인물이 한 명도 없습니다`);
    else if (mine.length < 3)
      warn(w, `${faction} 의 ${s.startYear}년 인물이 ${mine.length}명뿐입니다`);
  }
}

/* --------------------------------- 보조 검사 --------------------------------- */

function checkEffects(where: string, effects: string[]): void {
  for (const raw of effects ?? []) {
    let parsed;
    try {
      parsed = parseEffect(raw);
    } catch (e) {
      err(where, (e as Error).message);
      continue;
    }
    if (!KNOWN_EFFECTS.has(parsed.name)) {
      err(where, `알 수 없는 효과: ${parsed.name} ("${raw}")`);
      continue;
    }
    const { name, args } = parsed;
    const needsFaction = ['trust', 'war', 'peace', 'alliance', 'break_alliance'];
    const needsCastle = ['loyalty', 'troops', 'take_castle'];
    const needsOfficer = ['kill', 'join', 'defect'];

    if (needsFaction.includes(name) && args[0] && !factionIds.has(args[0]))
      err(where, `없는 세력: ${args[0]} ("${raw}")`);
    if (needsCastle.includes(name) && args[0] && !castleIds.has(args[0]))
      err(where, `없는 거점: ${args[0]} ("${raw}")`);
    if (needsOfficer.includes(name) && args[0] && !officerIds.has(args[0]))
      err(where, `없는 인물: ${args[0]} ("${raw}")`);
    if (name === 'give_castle') {
      if (!castleIds.has(args[0])) err(where, `없는 거점: ${args[0]} ("${raw}")`);
      if (args[1] && args[1] !== 'none' && !factionIds.has(args[1]))
        err(where, `없는 세력: ${args[1]} ("${raw}")`);
    }
  }
}

/** 조건식 안에 쓰인 식별자가 실제 데이터에 있는지 훑어본다. */
function checkConditionIds(where: string, condition: string): void {
  const idents = condition.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) ?? [];
  const known = new Set([
    ...castleIds,
    ...factionIds,
    ...officerIds,
    ...institutionIds,
    'year',
    'season',
    'turn',
    'actor',
    'AND',
    'OR',
    'NOT',
    'true',
    'false',
    'owns',
    'war',
    'peace',
    'alliance',
    'tribute',
    'trust',
    'flag',
    'institution',
    'alive',
    'serves',
    'hasSkill',
    'castles',
    'troops',
    'gold',
    'grain',
    'cause',
    'autonomy',
    'council',
    'factionAlive',
  ]);
  for (const id of idents) {
    // 플래그 이름은 자유 문자열이므로 flag(...) 안쪽은 건너뛴다.
    if (known.has(id)) continue;
    if (new RegExp(`flag\\s*\\(\\s*(?:[a-zA-Z_][a-zA-Z0-9_]*\\s*,\\s*)?${id}\\s*\\)`).test(condition))
      continue;
    warn(where, `조건식의 식별자를 데이터에서 찾지 못했습니다: ${id}`);
  }
}

/* ---------------------------------- 출력 ---------------------------------- */

const counts = [
  `거점 ${CASTLES.length}`,
  `세력 ${FACTIONS.length}`,
  `인물 ${OFFICERS.length}`,
  `병종 ${UNIT_TYPES.length}`,
  `제도 ${INSTITUTIONS.length}`,
  `이벤트 ${EVENTS.length}`,
  `시나리오 ${SCENARIOS.length}`,
].join(' / ');

console.log(`데이터 검증: ${counts}`);
for (const w of warnings) console.log(w);
for (const e of errors) console.error(e);

if (errors.length > 0) {
  console.error(`\n오류 ${errors.length}건, 경고 ${warnings.length}건 — 검증 실패`);
  process.exit(1);
}
console.log(`\n오류 없음 (경고 ${warnings.length}건) — 검증 통과`);
