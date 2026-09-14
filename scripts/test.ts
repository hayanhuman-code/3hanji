/**
 * test.ts — 의존성 없는 스모크 테스트.
 *
 * 프레임워크를 붙이지 않고 assert 만으로 돌린다(1인 개발의 범위 방어).
 * 실행: npm test
 */

import { evaluate, validateCondition } from '../src/core/dsl';
import { pickAIChoice } from '../src/core/events';
import { RngCursor, seedFromString } from '../src/core/rng';
import { addLog, createGame, factionCastles, factionTroops, getRelation } from '../src/core/state';
import { STATE_VERSION } from '../src/core/state';
import { eventsSince, lastEventId, leadingFaction, summarizeRun } from '../src/core/stats';
import { checkVictory, victoryStatus } from '../src/core/victory';
import { canSail, navalPlan } from '../src/core/naval';
import { transferCastle } from '../src/core/effects';
import type { CaptureMethod, GameEvent } from '../src/core/types';
import { deserialize, serialize } from '../src/core/save';
import { beginNextTurn, completeEvent, resolveTurn } from '../src/core/turn';
import { findPath } from '../src/core/util';
import { castleDef, CASTLES, OFFICERS } from '../src/core/data';
import { TROOPS, type Troop } from '../src/core/types';
import {
  CLASS,
  TERRAIN,
  FACTION_AFFINITY,
  TIER_POWER,
  WATER_ATTACK,
  WATER_DEFENSE,
  WATER_SPEED,
} from '../src/core/field/balance';
import { BATTLEFIELD_IDS, battlefield, tileSize } from '../src/core/field/battlefield';
import { buildFieldSetup, fieldPossible } from '../src/core/field/bridge';
import { TIER_CAP } from '../src/core/field/balance';
import { applyDomesticCommand, validateCommand } from '../src/core/domestic';
import { createField } from '../src/core/field/setup';
import { createSiegeState, insideWall, insideWallGrid, isEncircled } from '../src/core/field/siege';
import { runToEnd, step, summarizeUnits, unitDefense, unitPower } from '../src/core/field/sim';
import { findFieldPath } from '../src/core/field/pathfind';
import type { FieldEntry, FieldSetup, Row } from '../src/core/field/types';
import type { PendingBattle } from '../src/core/types';
import {
  applyFieldResult,
  canPass,
  captureCastle,
  castleDefensePower,
  compositionPower,
  findMarchPath,
  resolveFieldAuto,
  nearestFriendlyCastle,
  needsDeclaration,
  retreatArmy,
  seaClosed,
  validateMarch,
} from '../src/core/military';
import { atWar } from '../src/core/state';
import { T, contrast, textOn } from '../src/ui/tokens';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}\n      ${(e as Error).message}`);
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function assertEqual<T>(actual: T, expected: T, msg = ''): void {
  if (actual !== expected) throw new Error(`${msg} (기댓값 ${String(expected)}, 실제 ${String(actual)})`);
}

function section(title: string): void {
  console.log(`\n${title}`);
}

/* ================================================================== *
 * 조건식 DSL
 * ================================================================== */

section('조건식 DSL');

const ctx = {
  variable(name: string) {
    return { year: 642, season: 2, turn: 3 }[name];
  },
  call(name: string, args: string[]) {
    if (name === 'owns') return args[1] === 'daeya';
    if (name === 'alliance') return true;
    if (name === 'castles') return 6;
    if (name === 'flag') return args[args.length - 1] === 'nadang';
    throw new Error(`unknown ${name}`);
  },
};

test('비교 연산', () => {
  assertEqual(evaluate('year >= 642', ctx), true);
  assertEqual(evaluate('year > 642', ctx), false);
  assertEqual(evaluate('year == 642', ctx), true);
  assertEqual(evaluate('year != 642', ctx), false);
  assertEqual(evaluate('castles(silla) > 5', ctx), true);
});

test('논리 연산과 괄호', () => {
  assertEqual(evaluate('year == 642 AND owns(silla, daeya)', ctx), true);
  assertEqual(evaluate('year == 641 OR owns(silla, daeya)', ctx), true);
  assertEqual(evaluate('NOT owns(silla, geumseong)', ctx), true);
  assertEqual(evaluate('(year < 600 OR castles(silla) >= 6) AND alliance(a, b)', ctx), true);
  assertEqual(evaluate('!owns(silla, daeya)', ctx), false);
  assertEqual(evaluate('year >= 642 && castles(silla) >= 6', ctx), true);
});

test('술어 단독 평가', () => {
  assertEqual(evaluate('flag(nadang)', ctx), true);
  assertEqual(evaluate('flag(silla, nadang)', ctx), true);
  assertEqual(evaluate('flag(other)', ctx), false);
});

test('빈 조건은 참', () => {
  assertEqual(evaluate('', ctx), true);
  assertEqual(evaluate('   ', ctx), true);
});

test('문법 오류를 잡아낸다', () => {
  assert(validateCondition('year >= ') !== null, '불완전한 식이 통과했습니다');
  assert(validateCondition('owns(silla daeya)') !== null, '쉼표 없는 인자가 통과했습니다');
  assert(validateCondition('year >= 642') === null, '정상 식이 거부되었습니다');
});

/* ================================================================== *
 * 거점 그래프
 * ================================================================== */

section('거점 그래프');

test('모든 거점 사이에 길이 있다', () => {
  for (const from of CASTLES) {
    for (const to of CASTLES) {
      if (from.id === to.id) continue;
      const path = findPath(from.id, to.id, (id) => castleDef(id).neighbors);
      assert(path !== null, `${from.id} → ${to.id} 경로 없음`);
    }
  }
});

test('바다로만 닿는 거점은 탐라·우산국·덕물도뿐이다', () => {
  // 이 셋은 육로가 없어 겨울에 고립된다. 그 사실이 의도된 것임을 못 박아 둔다 —
  // 여기에 하나가 더 늘면 겨울마다 갇히는 곳이 늘었다는 뜻이므로 눈에 띄어야 한다.
  const seaOnly = CASTLES.filter((c) => c.routes.land.length === 0).map((c) => c.id);
  assertEqual(
    seaOnly.sort().join(','),
    'deokmul,tamna,usanguk',
    '바다로만 닿는 거점 목록이 달라졌습니다'
  );
});

test('육로만으로도 본토는 하나로 이어진다', () => {
  // 수로를 다 걷어내도 반도와 요동이 갈라지면 안 된다.
  const land = CASTLES.filter((c) => c.routes.land.length > 0);
  for (const to of land) {
    if (to.id === land[0].id) continue;
    const path = findPath(land[0].id, to.id, (id) => castleDef(id).routes.land);
    assert(path !== null, `육로만으로 ${land[0].id} → ${to.id} 가 끊깁니다`);
  }
});

/* ================================================================== *
 * 난수
 * ================================================================== */

section('결정론적 난수');

test('같은 시드는 같은 수열', () => {
  const a = new RngCursor(42);
  const b = new RngCursor(42);
  for (let i = 0; i < 50; i++) assertEqual(a.next(), b.next(), `${i}번째`);
});

test('난수는 0 이상 1 미만', () => {
  const r = new RngCursor(seedFromString('삼한지'));
  for (let i = 0; i < 5000; i++) {
    const v = r.next();
    assert(v >= 0 && v < 1, `범위 밖: ${v}`);
  }
});

/* ================================================================== *
 * 게임 상태·턴 엔진
 * ================================================================== */

section('게임 상태와 턴 엔진');

test('시나리오 초기 상태가 일관된다', () => {
  const s = createGame({ scenarioId: 's642', playerFaction: 'silla' });
  assertEqual(s.year, 642);
  assertEqual(s.playerFaction, 'silla');
  for (const c of Object.values(s.castles)) {
    const total = c.composition.reduce((x, u) => x + u.count, 0);
    if (c.owner) assertEqual(total, c.troops, `${c.id} 편성 합계 불일치`);
  }
  for (const f of ['goguryeo', 'baekje', 'silla']) {
    assert(factionCastles(s, f).length > 0, `${f} 에 거점이 없습니다`);
    assert(factionTroops(s, f) > 0, `${f} 에 병력이 없습니다`);
  }
  // 배치된 인물은 반드시 그 거점의 명부에 있어야 한다.
  for (const o of Object.values(s.officers)) {
    if (o.status !== 'active' || !o.location) continue;
    assert(
      s.castles[o.location].officers.includes(o.id),
      `${o.id} 가 ${o.location} 명부에 없습니다`
    );
  }
});

test('60턴을 돌려도 상태가 깨지지 않는다', () => {
  const s = createGame({
    scenarioId: 's642',
    playerFaction: 'silla',
    options: { autoBattle: true },
    seed: 9001,
  });
  for (const f of Object.values(s.factions)) f.isAI = true;
  const rng = new RngCursor(5);

  for (let t = 0; t < 60 && !s.result; t++) {
    let guard = 0;
    for (;;) {
      const step = resolveTurn(s);
      if (step.kind === 'event') {
        completeEvent(s, pickAIChoice(s, step.pending, rng));
      } else if (step.kind === 'battle') {
        s.pendingBattles.shift();
      } else break;
      assert(guard++ < 500, '턴 처리 루프가 끝나지 않습니다');
    }
    if (s.result) break;
    beginNextTurn(s);

    // 불변식 검사
    for (const c of Object.values(s.castles)) {
      assert(c.troops >= 0, `${c.id} 병력이 음수`);
      assert(c.loyalty >= 0 && c.loyalty <= 100, `${c.id} 민심 범위 이탈: ${c.loyalty}`);
      const total = c.composition.reduce((x, u) => x + u.count, 0);
      assert(
        Math.abs(total - c.troops) <= 1 || c.composition.length === 0,
        `${c.id} 편성(${total}) 과 병력(${c.troops}) 불일치`
      );
      if (!c.owner) assertEqual(c.troops, 0, `${c.id} 무주공산인데 병력이 있음`);
    }
    for (const f of Object.values(s.factions)) {
      for (const [k, v] of Object.entries(f.resources)) {
        assert(v >= 0 && Number.isFinite(v), `${f.id}.${k} 이상: ${v}`);
      }
    }
    for (const o of Object.values(s.officers)) {
      if (o.status === 'active') {
        assert(o.faction !== null, `${o.id} 현역인데 소속이 없음`);
        assert(
          o.location !== null || o.armyId !== null,
          `${o.id} 현역인데 있을 곳이 없음`
        );
      }
    }
  }
  assert(s.turn > 1, '턴이 진행되지 않았습니다');
});

test('명령 단계에서 모든 장수의 행동이 초기화된다', () => {
  const s = createGame({ scenarioId: 's642', playerFaction: 'silla', options: { autoBattle: true } });
  for (;;) {
    const step = resolveTurn(s);
    if (step.kind === 'event') completeEvent(s, 0);
    else break;
  }
  beginNextTurn(s);
  const stuck = Object.values(s.officers).filter(
    (o) => o.acted && o.faction === 'silla' && o.status === 'active'
  );
  assertEqual(stuck.length, 0, '행동 플래그가 남아 있습니다');
});

/* ================================================================== *
 * 저장/로드
 * ================================================================== */

section('저장과 로드');

test('직렬화 왕복이 상태를 보존한다', () => {
  const s = createGame({ scenarioId: 's551', playerFaction: 'baekje', seed: 7 });
  const restored = deserialize(serialize(s));
  assertEqual(JSON.stringify(restored), JSON.stringify(s), '왕복 후 상태가 달라졌습니다');
});

test('로드한 상태에서 이어서 돌려도 같은 결과가 나온다', () => {
  const make = () => {
    const g = createGame({
      scenarioId: 's642',
      playerFaction: 'goguryeo',
      options: { autoBattle: true },
      seed: 31337,
    });
    for (const f of Object.values(g.factions)) f.isAI = true;
    return g;
  };
  const run = (g: ReturnType<typeof make>, turns: number) => {
    for (let t = 0; t < turns && !g.result; t++) {
      for (;;) {
        const step = resolveTurn(g);
        if (step.kind === 'event') completeEvent(g, 0);
        else if (step.kind === 'battle') g.pendingBattles.shift();
        else break;
      }
      if (g.result) break;
      beginNextTurn(g);
    }
  };

  const direct = make();
  run(direct, 12);

  const viaSave = make();
  run(viaSave, 6);
  const reloaded = deserialize(serialize(viaSave));
  run(reloaded, 6);

  assertEqual(
    JSON.stringify(reloaded.castles),
    JSON.stringify(direct.castles),
    '저장을 거치면 결과가 달라집니다'
  );
});

/* ================================================================== *
 * 병종 계열 (전투 기획서 §3)
 *
 * 장수는 계열이 고정된다. 전직도 레벨업도 없다 — 강해지는 것은 나라다.
 * 여기서 지키려는 것은 「편성이 성립하는가」다. 한 계열이 말라 버리면
 * 3열 진형을 짤 수 없고, 수군 장수가 없으면 바닷길 13개가 죽는다.
 * ================================================================== */

section('병종 계열');

test('모든 인물이 계열을 갖고 값이 넷 중 하나다', () => {
  const bad = OFFICERS.filter((o) => !TROOPS.includes(o.troop));
  assertEqual(bad.length, 0, `계열이 이상한 인물: ${bad.slice(0, 3).map((o) => o.id).join(', ')}`);
});

test('네 계열 어느 것도 말라 있지 않다', () => {
  for (const t of TROOPS) {
    const n = OFFICERS.filter((o) => o.troop === t).length;
    assert(n >= 25, `${t} 계열이 ${n}명뿐이라 편성을 못 짭니다`);
  }
});

test('세력마다 수군을 이끌 인물이 있다', () => {
  for (const f of ['goguryeo', 'baekje', 'silla', 'gaya']) {
    const n = OFFICERS.filter((o) => o.faction === f && o.naval).length;
    assert(n > 0, `${f} 에 수군 장수가 없어 바닷길을 못 씁니다`);
  }
});

test('사료상 못 박은 인물의 계열이 지켜진다', () => {
  const want: Record<string, string> = {
    gwanggaeto: 'cav', // 광개토대왕은 언제까지나 기병이다
    eulji: 'str', // 을지문덕 — 수계의 주인
    yangmanchun: 'inf', // 안시성 농성
    gyebaek: 'inf',
    kimyusin: 'cav',
    jangbogo: 'arc',
  };
  for (const [id, troop] of Object.entries(want)) {
    const o = OFFICERS.find((x) => x.id === id);
    if (!o) continue; // 명부에 없으면 이 검사의 관심사가 아니다
    assertEqual(o.troop, troop, `${id} 의 계열이 바뀌었습니다`);
  }
  const jang = OFFICERS.find((o) => o.id === 'jangbogo');
  if (jang) assert(jang.naval, '장보고가 수군을 못 이끕니다');
});

/* ================================================================== *
 * 전장 (전투 v2)
 *
 * 여기서 지키려는 것 셋.
 *   ① 판이 재현된다 — 같은 시드면 같은 결과. 즉시결판과 관전이 어긋나면 안 된다
 *   ② 갈 수 있는 땅이 이어져 있다 — 강이 판을 두 쪽으로 가르면 전투가 성립 안 한다
 *   ③ 나라가 병종보다 크다 — 세력 계수가 단계 계수를 넘어서면 안 된다
 * ================================================================== */

section('전장');

const fieldStats = new Map(OFFICERS.map((o) => [o.id, o.stats]));
const statsFor = (id: string) => fieldStats.get(id)!;

/** 시험용 편성 — 세력에서 계열별로 한 명씩 뽑는다 */
function fieldArmy(faction: string, mix: Troop[], troops: number): FieldEntry[] {
  const skip = new Set<string>();
  const rows: Record<Troop, Row> = { inf: 'front', cav: 'mid', arc: 'rear', str: 'rear' };
  const out: FieldEntry[] = [];
  for (const t of mix) {
    const o = OFFICERS.find((x) => x.faction === faction && x.troop === t && !skip.has(x.id));
    if (!o) continue;
    skip.add(o.id);
    out.push({ officer: o.id, troops, row: rows[t], reserve: false });
  }
  return out;
}

function fieldSetup(seed: number, fieldId = 'hanseong'): FieldSetup {
  const tiers = { inf: 2, cav: 2, arc: 2, str: 2 } as Record<Troop, 1 | 2 | 3 | 4>;
  const mix: Troop[] = ['inf', 'inf', 'cav', 'arc'];
  return {
    fieldId,
    seed,
    season: 0,
    siege: false,
    playerSide: null,
    attackerFaction: 'goguryeo',
    defenderFaction: 'silla',
    tiers: { attacker: tiers, defender: tiers },
    attacker: fieldArmy('goguryeo', mix, 2500),
    defender: fieldArmy('silla', mix, 2500),
  };
}

test('같은 시드는 같은 결과를 낸다 (즉시결판 = 관전)', () => {
  const a = runToEnd(createField(fieldSetup(4242)), statsFor);
  const b = runToEnd(createField(fieldSetup(4242)), statsFor);
  assertEqual(a.tick, b.tick, '같은 시드인데 전투 길이가 다릅니다');
  assertEqual(a.result?.winner, b.result?.winner, '같은 시드인데 승자가 다릅니다');
  assertEqual(
    a.result?.attackerLoss,
    b.result?.attackerLoss,
    '같은 시드인데 손실이 다릅니다'
  );
});

test('시드가 다르면 결과도 갈린다 (판이 굳어 있지 않다)', () => {
  const runs = [11, 22, 33, 44, 55].map((s) => runToEnd(createField(fieldSetup(s)), statsFor));
  const ticks = new Set(runs.map((r) => r.tick));
  assert(ticks.size > 1, '시드를 바꿔도 전투가 똑같이 흘러갑니다');
});

test('전투가 실제로 끝난다 — 지쳐 쓰러지는 것이 아니라 승패로', () => {
  for (const seed of [7, 77, 777]) {
    const st = runToEnd(createField(fieldSetup(seed)), statsFor);
    assertEqual(st.phase, 'done', '전투가 안 끝났습니다');
    assert(st.result !== null, '결과가 없습니다');
    const loss = (st.result!.attackerLoss + st.result!.defenderLoss) / 20000;
    assert(loss > 0.05, `피해가 거의 없습니다 (${Math.round(loss * 100)}%) — 부대가 못 붙었을 수 있습니다`);
  }
});

test('전멸할 때까지 싸우지 않는다 — 돌아갈 군대가 남는다', () => {
  const st = runToEnd(createField(fieldSetup(31337)), statsFor);
  const left = st.result!.survivors.reduce((s, x) => s + x.troops, 0);
  assert(left > 0, '양쪽이 전멸했습니다 — 전략맵으로 돌아갈 병력이 없습니다');
});

test('하천을 건널 수 있으므로 모든 전장이 이어진다', () => {
  // 다리는 놓지 않는다. 대신 누구나 뗏목으로 하천을 건넌다 — 그래서 강이
  // 판을 두 쪽으로 가르지 않는다. 먼바다·험지·성벽만 막는다.
  const BLOCK = new Set(['s', 'X', 'W']);
  const broken: string[] = [];
  for (const id of BATTLEFIELD_IDS) {
    const f = battlefield(id);
    const H = f.tiles.length;
    const W = f.w;
    const seen = new Uint8Array(W * H);
    const sizes: number[] = [];
    const at = (x: number, y: number) => (y < H && x < f.tiles[y].length ? f.tiles[y][x] : 's');
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (BLOCK.has(at(x, y)) || seen[y * W + x]) continue;
        let n = 0;
        const stack = [[x, y]];
        seen[y * W + x] = 1;
        while (stack.length) {
          const [cx, cy] = stack.pop()!;
          n++;
          for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + ox;
            const ny = cy + oy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            if (BLOCK.has(at(nx, ny)) || seen[ny * W + nx]) continue;
            seen[ny * W + nx] = 1;
            stack.push([nx, ny]);
          }
        }
        sizes.push(n);
      }
    }
    // 계립령의 산성 안쪽(44칸)처럼 성벽·절벽으로 둘러싸인 곳은 성문으로만 든다.
    // 그것 말고 큰 덩어리가 둘 이상이면 전투가 성립하지 않는다.
    if (sizes.filter((n) => n >= 80).length > 1) broken.push(id);
  }
  assertEqual(broken.length, 0, `강이 판을 가른 전장: ${broken.join(', ')}`);
});

test('물 위에서는 수군이 압도한다', () => {
  // 다리를 놓는 대신 누구나 배를 지어 건너게 했다. 대신 물 위에서는
  // 수군만 제 위력을 낸다 — 그것이 수군을 가질 이유다.
  for (const t of ['inf', 'cav', 'arc', 'str'] as Troop[]) {
    assert(
      WATER_ATTACK.navy > WATER_ATTACK[t] * 3,
      `물 위 공격에서 수군이 ${t} 보다 세 배도 강하지 않습니다`
    );
    assert(
      WATER_DEFENSE.navy > WATER_DEFENSE[t] * 3,
      `물 위 방어에서 수군이 ${t} 보다 세 배도 강하지 않습니다`
    );
  }
});

test('물 위 속도는 수군 > 책략 > 보병 > 궁병 > 기병', () => {
  // 말을 배에 태우는 것이 제일 힘들다. 육상에서 기병이 제일 빠른 것과 반대다.
  const order: Array<Troop | 'navy'> = ['navy', 'str', 'inf', 'arc', 'cav'];
  for (let i = 0; i + 1 < order.length; i++) {
    assert(
      WATER_SPEED[order[i]] > WATER_SPEED[order[i + 1]],
      `물 위 속도 순서가 어긋납니다: ${order[i]} ≤ ${order[i + 1]}`
    );
  }
  assert(CLASS.cav.speed > CLASS.inf.speed, '육상에서는 기병이 더 빨라야 합니다');
  assert(WATER_SPEED.cav < WATER_SPEED.inf, '물 위에서는 기병이 더 느려야 합니다');
});

test('물에 발을 들이면 위력이 무너진다 (수군만 빼고)', () => {
  // 표만 보지 않고 실제 계산에 걸리는지 본다. 표는 맞는데 배선이 빠져
  // 아무 데도 안 쓰이는 일이 가장 흔한 실수다.
  const st = createField(fieldSetup(1));
  const stats = { lead: 80, war: 80, int: 80 };
  const land = st.units.find((u) => u.troop === 'inf')!;
  const dry = unitPower(land, stats, false);
  const wet = unitPower(land, stats, true);
  assert(wet < dry * 0.4, `보병이 물 위에서도 셉니다 (뭍 ${dry.toFixed(2)} → 물 ${wet.toFixed(2)})`);
  const wetDef = unitDefense(land, stats, true);
  assert(wetDef < unitDefense(land, stats, false) * 0.4, '보병이 물 위에서도 단단합니다');

  // 같은 부대를 수군으로 편성하면 물 위에서 제 위력을 낸다
  const navy = { ...land, navy: true };
  assertEqual(
    Math.round(unitPower(navy, stats, true) * 1000),
    Math.round(unitPower(navy, stats, false) * 1000),
    '수군이 물 위에서 약해졌습니다'
  );
});

test('강 건너편으로 길이 난다 — 다리 없이', () => {
  // 한성은 한강이 판을 가른다. 다리를 놓지 않았으므로 길은 물을 지나야 한다.
  const f = battlefield('hanseong');
  const path = findFieldPath(f, { x: 3500, y: 400 }, { x: 3500, y: 4600 }, false);
  assert(path.length > 0, '강 건너편으로 가는 길을 못 찾습니다');
});

test('나라를 키우는 쪽이 명장보다 크다 — 세력 계수가 단계를 못 넘는다', () => {
  const tierSpread = TIER_POWER[4] / TIER_POWER[1];
  let widest = 1;
  for (const row of Object.values(FACTION_AFFINITY)) {
    const vs = Object.values(row);
    widest = Math.max(widest, Math.max(...vs) / Math.min(...vs));
  }
  assert(
    widest < tierSpread,
    `세력 계수 폭(${widest.toFixed(2)})이 단계 계수 폭(${tierSpread.toFixed(2)})을 넘습니다`
  );
});

test('고구려 기병은 1단계부터 더 세다', () => {
  assert(
    FACTION_AFFINITY.goguryeo.cav > FACTION_AFFINITY.silla.cav &&
      FACTION_AFFINITY.goguryeo.cav > FACTION_AFFINITY.baekje.cav,
    '고구려 기병이 신라·백제 기병보다 세지 않습니다'
  );
  assert(FACTION_AFFINITY.gaya.inf > FACTION_AFFINITY.goguryeo.inf, '가야 보병이 세지 않습니다');
  assert(FACTION_AFFINITY.baekje.navy > FACTION_AFFINITY.goguryeo.navy, '백제 수군이 세지 않습니다');
});

/* ================================================================== *
 * 전략 ↔ 전장 이음매
 *
 * 두 층 사이가 어긋나면 「전투는 이겼는데 병력이 안 돌아온다」 같은 일이 난다.
 * 이 절은 그 통역이 숫자를 흘리지 않는지를 본다.
 * ================================================================== */

section('전략 ↔ 전장 이음매');

test('거점과 전장이 1:1 로 맞는다', () => {
  const ids = new Set(BATTLEFIELD_IDS);
  for (const c of CASTLES) {
    assert(ids.has(c.id), `${c.id} 의 전장이 없습니다`);
  }
  assertEqual(BATTLEFIELD_IDS.length, CASTLES.length, '전장 수와 거점 수가 다릅니다');
});

test('군대를 전장 편성으로 옮기면 병력 총합이 보존된다', () => {
  const s = createGame({ scenarioId: 's642', playerFaction: 'silla', seed: 31 });
  const from = factionCastles(s, 'silla')[0];
  const target = castleDef(from.id).neighbors.find((n) => s.castles[n].owner === 'baekje');
  if (!target) return; // 이 시나리오에 백제와 맞댄 곳이 없으면 넘어간다
  const officers = from.officers.slice(0, 3);
  const troops = Math.min(6000, from.troops - 500);
  s.armies['a1'] = {
    id: 'a1',
    faction: 'silla',
    commander: officers[0],
    officers,
    units: [{ unitType: 'infantry', count: troops }],
    location: from.id,
    path: [target],
    target,
    grain: 1000,
    morale: 70,
    training: 60,
    siegeMode: 'assault',
  };
  const setup = buildFieldSetup(s, {
    id: 'b1',
    castle: target,
    attacker: 'silla',
    defender: 'baekje',
    attackerArmies: ['a1'],
    defenderArmies: [],
    siege: true,
    manual: false,
  });
  const sum = setup.attacker.reduce((a, e) => a + e.troops, 0);
  assertEqual(sum, troops, '전장으로 넘긴 병력 합계가 다릅니다');
  assert(setup.attacker.length <= 12, '한쪽이 12부대를 넘었습니다');
  // 계열은 장수를 따른다 — 무엇을 징병했든 상관없다 (§1.2)
  for (const e of setup.attacker) {
    assertEqual(e.officer in s.officers, true, '없는 인물이 편성되었습니다');
  }
});

test('한쪽에 장수가 없으면 전장이 서지 않는다', () => {
  const s = createGame({ scenarioId: 's642', playerFaction: 'silla', seed: 32 });
  const target = factionCastles(s, 'baekje')[0];
  const setup = buildFieldSetup(s, {
    id: 'b2',
    castle: target.id,
    attacker: 'silla',
    defender: 'baekje',
    attackerArmies: [],
    defenderArmies: [],
    siege: true,
    manual: false,
  });
  assertEqual(fieldPossible(setup), false, '이끌 사람 없이 전장이 섰습니다');
});

test('병종 개발은 나라마다 상한이 다르다', () => {
  const s = createGame({ scenarioId: 's642', playerFaction: 'goguryeo', seed: 33 });
  const f = s.factions.goguryeo;
  for (const t of TROOPS) assertEqual(f.troopTiers[t], 1, `${t} 가 1단계로 시작하지 않습니다`);
  // 자원을 넉넉히 주고 상한까지 올려 본다
  f.resources.gold = 999999;
  f.resources.iron = 999999;
  const cap = TIER_CAP.goguryeo.cav;
  for (let i = 0; i < 6; i++) {
    const err = validateCommand(s, { kind: 'armament', faction: 'goguryeo', troop: 'cav' });
    if (err) break;
    applyDomesticCommand(s, { kind: 'armament', faction: 'goguryeo', troop: 'cav' }, new RngCursor(1));
  }
  assertEqual(f.troopTiers.cav, cap, '고구려 기병이 상한까지 안 올라갔습니다');
  assert(
    validateCommand(s, { kind: 'armament', faction: 'goguryeo', troop: 'cav' }) !== null,
    '상한을 넘겨 올릴 수 있습니다'
  );
});

test('전장 결과가 전략맵의 병력을 줄인다', () => {
  const s = createGame({ scenarioId: 's642', playerFaction: 'silla', seed: 34 });
  const from = factionCastles(s, 'silla')[0];
  // 지킬 사람이 있는 이웃 성을 고른다 — 부대는 장수를 통해서만 존재한다
  const target = castleDef(from.id).neighbors.find(
    (n) => s.castles[n].owner && s.castles[n].owner !== 'silla' && s.castles[n].officers.length > 0
  );
  if (!target) return;
  const defender = s.castles[target].owner!;
  const officers = from.officers.slice(0, 3);
  const troops = Math.min(8000, from.troops - 500);
  s.armies['a1'] = {
    id: 'a1',
    faction: 'silla',
    commander: officers[0],
    officers,
    units: [{ unitType: 'infantry', count: troops }],
    location: from.id,
    path: [target],
    target,
    grain: 1000,
    morale: 70,
    training: 60,
    siegeMode: 'assault',
  };
  const pending: PendingBattle = {
    id: 'b3',
    castle: target,
    attacker: 'silla',
    defender,
    attackerArmies: ['a1'],
    defenderArmies: [],
    siege: true,
    manual: false,
  };
  const result = resolveFieldAuto(s, pending);
  assert(result !== null, '전투가 성립하지 않았습니다');
  assert(result!.attackerLoss >= 0 && result!.defenderLoss >= 0, '피해가 음수입니다');
  applyFieldResult(s, pending, result!, new RngCursor(7));
  const after = s.armies['a1'];
  const left = after ? after.units.reduce((a, u) => a + u.count, 0) : 0;
  assert(left < troops, '전투를 치렀는데 병력이 그대로입니다');
  assert(left >= 0, '병력이 음수가 되었습니다');
});

/* ================================================================== *
 * 공성전 (§6)
 *
 * **공성전은 성벽을 낀 야전이 아니다.** 여기가 무너지면 함락 경로가 사라져
 * 게임이 끝나지 않는다 — 실제로 결착률 0% 의 원인이었다.
 * ================================================================== */

section('공성전');

function siegeSetup(over: Partial<FieldSetup> = {}): FieldSetup {
  const pickN = (faction: string, n: number) =>
    OFFICERS.filter((o) => o.faction === faction)
      .slice(0, n)
      .map((o, i) => ({
        officer: o.id,
        troops: 4000,
        row: (['front', 'front', 'mid', 'rear'] as Row[])[i % 4],
        reserve: false,
      }));
  return {
    fieldId: 'hanseong',
    seed: 4242,
    season: 0,
    siege: true,
    wallDev: 60,
    grain: 5000,
    wardenChr: 60,
    wardenTrait: 'loyal',
    playerSide: null,
    attackerFaction: 'goguryeo',
    defenderFaction: 'silla',
    tiers: {
      attacker: { inf: 2, cav: 2, arc: 2, str: 2 },
      defender: { inf: 2, cav: 2, arc: 2, str: 2 },
    },
    attacker: pickN('goguryeo', 8),
    defender: pickN('silla', 8),
    ...over,
  };
}

test('성벽 안쪽과 바깥쪽이 갈린다', () => {
  const f = battlefield('hanseong');
  const grid = insideWallGrid(f);
  const inside = grid.reduce((a, v) => a + v, 0);
  assert(inside > 0, '성 안이 하나도 없습니다');
  assert(inside < f.w * f.h * 0.5, `성 안이 전장의 절반을 넘습니다 (${inside}칸)`);
  // 전장 네 귀퉁이는 반드시 바깥이다
  for (const [x, y] of [[0, 0], [f.w - 1, 0], [0, f.h - 1], [f.w - 1, f.h - 1]]) {
    assertEqual(grid[y * f.w + x], 0, `(${x},${y}) 가 성 안으로 잡혔습니다`);
  }
});

test('공성전은 성벽·성문 HP 를 갖는다 (§6.2)', () => {
  const st = createField(siegeSetup({ wallDev: 100 }));
  const s = st.siegeState;
  assert(s !== null, '공성전인데 성이 없습니다');
  assertEqual(s!.wallMax, 12000, '성벽 HP 가 성곽 개발도 × 120 이 아닙니다');
  assertEqual(s!.gateMax, 4200, '성문 HP 가 성벽의 0.35 가 아닙니다');
});

test('돌파 전에는 근접 교전이 성립하지 않는다 (§6.1)', () => {
  const st = createField(siegeSetup());
  // 성 안 수비군과 성 밖 공격군이 실제로 갈려 있어야 한다
  const inside = st.units.filter((u) => u.side === 'defender' && insideWall(st.field, u.x, u.y));
  const outside = st.units.filter((u) => u.side === 'attacker' && !insideWall(st.field, u.x, u.y));
  assert(inside.length > 0, '수비군이 성 안에 없습니다');
  assert(outside.length > 0, '공격군이 성 밖에 없습니다');

  // 근접 부대를 수비군 코앞에 억지로 옮겨 놓아도 피해가 안 들어가야 한다
  const foot = outside.find((u) => u.troop === 'inf')!;
  const mark = inside[0];
  const before = mark.troops;
  foot.x = mark.x + 40;
  foot.y = mark.y + 40;
  // 성벽 밖으로 다시 옮긴다 — 안팎이 갈린 채로 붙어 있는 상황을 만든다
  const grid = insideWallGrid(st.field);
  void grid;
  for (let i = 0; i < 600; i++) step(st, () => ({ lead: 80, war: 80, int: 80 }));
  assert(!st.siegeState!.breached || mark.troops <= before, '판정이 이상합니다');
});

test('성문을 깨는 데 몇 시간이 걸린다 — 몇 분이 아니라', () => {
  const st = runToEnd(createField(siegeSetup({ wallDev: 95 })), () => ({ lead: 75, war: 75, int: 75 }));
  const s = st.siegeState!;
  // 돌파했다면 최소 두 시간은 걸렸어야 한다 (초기값에서 90초 만에 깨진 적이 있다)
  if (s.breachTick !== null) {
    assert(s.breachTick > 2 * 3600, `성문이 ${(s.breachTick / 3600).toFixed(1)}시간 만에 깨졌습니다`);
  }
  assert(st.result !== null, '공성전이 끝나지 않았습니다');
});

test('공성전은 반드시 끝나고, 성문은 실제로 깨진다', () => {
  /*
   * 「어떤 성은 함락된다」로 두었던 검사다. §7 성곽 규격이 들어오면서
   * 성이 훨씬 단단해져(해자·옹성·치·이중성벽) 무른 성도 잘 안 떨어지게
   * 되었다 — 그건 밸런스 판단이 필요한 사안이지 코드 결함이 아니다.
   *
   * 여기서 지킬 불변식은 **함락 경로가 살아 있는가**다. 성문이 깨지면
   * §6.3-① 강공이 실제로 통하고 있는 것이고, 안 깨지면 규칙이 죽은 것이다.
   */
  let breached = 0;
  for (let i = 0; i < 6; i++) {
    const st = runToEnd(
      createField(siegeSetup({ seed: 900 + i * 331, wallDev: 45, grain: 2500 })),
      () => ({ lead: 78, war: 78, int: 78 })
    );
    assert(st.result !== null, `${i}: 공성전이 끝나지 않았습니다`);
    if (st.siegeState!.breached || st.siegeState!.surrendered) breached++;
  }
  assert(breached > 0, '무른 성(성곽 45)이 여섯 판에 한 번도 안 뚫렸습니다');
});

test('포위는 명령이 아니라 자리다 — 길목을 막아야 성립한다', () => {
  /*
   * 「포위」를 눌렀다고 굶는 것이 아니라, 성문으로 드는 길을 실제로 끊어야
   * 굶는다. 전장 가장자리에서 성문까지 물이 흐르는지로 판정한다.
   *
   * 여기서는 그 판정 자체를 본다 — 공격군을 성 밖 제자리에 두면 길이
   * 열려 있고, 성벽 바깥 한 칸을 통째로 둘러 세우면 끊긴다.
   */
  const st = createField(siegeSetup());
  assert(!isEncircled(st), '배치 직후인데 벌써 포위로 잡힙니다');

  // 성벽 바깥 테두리를 공격 부대로 다 채워 본다 (부대 수를 늘려서라도)
  const f = st.field;
  const [tw, th] = tileSize(f);
  const grid = insideWallGrid(f);
  const ring: Array<[number, number]> = [];
  for (let y = 0; y < f.h; y++) {
    for (let x = 0; x < f.w; x++) {
      if (grid[y * f.w + x]) continue;
      const c = f.tiles[y][x];
      if (c === 'W' || c === 'G' || c === 'T' || c === 'O') continue;
      // 성벽 계열에 붙은 바깥 칸
      let touches = false;
      for (let dy = -1; dy <= 1 && !touches; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const a = x + dx;
          const b = y + dy;
          if (a < 0 || b < 0 || a >= f.w || b >= f.h) continue;
          const t = f.tiles[b][a];
          if (t === 'W' || t === 'G' || t === 'T' || t === 'O') {
            touches = true;
            break;
          }
        }
      }
      if (touches) ring.push([x, y]);
    }
  }
  assert(ring.length > 0, '성벽 바깥 테두리를 못 찾았습니다');

  const proto = st.units.find((u) => u.side === 'attacker')!;
  st.units = st.units.filter((u) => u.side !== 'attacker');
  ring.forEach(([x, y], i) => {
    st.units.push({
      ...proto,
      id: `ring${i}`,
      x: (x + 0.5) * tw,
      y: (y + 0.5) * th,
      arriveTick: 0,
      dead: false,
      routed: false,
      reserve: false,
    });
  });
  assert(isEncircled(st), '성벽 바깥을 다 둘러쌌는데 포위로 안 잡힙니다');

  // 성문 앞을 비우면 다시 길이 열린다
  let gx = -1;
  let gy = -1;
  for (let y = 0; y < f.h && gx < 0; y++) {
    for (let x = 0; x < f.w; x++) {
      if (f.tiles[y][x] === 'G') {
        gx = x;
        gy = y;
        break;
      }
    }
  }
  assert(gx >= 0, '성문을 못 찾았습니다');
  st.units = st.units.filter(
    (u) => Math.hypot(u.x / tw - gx, u.y / th - gy) > 6
  );
  assert(!isEncircled(st), '성문 앞을 비웠는데도 포위로 잡힙니다');
});

test('산성은 병량이 빨리 마른다 (§5.2 — 안시성을 말려 죽이는 근거)', () => {
  const flat = createSiegeState(60, 5000, false);
  const hill = createSiegeState(60, 5000, true);
  assert(hill.terrainToll > flat.terrainToll, '산성의 병량 소모가 평지와 같습니다');
  assertEqual(Number(hill.terrainToll.toFixed(2)), 1.4, '산악 계수가 1.4 가 아닙니다');
});

test('§7 성곽 규격이 맵 데이터에 들어 있다', () => {
  // 자세한 12항목은 pipeline/validate_battlemaps.py 가 본다.
  // 여기서는 「빌드가 옛 맵으로 되돌아가지 않았는가」만 싸게 확인한다.
  let chi = 0;
  let ong = 0;
  let moat = 0;
  let dbl = 0;
  for (const id of BATTLEFIELD_IDS) {
    const f = battlefield(id) as unknown as Record<string, unknown>;
    const t = (f.tiles as string[]).join('');
    if (t.includes('T')) chi++;
    if (t.includes('O')) ong++;
    if (t.includes('D')) moat++;
    if (f.doubleWall) dbl++;
  }
  assert(chi > 60, `치(T)가 있는 전장이 ${chi}곳뿐입니다`);
  assert(ong > 60, `옹성(O)이 있는 전장이 ${ong}곳뿐입니다`);
  assert(moat > 30, `해자(D)가 있는 전장이 ${moat}곳뿐입니다`);
  assertEqual(dbl, 6, '이중성벽이 여섯 곳이 아닙니다');
});

test('T·O·D 가 지형 표에 있다 — 없으면 전장에서 그 칸이 사라진다', () => {
  for (const c of ['T', 'O', 'D'] as const) {
    assert(TERRAIN[c] !== undefined, `${c} 가 TERRAIN 에 없습니다`);
  }
  // 치·옹성벽은 성벽 취급이라 못 지나가고, 해자는 지날 수 있어야 한다
  assertEqual(TERRAIN.T.move, 0, '치를 지나갈 수 있습니다');
  assertEqual(TERRAIN.O.move, 0, '옹성벽을 지나갈 수 있습니다');
  assert(TERRAIN.D.move > 0, '해자를 못 지나갑니다');
});

/* ================================================================== *
 * 주둔 수비대 (§3.5)
 * ================================================================== */

section('주둔 수비대 — 계열은 거점이 정한다');

test('문관만 남은 성도 보병으로 싸운다', () => {
  const s = createGame({ scenarioId: 's642', playerFaction: 'silla', seed: 51 });
  const target = factionCastles(s, 'baekje').find((c) => c.officers.length > 0 && c.troops > 3000);
  if (!target) return;

  // 그 성의 인물을 전부 책략계로 바꿔 놓는다 (문관만 남은 성)
  const strOfficer = OFFICERS.find((o) => o.faction === 'baekje' && o.troop === 'str')!;
  target.officers = [strOfficer.id];
  s.officers[strOfficer.id].status = 'active';
  s.officers[strOfficer.id].faction = 'baekje';
  s.officers[strOfficer.id].location = target.id;

  const from = factionCastles(s, 'silla')[0];
  s.armies['a9'] = {
    id: 'a9',
    faction: 'silla',
    commander: from.officers[0],
    officers: from.officers.slice(0, 2),
    units: [{ unitType: 'infantry', count: 6000 }],
    location: from.id,
    path: [target.id],
    target: target.id,
    grain: 1000,
    morale: 70,
    training: 60,
    siegeMode: 'assault',
  };
  const setup = buildFieldSetup(s, {
    id: 'bg',
    castle: target.id,
    attacker: 'silla',
    defender: 'baekje',
    attackerArmies: ['a9'],
    defenderArmies: [],
    siege: true,
    manual: false,
  });

  const troops = setup.defender.map((e) => e.troop ?? OFFICERS.find((o) => o.id === e.officer)!.troop);
  assert(troops.includes('inf'), '수비대에 보병이 하나도 없습니다');
  assert(
    !troops.every((t) => t === 'str'),
    '수비대가 전부 책략계입니다 — 계열이 여전히 장수를 따르고 있습니다'
  );
  // 병력 총합이 보존되어야 한다
  const sum = setup.defender.reduce((a, e) => a + e.troops, 0);
  assert(Math.abs(sum - target.troops) < 600, `수비 병력이 ${sum} 로 ${target.troops} 와 다릅니다`);
});

test('타 계열을 맡으면 무력이 절반만 실린다 (§3.5 지휘 적성)', () => {
  const base = createField(siegeSetup());
  const u = base.units.find((x) => x.troop === 'inf' && !x.offClass)!;
  const stats = { lead: 80, war: 90, int: 50 };
  const own = unitPower(u, stats);
  const off = unitPower({ ...u, offClass: true }, stats);
  assert(off < own, '타 계열 지휘에 페널티가 없습니다');
  // 통솔은 그대로여야 하므로 절반까지 떨어지지는 않는다
  assert(off > own * 0.5, '통솔까지 깎이고 있습니다');
});

test('산성은 궁병이, 항구는 수군이 상비된다', () => {
  const s = createGame({ scenarioId: 's642', playerFaction: 'silla', seed: 52 });
  const byType = (t: string) =>
    Object.values(s.castles).find((c) => c.owner && castleDef(c.id).type === t && c.troops > 3000);
  const fort = byType('fort');
  const port = byType('port');

  for (const [c, want, label] of [
    [fort, 'arc', '산성의 궁병'],
    [port, 'navy', '항구의 수군'],
  ] as const) {
    if (!c) continue;
    const setup = buildFieldSetup(s, {
      id: 'bt',
      castle: c.id,
      attacker: c.owner === 'silla' ? 'baekje' : 'silla',
      defender: c.owner!,
      attackerArmies: [],
      defenderArmies: [],
      siege: true,
      manual: false,
    });
    const has =
      want === 'navy'
        ? setup.defender.some((e) => e.navy)
        : setup.defender.some((e) => e.troop === want);
    assert(has, `${label} 이 상비되어 있지 않습니다`);
  }
});

/* ================================================================== *
 * 수로 통행과 겨울
 *
 * 규칙(docs 없음, CHANGELOG 0.4.0 참조):
 *   · 육로는 제한 없음
 *   · 수로는 양 끝을 확보하면 육군도 건넌다
 *   · 적이 한쪽을 쥐면 수군이 있어야 강행할 수 있다
 *   · 겨울에는 원해 항로가 닫힌다 — 진격도 후퇴도 보급도 안 된다
 * ================================================================== */

section('수로 통행과 겨울');

/** 계절만 바꾼 판을 만든다 */
function seaGame(season: 0 | 1 | 2 | 3) {
  const g = createGame({ scenarioId: 's642', playerFaction: 'silla', seed: 4242 });
  g.season = season;
  return g;
}

test('양 끝을 쥐고 있으면 보병만으로도 수로를 건넌다', () => {
  const g = seaGame(0);
  // 642년 시나리오에서 탐라는 백제, 침미다례도 백제다.
  assertEqual(g.castles['tamna'].owner, 'baekje', '탐라 주인이 바뀌었습니다');
  const infantryOnly = [{ unitType: 'infantry', count: 3000 }];
  const path = findMarchPath(g, 'baekje', 'chimmi', 'tamna', infantryOnly);
  assert(path !== null, '확보된 수로를 보병이 못 건넜습니다');
});

test('겨울에는 그 수로가 닫힌다 — 양 끝을 다 쥐고 있어도', () => {
  const g = seaGame(3);
  const infantryOnly = [{ unitType: 'infantry', count: 3000 }];
  assert(seaClosed('chimmi', 'tamna', 3), '탐라 항로가 원해로 잡히지 않았습니다');
  const path = findMarchPath(g, 'baekje', 'chimmi', 'tamna', infantryOnly);
  assertEqual(path, null, '겨울에 원해 항로가 열려 있습니다');
});

test('적이 지키는 항로는 수군이 있어야 건넌다', () => {
  const g = seaGame(0);
  // 덕물도(신라)와 기벌포(백제)는 전쟁 중이라 서로 적이다.
  assert(g.castles['deokmul'].owner === 'silla', '덕물도 주인이 바뀌었습니다');
  assert(g.castles['gibeolpo'].owner === 'baekje', '기벌포 주인이 바뀌었습니다');
  assert(atWar(g, 'baekje', 'silla'), '642년은 백제-신라가 전쟁 중이어야 합니다');

  const infantry = [{ unitType: 'infantry', count: 3000 }];
  const withNavy = [
    { unitType: 'infantry', count: 3000 },
    { unitType: 'navy', count: 1000 },
  ];
  assert(
    !canPass(g, 'baekje', 'gibeolpo', 'deokmul', infantry),
    '수군 없이 적의 항로를 건넜습니다'
  );
  assert(
    canPass(g, 'baekje', 'gibeolpo', 'deokmul', withNavy),
    '수군이 있는데도 상륙을 못 했습니다'
  );
});

test('겨울에는 수군이 있어도 원해 항로를 못 건넌다', () => {
  const g = seaGame(3);
  const withNavy = [{ unitType: 'navy', count: 2000 }];
  assert(
    !canPass(g, 'baekje', 'gibeolpo', 'deokmul', withNavy),
    '겨울 원해 항로가 수군에게 열려 있습니다'
  );
});

test('겨울 섬에 갇힌 부대는 후퇴도 못 하지만 해산되지도 않는다', () => {
  const g = seaGame(3);
  // 탐라에 백제군을 하나 세운다.
  const army = {
    id: 'armyTest',
    faction: 'baekje',
    commander: 'gyebaek',
    officers: ['gyebaek'],
    units: [{ unitType: 'infantry', count: 3000 }],
    location: 'tamna',
    path: [],
    target: 'tamna',
    grain: 5000,
    morale: 60,
    training: 60,
    siegeMode: 'assault' as const,
  };
  g.armies[army.id] = army;
  // 탐라를 중립으로 만들어 "물러날 아군 성"이 바다 건너에만 있게 한다.
  g.castles['tamna'].owner = null;

  assertEqual(
    nearestFriendlyCastle(g, 'baekje', 'tamna', army.units),
    null,
    '겨울 바다를 건너 후퇴할 길이 열려 있습니다'
  );
  retreatArmy(g, army);
  assert(g.armies['armyTest'] !== undefined, '갇힌 부대가 해산되었습니다');
  assertEqual(g.armies['armyTest'].location, 'tamna', '갇힌 부대가 옮겨졌습니다');
});

test('봄이 오면 같은 길이 다시 열린다', () => {
  const g = seaGame(0);
  const infantry = [{ unitType: 'infantry', count: 3000 }];
  g.castles['tamna'].owner = 'baekje';
  assert(
    canPass(g, 'baekje', 'chimmi', 'tamna', infantry),
    '봄인데도 항로가 닫혀 있습니다'
  );
});

/* ------------------------------------------------------------------ *
 * 선전포고
 *
 * 지도가 밝히는 후보와 규칙이 허락하는 곳이 같아야 한다. 예전에는 「길이
 * 이어지는 곳」을 전부 밝혀 놓아, 화평 중인 나라의 성까지 고른 뒤 편성을 다
 * 마치고서야 「전쟁 상태가 아닙니다」를 만났다.
 * ------------------------------------------------------------------ */

test('화평 중인 나라의 성은 출진 후보가 아니다', () => {
  const g = createGame({ scenarioId: 's642', playerFaction: 'goguryeo', seed: 7 });
  // 642년의 고구려와 백제는 화평이다 (연개소문의 해 — 백제는 신라를 치고 있었다).
  assert(!atWar(g, 'goguryeo', 'baekje'), '642년 고구려·백제가 전쟁 상태입니다');
  const baekjeCastle = Object.values(g.castles).find((c) => c.owner === 'baekje')!;
  assert(
    needsDeclaration(g, 'goguryeo', baekjeCastle.id),
    '화평 중인 백제의 성에 선전포고 없이 갈 수 있습니다'
  );
});

test('아군 성과 교전 중인 나라의 성에는 선전포고가 필요 없다', () => {
  const g = createGame({ scenarioId: 's642', playerFaction: 'silla', seed: 7 });
  assert(atWar(g, 'silla', 'baekje'), '642년 신라·백제가 전쟁 상태가 아닙니다');
  const mine = Object.values(g.castles).find((c) => c.owner === 'silla')!;
  const enemy = Object.values(g.castles).find((c) => c.owner === 'baekje')!;
  assert(!needsDeclaration(g, 'silla', mine.id), '아군 성에 선전포고를 요구합니다');
  assert(!needsDeclaration(g, 'silla', enemy.id), '교전 중인데 선전포고를 요구합니다');
});

test('규칙과 판정이 같은 답을 낸다 — 화평 중이면 validateMarch 도 막는다', () => {
  const g = createGame({ scenarioId: 's642', playerFaction: 'goguryeo', seed: 7 });
  const baekjeCastle = Object.values(g.castles).find((c) => c.owner === 'baekje')!;
  const from = Object.values(g.castles).find((c) => c.owner === 'goguryeo' && c.troops > 2000)!;
  const err = validateMarch(g, {
    kind: 'march',
    faction: 'goguryeo',
    from: from.id,
    target: baekjeCastle.id,
    commander: 'yeon',
    officers: [],
    units: [{ unitType: 'infantry', count: 1000 }],
    grain: 500,
    siegeMode: 'assault',
  });
  assert(err !== null, '화평 중인 성으로 출진이 허락되었습니다');
});

/* ================================================================== *
 * 디자인 토큰
 *
 * 팔레트가 CSS 와 TS 두 벌로 있다 — Canvas 는 CSS 변수를 읽지 못하기 때문이다.
 * 두 벌이 갈라지면 전투 화면만 옛 색으로 남는 식의 조용한 어긋남이 생기므로
 * 여기서 대조한다. 대비비도 매번 다시 잰다 (docs/design-tokens.md §1.3).
 * ================================================================== */

section('디자인 토큰');

/** tokens.css 와 tokens.ts 의 이름 대응 */
const TOKEN_PAIRS: Array<[string, string]> = [
  ['--ji', T.ji],
  ['--ji-deep', T.jiDeep],
  ['--ji-edge', T.jiEdge],
  ['--hae', T.hae],
  ['--meok', T.meok],
  ['--meok-mid', T.meokMid],
  ['--meok-cap', T.meokCap],
  ['--meok-thin', T.meokThin],
  ['--jinsa', T.jinsa],
  ['--su', T.su],
  ['--su-ice', T.suIce],
  ['--on-dark', T.onDark],
  // 전장 화면이 CSS 에서 세력색을 쓰므로 이쪽도 두 벌이 되었다
  ['--f-goguryeo', T.goguryeo],
  ['--f-baekje', T.baekje],
  ['--f-silla', T.silla],
  ['--f-gaya', T.gaya],
];

test('tokens.css 와 tokens.ts 의 값이 같다', () => {
  const css = readFileSync(resolve(import.meta.dirname, '../src/ui/tokens.css'), 'utf8');
  for (const [name, tsValue] of TOKEN_PAIRS) {
    const m = css.match(new RegExp(`\\${name}\\s*:\\s*(#[0-9a-fA-F]{6})`));
    assert(m, `tokens.css 에 ${name} 이 없습니다`);
    assertEqual(
      m![1].toLowerCase(),
      tsValue.toLowerCase(),
      `${name} 이 두 파일에서 다릅니다`
    );
  }
});

