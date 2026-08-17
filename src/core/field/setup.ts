/**
 * field/setup.ts — 편성을 판으로 옮긴다.
 *
 * 3열 진형(§4.5)이 전투 전 플레이어의 주된 결정이다. 여기서는 그 결정을
 * 전장 좌표로 푼다. 열은 화면상의 줄이 아니라 **적으로부터의 거리**다 —
 * 전열이 먼저 닿고, 뚫리면 중열이 노출되고, 후열은 물러날 곳을 잃는다.
 */

import { officerDef } from '../data';
import { CLASS, F, NAVY_SPEC } from './balance';
import { battlefield, edgeEntry, fieldSizeM, oppositeEdge, passable } from './battlefield';
import type { FieldEntry, FieldState, FieldUnit, Row, Side } from './types';
import type { FieldSetup } from './types';

/** 열이 적으로부터 떨어진 거리(m). 전열이 가장 가깝다 */
const ROW_DEPTH: Record<Row, number> = { front: 0, mid: 420, rear: 900 };
/** 예비대는 뒤에 더 뺀다 (§4.7) */
const RESERVE_DEPTH = 700;
/** 양측 시작 간격(m). 7km 전장에서 마주 보고 들어온다 */
const START_GAP = 4200;

/**
 * 전장에서 갈 수 있는 자리로 밀어 준다.
 * 배치 좌표가 험지나 강 위에 떨어지면 부대가 시작부터 갇힌다.
 */
function nudgeToPassable(
  f: ReturnType<typeof battlefield>,
  x: number,
  y: number,
  navy: boolean
): { x: number; y: number } {
  if (passable(f, x, y, navy)) return { x, y };
  const [w, h] = fieldSizeM(f);
  // 나선으로 넓혀 가며 가장 가까운 갈 수 있는 자리를 찾는다
  for (let r = 120; r <= 2600; r += 120) {
    for (let a = 0; a < 12; a++) {
      const th = (a / 12) * Math.PI * 2;
      const nx = Math.min(w - 60, Math.max(60, x + Math.cos(th) * r));
      const ny = Math.min(h - 60, Math.max(60, y + Math.sin(th) * r));
      if (passable(f, nx, ny, navy)) return { x: nx, y: ny };
    }
  }
  return { x, y };
}

function buildSide(
  setup: FieldSetup,
  side: Side,
  entries: FieldEntry[],
  f: ReturnType<typeof battlefield>,
  axis: { ox: number; oy: number; dx: number; dy: number }
): FieldUnit[] {
  const faction = side === 'attacker' ? setup.attackerFaction : setup.defenderFaction;
  const tiers = setup.tiers[side];
  const units: FieldUnit[] = [];

  // 같은 열에 선 부대끼리 옆으로 벌린다
  const byRow = new Map<string, FieldEntry[]>();
  for (const e of entries) {
    const key = `${e.row}:${e.reserve ? 'r' : 'f'}`;
    if (!byRow.has(key)) byRow.set(key, []);
    byRow.get(key)!.push(e);
  }

  // 진행 방향에 수직인 축
  const px = -axis.dy;
  const py = axis.dx;

  for (const [key, list] of byRow) {
    const [row, kind] = key.split(':') as [Row, string];
    const depth = ROW_DEPTH[row] + (kind === 'r' ? RESERVE_DEPTH : 0);
    list.forEach((e, i) => {
      const def = officerDef(e.officer);
      const navy = !!e.navy && def.naval;
      const troop = def.troop;
      const tier = tiers[troop];
      // 옆으로 벌리기 — 가운데를 기준으로 좌우 대칭
      const lateral = (i - (list.length - 1) / 2) * F.separation * 1.15;
      const bx = axis.ox + axis.dx * depth + px * lateral;
      const by = axis.oy + axis.dy * depth + py * lateral;
      const at = nudgeToPassable(f, bx, by, navy);

      units.push({
        id: `${side}-${e.officer}`,
        side,
        officer: e.officer,
        name: def.name,
        troop,
        navy,
        tier,
        faction,
        troops: e.troops,
        maxTroops: e.troops,
        // 급조한 군대는 쉽게 무너진다 — 1단계는 사기 70 에서 시작한다 (§4.11)
        morale: tier === 1 ? F.moraleStartTier1 : F.moraleStart,
        fatigue: 0,
        x: at.x,
        y: at.y,
        row,
        reserve: e.reserve,
        stance: 'hold',
        orderTarget: null,
        orderPoint: null,
        target: null,
        path: [],
        pathAt: -9999,
        pathGoal: null,
        routed: false,
        dead: false,
        arriveTick: 0,
      });
    });
  }
  return units;
}

