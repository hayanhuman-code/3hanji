/**
 * test.ts — 의존성 없는 스모크 테스트.
 *
 * 프레임워크를 붙이지 않고 assert 만으로 돌린다(1인 개발의 범위 방어).
 * 실행: npm test
 */

import { evaluate, validateCondition } from '../src/core/dsl';
import { createBattle } from '../src/core/battle/battleState';
import { runBattleToEnd } from '../src/core/battle/battleEngine';
import { hexDistance, offsetToAxial, axialToOffset, pixelToHex, hexToPixel } from '../src/core/battle/hex';
import { pickAIChoice } from '../src/core/events';
import { RngCursor, seedFromString } from '../src/core/rng';
import { createGame, factionCastles, factionTroops } from '../src/core/state';
import { deserialize, serialize } from '../src/core/save';
import { beginNextTurn, completeEvent, resolveTurn } from '../src/core/turn';
import { findPath } from '../src/core/util';
import { castleDef, CASTLES } from '../src/core/data';
import type { BattleSetup } from '../src/core/battle/battleState';

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
 * 헥스 기하
 * ================================================================== */

section('헥스 기하');

test('offset ↔ axial 왕복 변환', () => {
  for (let col = 0; col < 13; col++) {
    for (let row = 0; row < 9; row++) {
      const back = axialToOffset(offsetToAxial(col, row));
      assertEqual(back.col, col, `col ${col},${row}`);
      assertEqual(back.row, row, `row ${col},${row}`);
    }
  }
});

test('헥스 거리는 인접 칸에서 1', () => {
  const a = offsetToAxial(5, 4);
  assertEqual(hexDistance(a, { q: a.q + 1, r: a.r }), 1);
  assertEqual(hexDistance(a, { q: a.q, r: a.r + 1 }), 1);
  assertEqual(hexDistance(a, a), 0);
});

test('픽셀 ↔ 헥스 왕복 변환', () => {
  for (let q = -4; q <= 4; q++) {
    for (let r = 0; r < 9; r++) {
      const p = hexToPixel({ q, r }, 20);
      const back = pixelToHex(p.x, p.y, 20);
      assert(back.q === q && back.r === r, `(${q},${r}) → (${back.q},${back.r})`);
    }
  }
});

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

/* ================================================================== *
 * 전술 전투 (단독 실행)
 * ================================================================== */

section('전술 전투 — 전략 모듈 없이 단독 실행');

function makeSetup(over: Partial<BattleSetup> = {}): BattleSetup {
  return {
    castle: 'test',
    castleName: '시험성',
    siege: false,
    season: 0,
    terrain: 'plain',
    mountainFortress: false,
    wallDev: 60,
    attackerFaction: 'goguryeo',
    defenderFaction: 'silla',
    attacker: [{ unitType: 'infantry', count: 6000 }],
    defender: [{ unitType: 'infantry', count: 6000 }],
    attackerMorale: 70,
    defenderMorale: 70,
    attackerTraining: 60,
    defenderTraining: 60,
    playerSide: null,
    seed: 1234,
    ...over,
  };
}

test('전투는 반드시 끝난다', () => {
  for (let seed = 0; seed < 20; seed++) {
    const b = createBattle(makeSetup({ seed: seed * 977 }));
    const result = runBattleToEnd(b);
    assert(b.finished, `seed ${seed}: 전투가 끝나지 않았습니다`);
    assert(result.winner === 'attacker' || result.winner === 'defender', '승자가 없습니다');
    assert(result.attackerLoss >= 0 && result.defenderLoss >= 0, '피해가 음수입니다');
  }
});

test('같은 시드는 같은 결과를 낸다 (결정론)', () => {
  const a = runBattleToEnd(createBattle(makeSetup({ seed: 777 })));
  const b = runBattleToEnd(createBattle(makeSetup({ seed: 777 })));
  assertEqual(a.winner, b.winner, '승자가 다릅니다');
  assertEqual(a.attackerLoss, b.attackerLoss, '공격 측 피해가 다릅니다');
  assertEqual(a.defenderLoss, b.defenderLoss, '수비 측 피해가 다릅니다');
});

test('장창보병은 개마무사를 막아 세운다 (병종 상성)', () => {
  let spearWins = 0;
  for (let s = 0; s < 20; s++) {
    const b = createBattle(
      makeSetup({
        seed: s * 131,
        attacker: [{ unitType: 'gaema', count: 5000 }],
        defender: [{ unitType: 'spear', count: 5000 }],
      })
    );
    if (runBattleToEnd(b).winner === 'defender') spearWins++;
  }
  assert(spearWins >= 12, `장창보병 승률이 너무 낮습니다 (${spearWins}/20)`);
});

test('개마무사는 궁병을 짓밟는다 (병종 상성 반대편)', () => {
  let cavWins = 0;
  for (let s = 0; s < 20; s++) {
    const b = createBattle(
      makeSetup({
        seed: s * 313,
        attacker: [{ unitType: 'gaema', count: 5000 }],
        defender: [{ unitType: 'archer', count: 5000 }],
      })
    );
    if (runBattleToEnd(b).winner === 'attacker') cavWins++;
  }
  assert(cavWins >= 12, `기병 승률이 너무 낮습니다 (${cavWins}/20)`);
});

test('산성 농성은 같은 병력의 강공을 막아낸다 (기획서 §6.3)', () => {
  let held = 0;
  for (let s = 0; s < 20; s++) {
    const b = createBattle(
      makeSetup({
        seed: s * 719,
        siege: true,
        terrain: 'mountain',
        mountainFortress: true,
        wallDev: 90,
        attacker: [{ unitType: 'infantry', count: 8000 }],
        defender: [{ unitType: 'infantry', count: 8000 }],
      })
    );
    if (runBattleToEnd(b).winner === 'defender') held++;
  }
  assert(held >= 16, `산성이 너무 쉽게 떨어집니다 (수비 ${held}/20)`);
});

test('압도적 병력은 산성도 무너뜨린다', () => {
  let taken = 0;
  for (let s = 0; s < 20; s++) {
    const b = createBattle(
      makeSetup({
        seed: s * 421,
        siege: true,
        terrain: 'mountain',
        mountainFortress: true,
        wallDev: 90,
        attacker: [
          { unitType: 'infantry', count: 24000 },
          { unitType: 'ram', count: 4000 },
        ],
        defender: [{ unitType: 'infantry', count: 6000 }],
      })
    );
    if (runBattleToEnd(b).winner === 'attacker') taken++;
  }
  assert(taken >= 12, `대군이 성을 못 떨어뜨립니다 (함락 ${taken}/20)`);
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
 * 결과
 * ================================================================== */

console.log(`\n${'─'.repeat(50)}`);
console.log(`통과 ${passed} / 실패 ${failed}`);
if (failed > 0) process.exit(1);