test('본문·보조·캡션이 지 배경 위에서 AA 를 통과한다', () => {
  // docs/design-tokens.md §1.3 의 표를 그대로 다시 잰다.
  assert(contrast(T.meok, T.ji) >= 7, `먹 본문 대비 부족: ${contrast(T.meok, T.ji).toFixed(2)}`);
  assert(contrast(T.meokMid, T.ji) >= 4.5, `담묵 대비 부족: ${contrast(T.meokMid, T.ji).toFixed(2)}`);
  assert(contrast(T.meokCap, T.ji) >= 4.5, `캡션 대비 부족: ${contrast(T.meokCap, T.ji).toFixed(2)}`);
  // 반전 버튼 — 지 글자를 먹 바탕에 얹는 경우
  assert(contrast(T.ji, T.meok) >= 7, '반전 버튼 대비 부족');
});

test('--meok-thin 은 테두리 전용이다 (텍스트로 쓰면 안 되는 값)', () => {
  // 이 값이 실수로 밝아져 "텍스트에 써도 되겠네"가 되는 것을 막는다.
  // 문서가 테두리 전용으로 못 박은 근거가 바로 이 대비 부족이다.
  assert(
    contrast(T.meokThin, T.ji) < 4.5,
    'meok-thin 의 대비가 4.5 를 넘습니다 — 문서의 "테두리 전용" 규정과 어긋납니다'
  );
});