/**
 * 편성 → 판.
 *
 * 진입 방향은 전략맵에서 실제로 이어진 길에서 온다(§5.4). approaches 가
 * 비어 있으면 서→동으로 놓는다.
 */
export function createField(setup: FieldSetup): FieldState {
  const f = battlefield(setup.fieldId);
  const [w, h] = fieldSizeM(f);

  // 공격측이 들어오는 변. 육로 진입을 먼저 고른다
  const land = f.approaches.find((a) => !a.sea && !a.needsWater) ?? f.approaches[0];
  const atkEdge = land?.edge ?? 'W';
  const defEdge = oppositeEdge(atkEdge);
  const a0 = edgeEntry(f, atkEdge);
  const d0 = edgeEntry(f, defEdge);

  // 공격측 → 수비측 방향
  let dx = d0.x - a0.x;
  let dy = d0.y - a0.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;

  // 양측을 START_GAP 만큼 떼어 놓는다. 그 사이를 행군해 오는 것이 1국면이다
  const cx = w / 2;
  const cy = h / 2;
  const atkOrigin = { ox: cx - dx * (START_GAP / 2), oy: cy - dy * (START_GAP / 2) };
  const defOrigin = { ox: cx + dx * (START_GAP / 2), oy: cy + dy * (START_GAP / 2) };

  const units = [
    ...buildSide(setup, 'attacker', setup.attacker, f, { ...atkOrigin, dx, dy }),
    ...buildSide(setup, 'defender', setup.defender, f, { ...defOrigin, dx: -dx, dy: -dy }),
  ];

  return {
    field: f,
    axis: { dx, dy },
    seed: setup.seed,
    rngCursor: setup.seed,
    tick: 0,
    phase: 'march',
    season: setup.season,
    siege: setup.siege,
    attackerFaction: setup.attackerFaction,
    defenderFaction: setup.defenderFaction,
    playerSide: setup.playerSide,
    units,
    log: [
      {
        tick: 0,
        text: `${f.name}에서 ${setup.siege ? '공방전' : '야전'}이 시작되었다.`,
        big: true,
      },
    ],
    result: null,
  };
}

/** 편성이 성립하는가. 화면이 「출진」을 막을 이유를 여기서 하나로 만든다 */
export function validateEntries(entries: FieldEntry[]): string | null {
  if (entries.length === 0) return '부대가 없습니다.';
  if (entries.length > 12) return '한 번에 12부대까지만 낼 수 있습니다.';
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.officer)) return '같은 인물을 두 번 낼 수 없습니다.';
    seen.add(e.officer);
    if (e.troops <= 0) return '병력이 없는 부대가 있습니다.';
    const def = officerDef(e.officer);
    if (e.navy && !def.naval) return `${def.name}은(는) 수군을 이끌 수 없습니다.`;
  }
  if (entries.every((e) => e.reserve)) return '전부 예비대로 둘 수는 없습니다.';
  return null;
}

/** 계열이 이 열에서 제 몫을 하는지 — 편성 화면의 경고에 쓴다 */
export function rowSpec(navy: boolean, troop: FieldUnit['troop']) {
  return navy ? NAVY_SPEC : CLASS[troop];
}