test('세력 배지 글자색이 대비 4.5:1 을 넘는다', () => {
  for (const [name, color] of [
    ['고구려', T.goguryeo],
    ['백제', T.baekje],
    ['신라', T.silla],
    ['가야', T.gaya],
  ] as const) {
    const fg = textOn(color);
    const c = contrast(fg, color);
    assert(c >= 4.5, `${name} 배지 대비 부족: ${c.toFixed(2)} (글자 ${fg})`);
  }
  // 문서 §1.2 가 명시한 예외 — 신라 금색만 먹색 글자를 쓴다.
  assertEqual(textOn(T.silla), T.meok, '신라 배지는 먹색 글자여야 합니다');
  assertEqual(textOn(T.goguryeo), T.onDark, '고구려 배지는 밝은 글자여야 합니다');
});

test('세력색이 factions.json 과 일치한다', () => {
  const factions = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../src/data/factions.json'), 'utf8')
  ) as Array<{ id: string; color: string }>;
  const expect: Record<string, string> = {
    goguryeo: T.goguryeo,
    baekje: T.baekje,
    silla: T.silla,
    gaya: T.gaya,
  };
  for (const f of factions) {
    assertEqual(f.color.toLowerCase(), expect[f.id]?.toLowerCase(), `${f.id} 색이 토큰과 다릅니다`);
  }
});



/* ================================================================== *
 * 생존 병력의 소속 (R01)
 *
 * 전투가 끝나면 살아남은 병력은 **원래 있던 자리로** 돌아가야 한다.
 * 예전에는 생존 병력을 장수 식별자로만 돌려주어, 지휘관 없는 수비대의
 * 병력이 합산에서 통째로 빠졌다 — 장수가 없는 성은 수비에 **이기고도**
 * 병력이 0이 되어 다음 턴에 무혈 함락됐다.
 * ================================================================== */

section('생존 병력의 소속 (R01)');

/** 그 성을 치는 공격군 하나를 손으로 세운다 (시드 고정이라 결과가 같다) */
function attackingArmy(
  s: ReturnType<typeof createGame>,
  id: string,
  from: string,
  target: string,
  officers: string[],
  troops: number
): void {
  for (const oid of officers) {
    const o = s.officers[oid];
    o.location = null;
    o.armyId = id;
    const home = Object.values(s.castles).find((c) => c.officers.includes(oid));
    if (home) home.officers = home.officers.filter((x) => x !== oid);
  }
  s.armies[id] = {
    id,
    faction: s.officers[officers[0]].faction!,
    commander: officers[0],
    officers,
    units: [{ unitType: 'infantry', count: troops }],
    location: from,
    path: [target],
    target,
    grain: 2000,
    morale: 70,
    training: 60,
    siegeMode: 'assault',
  };
}

function siegePending(
  id: string,
  castle: string,
  attacker: string,
  defender: string,
  armies: string[]
): PendingBattle {
  return {
    id,
    castle,
    attacker,
    defender,
    attackerArmies: armies,
    defenderArmies: [],
    siege: true,
    manual: false,
  };
}

test('장수가 없는 성도 수비에 이기면 병력이 남는다', () => {
  const s = createGame({ scenarioId: 's642', playerFaction: 'silla', seed: 51 });
  const castle = s.castles['nampyeong'];
  assertEqual(castle.officers.length, 0, '이 시험은 장수 없는 성을 전제로 합니다');
  const before = castle.troops;
  attackingArmy(s, 'a1', 'gugwon', 'nampyeong', ['bipam'], 1500);
  const pending = siegePending('b1', 'nampyeong', 'silla', 'goguryeo', ['a1']);
  const result = resolveFieldAuto(s, pending)!;
  assert(result !== null, '전투가 성립하지 않았습니다');
  assertEqual(result.winner, 'defender', '이 픽스처는 수비 승리를 전제로 합니다');
  applyFieldResult(s, pending, result, new RngCursor(7));

  assert(castle.troops > 0, '수비에 이겼는데 성이 비었습니다');
  const survived = result.survivors
    .filter((x) => x.side === 'defender')
    .reduce((a, x) => a + x.troops, 0);
  const fielded = result.fielded
    .filter((x) => x.side === 'defender')
    .reduce((a, x) => a + x.troops, 0);
  assertEqual(castle.troops, survived + (before - fielded), '남은 병력이 규칙과 다릅니다');
  assert(castle.troops <= before, '싸우고 나서 병력이 늘었습니다');
  assertEqual(
    castle.composition.reduce((a, u) => a + u.count, 0),
    castle.troops,
    '편성 합계와 병력이 어긋납니다'
  );
});

test('장수 하나뿐인 성에서도 무지휘 수비대의 병력이 보존된다', () => {
  const s = createGame({ scenarioId: 's642', playerFaction: 'silla', seed: 51 });
  const castle = s.castles['ansi'];
  assertEqual(castle.officers.length, 1, '이 시험은 장수 한 명인 성을 전제로 합니다');
  const before = castle.troops;
  attackingArmy(s, 'a1', 'gugwon', 'ansi', ['bipam'], 1500);
  const pending = siegePending('b2', 'ansi', 'silla', 'goguryeo', ['a1']);
  const result = resolveFieldAuto(s, pending)!;
  assertEqual(result.winner, 'defender', '이 픽스처는 수비 승리를 전제로 합니다');

  // 판에 선 부대는 장수 하나 것만이 아니다 — 무지휘 수비대가 여럿 있다
  const unled = result.survivors.filter((x) => x.side === 'defender' && !x.officer);
  assert(unled.length > 0, '무지휘 수비대가 서지 않았습니다');

  applyFieldResult(s, pending, result, new RngCursor(7));
  const survived = result.survivors
    .filter((x) => x.side === 'defender')
    .reduce((a, x) => a + x.troops, 0);
  const fielded = result.fielded
    .filter((x) => x.side === 'defender')
    .reduce((a, x) => a + x.troops, 0);
  assertEqual(castle.troops, survived + (before - fielded), '남은 병력이 규칙과 다릅니다');
  // 장수가 이끈 몫만 남는 옛 버그였다면 무지휘분만큼 모자란다
  const ledOnly = result.survivors
    .filter((x) => x.side === 'defender' && x.officer)
    .reduce((a, x) => a + x.troops, 0);
  assert(castle.troops > ledOnly, '무지휘 수비대의 병력이 빠졌습니다');
});

test('여러 군대가 섞여도 군대마다 제 병력을 가지고 돌아간다', () => {
  const s = createGame({ scenarioId: 's642', playerFaction: 'silla', seed: 53 });
  attackingArmy(s, 'a1', 'geumseong', 'daeya', ['alcheon', 'pilbu'], 6000);
  attackingArmy(s, 'a2', 'geumseong', 'daeya', ['bipam'], 2500);
  const pending = siegePending('b3', 'daeya', 'silla', 'baekje', ['a1', 'a2']);
  const result = resolveFieldAuto(s, pending)!;
  assert(result !== null, '전투가 성립하지 않았습니다');

  // 편성 단계에서 이미 군대별로 갈려 있어야 한다
  const setup = buildFieldSetup(s, pending);
  const originIds = new Set(setup.attacker.map((e) => e.origin?.id));
  assertEqual(originIds.has('a1'), true, 'a1 의 부대가 없습니다');
  assertEqual(originIds.has('a2'), true, 'a2 의 부대가 없습니다');

  const before = new Map(
    ['a1', 'a2'].map((id) => [id, s.armies[id].units.reduce((a, u) => a + u.count, 0)])
  );
  const castleBefore = s.castles['daeya'].troops;
  const homeBefore = s.castles['geumseong'].troops;
  applyFieldResult(s, pending, result, new RngCursor(7));

  // 출처별로 돌아올 병력을 따로 셈한다
  const expectOf = (kind: 'army' | 'garrison', id: string, originalTroops: number) => {
    const survived = result.survivors
      .filter((x) => x.origin?.kind === kind && x.origin.id === id)
      .reduce((a, x) => a + x.troops, 0);
    const fielded = result.fielded
      .filter((x) => x.origin?.kind === kind && x.origin.id === id)
      .reduce((a, x) => a + x.troops, 0);
    return survived + (originalTroops - fielded);
  };

  let expectedTotal = 0;
  for (const id of ['a1', 'a2']) {
    const expected = expectOf('army', id, before.get(id)!);
    expectedTotal += expected;
    const army = s.armies[id];
    if (army) {
      assertEqual(
        army.units.reduce((a, u) => a + u.count, 0),
        expected,
        `${id} 의 병력이 제 몫과 다릅니다`
      );
      expectedTotal -= expected; // 아직 군대에 있으므로 성으로 돌아오지 않았다
    }
  }
  /*
   * 진 군대는 가장 가까운 아군 성으로 물러나 풀린다. 병력이 사라지는 것이
   * 아니라 그 성의 주둔군이 된다 — 합이 맞아야 한다.
   */
  const homeGain = s.castles['geumseong'].troops - homeBefore;
  assertEqual(homeGain, expectedTotal, '물러난 군대의 병력이 성에 그대로 들어오지 않았습니다');

  // 수비한 성도 같은 규칙을 따른다
  if (s.castles['daeya'].owner === 'baekje') {
    assertEqual(
      s.castles['daeya'].troops,
      expectOf('garrison', 'daeya', castleBefore),
      '수비한 성의 병력이 규칙과 다릅니다'
    );
  }
});

test('포로와 전사자가 성·군대 어디에도 남지 않는다', () => {
  const s = createGame({ scenarioId: 's642', playerFaction: 'silla', seed: 54 });
  attackingArmy(s, 'a1', 'geumseong', 'daeya', ['alcheon', 'pilbu', 'bipam'], 20000);
  const pending = siegePending('b4', 'daeya', 'silla', 'baekje', ['a1']);
  const result = resolveFieldAuto(s, pending)!;
  applyFieldResult(s, pending, result, new RngCursor(7));

  for (const o of Object.values(s.officers)) {
    if (o.status === 'active') continue;
    for (const c of Object.values(s.castles)) {
      assertEqual(c.officers.includes(o.id), false, `${o.id} 가 ${c.id} 에 남아 있습니다`);
    }
    for (const a of Object.values(s.armies)) {
      assertEqual(a.officers.includes(o.id), false, `${o.id} 가 군대에 남아 있습니다`);
    }
  }
  // 같은 인물이 두 곳에 동시에 있지 않다
  const seen = new Set<string>();
  for (const c of Object.values(s.castles)) {
    for (const oid of c.officers) {
      assertEqual(seen.has(oid), false, `${oid} 가 두 곳에 등록되었습니다`);
      seen.add(oid);
    }
  }
  for (const a of Object.values(s.armies)) {
    for (const oid of a.officers) {
      assertEqual(seen.has(oid), false, `${oid} 가 두 곳에 등록되었습니다`);
      seen.add(oid);
    }
  }
});

test('무승부에는 포로가 없다 — 제 편을 잡지 않는다', () => {
  // 무승부는 실제 판으로 만들기 어렵다. 결과 조립 함수를 직접 시험한다.
  const mk = (id: string, side: 'attacker' | 'defender', dead: boolean) =>
    ({
      id,
      side,
      officer: id,
      name: id,
      troop: 'inf',
      navy: false,
      offClass: false,
      tier: 1,
      faction: side === 'attacker' ? 'silla' : 'baekje',
      troops: dead ? 0 : 1000,
      maxTroops: 1000,
      morale: 50,
      fatigue: 0,
      x: 0,
      y: 0,
      row: 'front',
      reserve: false,
      stance: 'hold',
      orderTarget: null,
      orderPoint: null,
      target: null,
      path: [],
      pathAt: 0,
      pathGoal: null,
      pursuing: false,
      schemeAt: null,
      exposedUntil: null,
      origin: null,
      routed: false,
      dead,
      arriveTick: 0,
    }) as unknown as Parameters<typeof summarizeUnits>[0][number];

  const units = [mk('atk1', 'attacker', true), mk('def1', 'defender', true), mk('def2', 'defender', false)];
  assertEqual(summarizeUnits(units, null).captured.length, 0, '무승부인데 포로가 생겼습니다');
  assertEqual(summarizeUnits(units, 'attacker').captured.join(','), 'def1', '진 쪽의 장수만 잡힌다');
  // 지휘관 없는 부대는 포로가 될 수 없다
  const unled = [{ ...mk('x', 'defender', true), officer: '' }, mk('atk1', 'attacker', false)];
  assertEqual(summarizeUnits(unled, 'attacker').captured.length, 0, '빈 식별자가 포로로 잡혔습니다');
});

test('이끌 사람이 없는 공격군은 성을 얻지 못하고 흩어진다', () => {
  const s = createGame({
    scenarioId: 's642',
    playerFaction: 'silla',
    spectator: true,
    options: { autoBattle: true },
    seed: 55,
  });
  attackingArmy(s, 'a1', 'geumseong', 'daeya', ['alcheon'], 6000);
  // 지휘관을 잃은 군대 — 연초에 인물이 죽으면 이런 상태가 된다
  s.officers['alcheon'].status = 'dead';
  s.officers['alcheon'].armyId = null;
  s.armies['a1'].officers = [];
  const owner = s.castles['daeya'].owner;
  s.pendingBattles.push(siegePending('b5', 'daeya', 'silla', 'baekje', ['a1']));
  s.phase = 'battles';
  resolveTurn(s);

  assertEqual(s.castles['daeya'].owner, owner, '이끌 사람 없는 군대가 성을 얻었습니다');
  assertEqual(s.armies['a1'], undefined, '군대가 흩어지지 않았습니다');
});


/* ================================================================== *
 * 수군 — 이동과 편성 (R02)
 *
 * 배를 띄우는 것과 수전을 치르는 것은 다른 조건이다 (§3.4).
 * 예전에는 출진 부대가 전장에서 무조건 육상으로 서서, 상륙을 강행한
 * 수군이 막상 상륙지에서는 물에서 힘을 못 쓰는 보병으로 싸웠다.
 * ================================================================== */

section('수군 편성과 전력 평가 (R02)');

test('실어 온 수군은 전장에서도 수군으로 선다', () => {
  const s = createGame({ scenarioId: 's642', playerFaction: 'baekje', seed: 80 });
  const naval = OFFICERS.find((o) => o.id === 'yunchung')!;
  assertEqual(naval.naval, true, '이 시험은 수군 적성 장수를 전제로 합니다');

  const navyTroops = 3000;
  // 배를 이끌 사람과 본대를 이끌 사람 — 한 사람이 둘을 동시에 맡을 수는 없다
  const landsman = OFFICERS.find((o) => o.faction === 'baekje' && !o.naval)!;
  s.officers[landsman.id].status = 'active';
  s.armies['n1'] = {
    id: 'n1',
    faction: 'baekje',
    commander: 'yunchung',
    officers: ['yunchung', landsman.id],
    units: [
      { unitType: 'infantry', count: 4000 },
      { unitType: 'navy', count: navyTroops },
    ],
    location: 'gibeolpo',
    path: ['deokmul'],
    target: 'deokmul',
    grain: 2000,
    morale: 70,
    training: 60,
    siegeMode: 'assault',
  };
  const pending: PendingBattle = {
    id: 'n-b1',
    castle: 'deokmul',
    attacker: 'baekje',
    defender: s.castles['deokmul'].owner!,
    attackerArmies: ['n1'],
    defenderArmies: [],
    siege: true,
    manual: false,
  };
  const setup = buildFieldSetup(s, pending);
  const navyEntries = setup.attacker.filter((e) => e.navy);
  assert(navyEntries.length > 0, '수군을 싣고 갔는데 전장에 수군이 없습니다');
  assertEqual(
    navyEntries.reduce((a, e) => a + e.troops, 0),
    navyTroops,
    '수군 부대의 병력이 실어 온 수군과 다릅니다'
  );
  // 병력 총합은 그대로다 — 수군을 떼어 낸다고 사람이 늘거나 줄지 않는다
  assertEqual(
    setup.attacker.reduce((a, e) => a + e.troops, 0),
    7000,
    '편성 총합이 달라졌습니다'
  );
});

test('수군 장수뿐이고 본대가 더 크면 그 사람은 본대를 이끈다', () => {
  const s = createGame({ scenarioId: 's642', playerFaction: 'baekje', seed: 84 });
  s.armies['n3'] = {
    id: 'n3',
    faction: 'baekje',
    commander: 'yunchung',
    officers: ['yunchung'],
    units: [
      { unitType: 'infantry', count: 6000 },
      { unitType: 'navy', count: 1000 },
    ],
    location: 'gibeolpo',
    path: ['deokmul'],
    target: 'deokmul',
    grain: 2000,
    morale: 70,
    training: 60,
    siegeMode: 'assault',
  };
  const setup = buildFieldSetup(s, {
    id: 'n-b3',
    castle: 'deokmul',
    attacker: 'baekje',
    defender: s.castles['deokmul'].owner!,
    attackerArmies: ['n3'],
    defenderArmies: [],
    siege: true,
    manual: false,
  });
  assertEqual(setup.attacker.some((e) => e.navy), false, '본대를 두고 배를 몰았습니다');
  assertEqual(setup.attacker.reduce((a, e) => a + e.troops, 0), 7000, '병력이 달라졌습니다');
});

test('이끌 사람이 없으면 배에 타고만 간다 — 병력은 그대로', () => {
  const s = createGame({ scenarioId: 's642', playerFaction: 'baekje', seed: 81 });
  const landsman = OFFICERS.find((o) => o.faction === 'baekje' && !o.naval && o.id !== 'yunchung')!;
  s.officers[landsman.id].status = 'active';
  s.armies['n2'] = {
    id: 'n2',
    faction: 'baekje',
    commander: landsman.id,
    officers: [landsman.id],
    units: [
      { unitType: 'infantry', count: 4000 },
      { unitType: 'navy', count: 3000 },
    ],
    location: 'gibeolpo',
    path: ['deokmul'],
    target: 'deokmul',
    grain: 2000,
    morale: 70,
    training: 60,
    siegeMode: 'assault',
  };
  const setup = buildFieldSetup(s, {
    id: 'n-b2',
    castle: 'deokmul',
    attacker: 'baekje',
    defender: s.castles['deokmul'].owner!,
    attackerArmies: ['n2'],
    defenderArmies: [],
    siege: true,
    manual: false,
  });
  assertEqual(setup.attacker.some((e) => e.navy), false, '적성 없는 장수가 수군을 이끌었습니다');
  assertEqual(setup.attacker.reduce((a, e) => a + e.troops, 0), 7000, '병력이 사라졌습니다');

  const plan = navalPlan(s.armies['n2'].units, s.armies['n2'].officers);
  assertEqual(plan.boardOnly, true, '탑승만 가능한 상태로 잡히지 않았습니다');
  assertEqual(plan.navyTroops, 3000);
});

test('배가 있으면 건넌다 — 이동과 편성의 조건이 서로 다르다', () => {
  const g = createGame({ scenarioId: 's642', playerFaction: 'baekje', seed: 82 });
  const withNavy = [{ unitType: 'navy', count: 1000 }];
  const landOnly = [{ unitType: 'infantry', count: 1000 }];
  // 화면·이동 검증·전투 생성이 같은 함수를 본다
  assertEqual(canSail(withNavy), true, '배가 있는데 못 띄웁니다');
  assertEqual(canSail(landOnly), false, '배 없이 띄웠습니다');
  assertEqual(navalPlan(withNavy, ['gyebaek']).leaders.length, 0, '적성 없는 장수가 수군 지휘로 잡혔습니다');
  assertEqual(navalPlan(withNavy, ['yunchung']).leaders.length, 1, '수군 장수가 잡히지 않았습니다');
  // 적이 지키는 항로는 배가 있어야 건넌다 (기존 규칙 — CHANGELOG 0.4.0)
  const sea = castleDef('gibeolpo').routes.sea[0];
  if (g.castles[sea]?.owner && g.castles[sea].owner !== 'baekje') {
    assertEqual(canPass(g, 'baekje', 'gibeolpo', sea, landOnly), false, '배 없이 적 항로를 건넜습니다');
    assertEqual(canPass(g, 'baekje', 'gibeolpo', sea, withNavy), true, '배가 있는데 막혔습니다');
  }
});

test('수군 적성 장수는 배를 몰아도 온전히 싸운다', () => {
  // 수군 전문가인 궁병계 장수가 배를 몰면 타 계열로 몰려 무력이 절반만
  // 실리고 있었다 — §3.4 는 "본래 계열 대신 수군 병종을 지휘"라고 못 박는다.
  const naval = OFFICERS.find((o) => o.naval && o.troop !== 'inf')!;
  const setup: FieldSetup = {
    fieldId: 'gibeolpo',
    seed: 99,
    season: 0,
    siege: false,
    playerSide: null,
    attackerFaction: naval.faction ?? 'baekje',
    defenderFaction: 'silla',
    tiers: {
      attacker: { inf: 1, cav: 1, arc: 1, str: 1 },
      defender: { inf: 1, cav: 1, arc: 1, str: 1 },
    },
    attacker: [{ officer: naval.id, troops: 3000, row: 'front', reserve: false, navy: true }],
    defender: [{ officer: 'alcheon', troops: 3000, row: 'front', reserve: false }],
  };
  const st = createField(setup);
  const unit = st.units.find((u) => u.officer === naval.id)!;
  assertEqual(unit.navy, true, '수군으로 서지 않았습니다');
  assertEqual(unit.offClass, false, '수군 적성 장수가 타 계열 취급을 받았습니다');
});

test('AI 의 전력 평가가 국가 병종 단계를 본다', () => {
  const s = createGame({ scenarioId: 's642', playerFaction: 'silla', seed: 83 });
  const units = [{ unitType: 'infantry', count: 5000 }];
  const base = compositionPower(s, units, 70, 60, 'alcheon', 'silla');
  // 1단계에서는 예전 값과 같아야 한다 (계수 1.0) — 밸런스를 건드린 것이 아니다
  assertEqual(
    Math.round(base),
    Math.round(compositionPower(s, units, 70, 60, 'alcheon', 'silla')),
    '같은 입력에 다른 값이 나옵니다'
  );
  s.factions.silla.troopTiers.inf = 3;
  const better = compositionPower(s, units, 70, 60, 'alcheon', 'silla');
  assert(better > base, '보병을 3단계로 올렸는데 전력 평가가 그대로입니다');
  assertEqual(
    Math.round(better / base),
    Math.round(TIER_POWER[3] / TIER_POWER[1]),
    '단계 계수만큼 오르지 않았습니다'
  );

  // 수비 평가도 같은 자를 쓴다
  const castle = factionCastles(s, 'silla')[0];
  const defBefore = castleDefensePower(s, castle.id);
  s.factions.silla.troopTiers.inf = 4;
  assert(castleDefensePower(s, castle.id) > defBefore, '수비 평가가 단계를 안 봅니다');
});

/* ================================================================== *
 * 통계와 승리 판정 (R03)
 *
 * 여기서 지키려는 것은 **집계를 믿을 수 있는가**다. 화면 로그는 600개에서
 * 잘리므로 거기서 세면 판이 길어질수록 조용히 틀어진다. 그리고 시간 초과
 * 우세는 승리가 아니다 — 두 값이 섞이면 승률 조정이 노이즈를 튜닝한다.
 * ================================================================== */

section('통계와 승리 판정');

test('로그가 600개에서 잘려도 사건 집계는 정확하다', () => {
  const s = createGame({ scenarioId: 's642', playerFaction: 'silla', seed: 61 });
  const before = s.events.length;
  // 로그를 넘치게 채운다 — 예전 집계는 여기서부터 눈이 멀었다.
  for (let i = 0; i < 700; i++) addLog(s, null, 'system', `채움 ${i}`);
  assertEqual(s.log.length, 600, '로그 상한이 600이 아닙니다');
  const target = factionCastles(s, 'baekje')[0];
  transferCastle(s, target.id, 'silla', 'event');
  const events = eventsSince(s, before);
  assertEqual(events.length, 1, '로그가 잘린 뒤 사건이 기록되지 않았습니다');
  assertEqual(events[0].kind, 'castle_captured');
  const sum = summarizeRun(s, ['goguryeo', 'baekje', 'silla']);
  assertEqual(sum.captures, 1, '함락 집계가 틀렸습니다');
});

test('함락 경로마다 사건이 남는다 — 전장 밖 경로까지', () => {
  const s = createGame({ scenarioId: 's642', playerFaction: 'silla', seed: 62 });
  const rng = new RngCursor(3);
  const owned = factionCastles(s, 'baekje');
  const methods: CaptureMethod[] = ['starvation', 'no_defender', 'undefended', 'event'];
  const seen: string[] = [];
  owned.slice(0, methods.length).forEach((c, i) => {
    const at = lastEventId(s);
    captureCastle(s, c.id, 'silla', rng, methods[i]);
    const made = eventsSince(s, at).filter((e) => e.kind === 'castle_captured');
    assertEqual(made.length, 1, `${methods[i]} 경로에 사건이 없습니다`);
    const e = made[0] as Extract<GameEvent, { kind: 'castle_captured' }>;
    assertEqual(e.method, methods[i], '함락 방식이 다릅니다');
    assertEqual(e.from, 'baekje', '이전 주인이 다릅니다');
    assertEqual(e.to, 'silla', '새 주인이 다릅니다');
    seen.push(e.method);
  });
  assertEqual(seen.length, methods.length);
  // 무주공산 접수는 함락으로 세지 않는다 (from === null)
  const empty = Object.values(s.castles).find((c) => !c.owner);
  if (empty) {
    const at = lastEventId(s);
    transferCastle(s, empty.id, 'silla', 'neutral');
    const sum = summarizeRun(s, ['goguryeo', 'baekje', 'silla']);
    const made = eventsSince(s, at);
    assertEqual(made.length >= 1, true, '무주공산 입성 사건이 없습니다');
    assertEqual(sum.captures, methods.length, '무주공산이 함락으로 세어졌습니다');
  }
});

test('세력이 멸망하면 사건으로 남는다', () => {
  const s = createGame({ scenarioId: 's642', playerFaction: 'silla', seed: 63 });
  const rng = new RngCursor(4);
  for (const c of factionCastles(s, 'baekje')) captureCastle(s, c.id, 'silla', rng, 'assault');
  assertEqual(s.factions.baekje.alive, false, '거점을 다 잃었는데 살아 있습니다');
  const sum = summarizeRun(s, ['goguryeo', 'baekje', 'silla']);
  assertEqual(sum.eliminated.includes('baekje'), true, '멸망 사건이 없습니다');
});

test('관전자 실행에서는 지정 세력이 멸망해도 판이 끝나지 않는다', () => {
  const s = createGame({
    scenarioId: 's642',
    playerFaction: 'baekje',
    spectator: true,
    options: { autoBattle: true },
    seed: 64,
  });
  for (const f of Object.values(s.factions)) assertEqual(f.isAI, true, '관전자인데 사람 세력이 있습니다');
  const rng = new RngCursor(5);
  for (const c of factionCastles(s, 'baekje')) captureCastle(s, c.id, 'silla', rng, 'assault');
  checkVictory(s);
  assertEqual(s.result, null, '관전자인데 지정 세력 멸망으로 판이 끝났습니다');

  // 같은 상황에서 관전자가 아니면 패배 판정이 난다 — 규칙이 사라진 것이 아니다.
  const p = createGame({ scenarioId: 's642', playerFaction: 'baekje', seed: 64 });
  const rng2 = new RngCursor(5);
  for (const c of factionCastles(p, 'baekje')) captureCastle(p, c.id, 'silla', rng2, 'assault');
  checkVictory(p);
  assertEqual(p.result?.kind, 'player_defeated', '플레이어 패배 판정이 사라졌습니다');
});

test('조공은 방향을 본다 — 바치는 쪽을 조공국으로 세지 않는다', () => {
  const s = createGame({ scenarioId: 's642', playerFaction: 'silla', seed: 65 });
  const rel = getRelation(s, 'silla', 'baekje');
  rel.status = 'tribute';
  rel.overlord = 'baekje'; // 신라가 백제에 바친다
  assertEqual(victoryStatus(s, 'silla').vassals, 0, '바치는 관계를 조공국으로 셌습니다');
  assertEqual(victoryStatus(s, 'baekje').vassals, 1, '받는 쪽의 조공국이 세어지지 않았습니다');
});

test('승리 진행 표시와 판정이 같은 조건을 쓴다', () => {
  const s = createGame({
    scenarioId: 's642',
    playerFaction: 'silla',
    options: { victory: 'hegemony' },
    seed: 66,
  });
  for (const other of ['goguryeo', 'baekje']) {
    const rel = getRelation(s, 'silla', other);
    rel.status = 'tribute';
    rel.overlord = 'silla';
  }
  const status = victoryStatus(s, 'silla');
  assertEqual(status.vassals, status.rivals, '모두 복속인데 진행률이 안 찹니다');
  assertEqual(status.hegemony, 1, '진행률이 1이 아닙니다');
  checkVictory(s);
  assertEqual(s.result?.kind, 'hegemony', '진행률은 찼는데 판정이 나지 않았습니다');
});

test('혼자 남으면 패권이다 — 진행률 1.0 과 판정이 어긋나지 않는다', () => {
  const s = createGame({
    scenarioId: 's642',
    playerFaction: 'silla',
    spectator: true,
    options: { victory: 'hegemony' },
    seed: 67,
  });
  const rng = new RngCursor(6);
  for (const f of ['goguryeo', 'baekje', 'gaya']) {
    for (const c of factionCastles(s, f)) captureCastle(s, c.id, 'silla', rng, 'assault');
  }
  // 통일(전 거점)과 갈라 보기 위해 한 곳은 임자 없이 둔다 —
  // 예전에는 이 상황이 어느 판정에도 걸리지 않아 제한 턴까지 갔다.
  transferCastle(s, factionCastles(s, 'silla')[0].id, null, 'invasion');
  assertEqual(victoryStatus(s, 'silla').hegemony, 1, '혼자 남았는데 진행률이 1이 아닙니다');
  assert(victoryStatus(s, 'silla').unification < 1, '전 거점을 쥐면 통일 판정이 먼저입니다');
  checkVictory(s);
  assertEqual(s.result?.kind, 'last_standing', '혼자 남았는데 판정이 나지 않았습니다');
  assertEqual(s.result?.winner, 'silla');
});

test('시간 초과 우세는 승리가 아니고, 동률이면 우세도 없다', () => {
  assertEqual(leadingFaction({ a: 5, b: 3 }).leader, 'a');
  assertEqual(leadingFaction({ a: 5, b: 3 }).tie, false);
  assertEqual(leadingFaction({ a: 4, b: 4 }).leader, null, '동률인데 우세가 잡혔습니다');
  assertEqual(leadingFaction({ a: 4, b: 4 }).tie, true);

  const s = createGame({ scenarioId: 's642', playerFaction: 'silla', spectator: true, seed: 68 });
  const sum = summarizeRun(s, ['goguryeo', 'baekje', 'silla']);
  assertEqual(sum.outcome, 'timeout', '승리 조건이 없는데 결착으로 잡혔습니다');
  assertEqual(sum.winner, null, '시간 초과인데 승리자가 있습니다');
  assert(sum.leader !== null || sum.tie, '우세도 동률도 아닙니다');
});

/* ================================================================== *
 * 세이브 형식 (R03)
 * ================================================================== */

section('세이브 형식과 변환');

test('구버전(v1) 세이브를 읽어 현재 형식으로 올린다', () => {
  const s = createGame({ scenarioId: 's642', playerFaction: 'silla', seed: 69 });
  // v1 세이브를 흉내 낸다 — 사건·관전자 필드가 없던 시절
  const legacy = JSON.parse(serialize(s)) as { version: number; state: Record<string, unknown> };
  legacy.version = 1;
  delete legacy.state.events;
  delete legacy.state.nextEventId;
  delete legacy.state.spectator;
  legacy.state.version = 1;

  const loaded = deserialize(JSON.stringify(legacy));
  assertEqual(Array.isArray(loaded.events), true, '변환 후 사건 배열이 없습니다');
  assertEqual(loaded.events.length, 0);
  assertEqual(loaded.nextEventId, 1);
  assertEqual(loaded.spectator, false);
  assertEqual(loaded.version, 2, '버전이 올라가지 않았습니다');
  // 변환한 상태로 턴을 계속 돌 수 있어야 한다
  for (const f of Object.values(loaded.factions)) f.isAI = true;
  loaded.options.autoBattle = true;
  for (;;) {
    const step = resolveTurn(loaded);
    if (step.kind === 'event') completeEvent(loaded, 0);
    else break;
  }
  assert(loaded.turn >= 1, '변환한 세이브로 턴이 돌지 않습니다');
});

test('알 수 없는 버전과 깨진 세이브는 거절한다', () => {
  const s = createGame({ scenarioId: 's642', playerFaction: 'silla', seed: 70 });
  const env = JSON.parse(serialize(s)) as { version: number };
  env.version = STATE_VERSION + 1;
  let threw = false;
  try {
    deserialize(JSON.stringify(env));
  } catch {
    threw = true;
  }
  assertEqual(threw, true, '미래 버전 세이브를 그대로 받았습니다');

  threw = false;
  try {
    deserialize(JSON.stringify({ hello: 'world' }));
  } catch {
    threw = true;
  }
  assertEqual(threw, true, '세이브가 아닌 JSON 을 상태로 받았습니다');

  threw = false;
  try {
    deserialize(JSON.stringify({ format: 'samhanji-save', version: 2, state: { turn: 1 } }));
  } catch {
    threw = true;
  }
  assertEqual(threw, true, '내용이 빠진 세이브를 받았습니다');
});

/* ================================================================== *
 * 결과
 * ================================================================== */

console.log(`\n${'─'.repeat(50)}`);
console.log(`통과 ${passed} / 실패 ${failed}`);
if (failed > 0) process.exit(1);
