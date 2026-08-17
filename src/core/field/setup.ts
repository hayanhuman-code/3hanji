/**
 * field/setup.ts — 편성을 판으로 옮긴다.
 *
 * 3열 진형(§4.5)이 전투 전 플레이어의 주된 결정이다. 여기서는 그 결정을
 * 전장 좌표로 푼다. 열은 화면상의 줄이 아니라 **적으로부터의 거리**다 —
 * 전열이 먼저 닿고, 뚫리면 중열이 노출되고, 후열은 물러날 곳을 잃는다.
 */

import { officerDef } from '../data';
import { CLASS, F, NAVY_SPEC } from './balance';
import { battlefield, edgeEntry, fieldSizeM, oppositeEdge, passable, tileSize } from './battlefield';
import { createSiegeState } from './siege';
import type { FieldEntry, FieldState, FieldUnit, Row, Side } from './types';
import type { FieldSetup } from './types';

/**
 * 열이 적으로부터 떨어진 거리(m). 전열이 가장 가깝다.
 *
 * 깊이는 **궁병 사거리(430m)** 가 정한다. 후열이 그보다 멀리 서면 전열 너머로
 * 화살이 안 닿아 진형에 뜻이 없어진다. 예전에는 420/900 이었는데, 후열 궁병이
 * 전열이 붙어 싸우는 동안 아무것도 못 하고 서 있었다.
 */
const ROW_DEPTH: Record<Row, number> = { front: 0, mid: 200, rear: 400 };
/** 예비대는 뒤에 더 뺀다 (§4.7) */
const RESERVE_DEPTH = 500;
/** 진형 전체가 차지하는 깊이 — 아래 간격 계산에 쓴다 */
const FORMATION_DEPTH = ROW_DEPTH.rear + RESERVE_DEPTH;
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
      /*
       * 지휘관이 없는 수비대가 있다 (§3.5). 주둔군은 장수의 사병이 아니므로
       * 아무도 없어도 존재하고, 통솔 40 상당으로 자동 운용된다.
       */
      const def = e.officer ? officerDef(e.officer) : null;
      const navy = !!e.navy && (def?.naval ?? true);
      /*
       * **계열은 출진 부대만 장수를 따른다** (§3.5).
       * 주둔 수비대는 거점 구성표가 정한 계열로 오고, 그 계열이 아닌 장수가
       * 맡으면 온전히 못 이끈다 — 그것이 offClass 다.
       */
      const troop = e.troop ?? def?.troop ?? 'inf';
      const offClass = !!def && !!e.troop && def.troop !== e.troop;
      const tier = tiers[troop];
      // 옆으로 벌리기 — 가운데를 기준으로 좌우 대칭
      const lateral = (i - (list.length - 1) / 2) * F.separation * 1.15;
      /*
       * **깊이는 적에게서 멀어지는 쪽으로 잰다.** axis 는 적을 향하므로 빼야 한다.
       * 더하고 있었더니 후열이 적에게 가장 가까이 서서, 궁병과 책사가 보병 앞에
       * 나가 얻어맞았다 — 3열 진형이 통째로 뒤집혀 있었다.
       */
      const bx = axis.ox - axis.dx * depth + px * lateral;
      const by = axis.oy - axis.dy * depth + py * lateral;
      const at = nudgeToPassable(f, bx, by, navy);

      units.push({
        id: `${side}-${e.officer || `garrison${i}-${row}`}`,
        side,
        officer: e.officer,
        name: e.name ?? def?.name ?? '城兵',
        troop,
        navy,
        offClass,
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
        pursuing: false,
        schemeAt: null,
        exposedUntil: null,
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
 * 성의 한가운데(m). 성벽·성문 타일의 무게중심으로 잡는다.
 * 성벽이 없는 전장이면 null — 그때는 그냥 야전이다.
 */
function keepCenter(f: ReturnType<typeof battlefield>): { x: number; y: number } | null {
  const [tw, th] = tileSize(f);
  const W = new Set(['W', 'G', 'T', 'O']);
  const w = f.w;
  const h = f.h;

  // 성벽이 있는가
  let any = false;
  for (const row of f.tiles) if ([...row].some((c) => W.has(c))) any = true;
  if (!any) return null;

  /*
   * **바깥 성곽(외성)의 마당** 한가운데를 돌려준다.
   *
   * 성벽 전체의 무게중심을 쓰면 이중성벽 성에서 수비군이 **내성 안**에 선다.
   * §7.4 의 「외성 돌파 → 내성 공성」 규칙은 아직 로직이 없으므로(다음 단계),
   * 그러면 외성을 깨도 안쪽에 못 닿아 여섯 성이 영영 안 떨어진다(실측 —
   * 한성 공성 15시간에 공격군이 성문을 깨고도 전멸했다).
   *
   * 성벽 바깥에서 물을 부어 「밖」을 지운 뒤, 남은 안쪽 가운데 **가장 넓은
   * 덩어리**가 외성 마당이다. 내성 안은 그보다 작은 별개 덩어리로 갈린다.
   */
  const out = new Uint8Array(w * h);
  const st: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (out[i] || W.has(f.tiles[y][x])) return;
    out[i] = 1;
    st.push(i);
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  while (st.length) {
    const i = st.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  // 안쪽 덩어리를 갈라 가장 넓은 것을 고른다
  const seen = new Uint8Array(w * h);
  let best: Array<[number, number]> = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (out[i] || seen[i] || W.has(f.tiles[y][x])) continue;
      const group: Array<[number, number]> = [];
      const q = [i];
      seen[i] = 1;
      while (q.length) {
        const j = q.pop()!;
        const a = j % w;
        const b = (j - a) / w;
        group.push([a, b]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = a + dx;
          const ny = b + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const k = ny * w + nx;
          if (out[k] || seen[k] || W.has(f.tiles[ny][nx])) continue;
          seen[k] = 1;
          q.push(k);
        }
      }
      if (group.length > best.length) best = group;
    }
  }
  if (!best.length) return null;
  const sx = best.reduce((a, p) => a + (p[0] + 0.5) * tw, 0) / best.length;
  const sy = best.reduce((a, p) => a + (p[1] + 0.5) * th, 0) / best.length;
  return { x: sx, y: sy };
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

  /*
   * 양측을 떼어 놓는다. 그 사이를 행군해 오는 것이 1국면이다.
   *
   * 다만 **진형이 판 밖으로 밀려나면 안 된다.** 남북으로 붙는 전장은 축이
   * 5km 뿐이라 4.2km 를 벌리면 뒤쪽 열과 예비대가 지도 밖으로 나가고,
   * nudgeToPassable 이 그것들을 전열 코앞으로 끌어당겨 진형이 뭉개졌다.
   * 축의 길이를 재서 들어갈 만큼만 벌린다.
   */
  const axisLen = Math.abs(dx) * w + Math.abs(dy) * h;
  const gap = Math.max(1600, Math.min(START_GAP, axisLen - 2 * (FORMATION_DEPTH + 200)));

  /*
   * 야전은 성을 비껴서 붙는다.
   *
   * §7 로 성이 지도 한가운데에 제대로 서자, 성을 낀 **야전**에서 양군이
   * 성벽과 해자를 빙 돌아가느라 조우전이 두 시간에서 네 시간으로 늘었다.
   * 야전은 성 밖 벌판에서 벌어지는 싸움이므로 축을 옆으로 밀어 준다.
   * 공성전은 반대로 성이 목적지이니 가운데 그대로 둔다.
   */
  const side = setup.siege ? 0 : (setup.seed % 2 ? 1 : -1) * Math.min(w, h) * 0.24;
  const cx = w / 2 - dy * side;
  const cy = h / 2 + dx * side;
  const atkOrigin = { ox: cx - dx * (gap / 2), oy: cy - dy * (gap / 2) };
  /*
   * 농성하는 쪽은 성 안에 선다.
   *
   * 이걸 안 하면 「공방전」이라 적어 놓고 수비군이 성벽 **바깥**에 나와 서 있게
   * 된다. 성문 바로 뒤에 서게 두어, 공격군이 성벽을 마주 보고 오게 만든다.
   * (§6 의 포위·성문 규칙 자체는 아직 없다 — 자리만 제대로 잡는 것이다)
   */
  const keep = setup.siege ? keepCenter(f) : null;
  const defOrigin = keep
    ? { ox: keep.x - dx * 260, oy: keep.y - dy * 260 }
    : { ox: cx + dx * (gap / 2), oy: cy + dy * (gap / 2) };

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
    /*
     * 공성전이면 성벽·성문·병량이 여기서 선다 (§6.2).
     * 이것이 null 이 아닌 동안 전투는 「어떻게 들어갈 것인가」의 문제가 된다.
     */
    siegeState:
      setup.siege && keep
        ? createSiegeState(setup.wallDev ?? 50, setup.grain ?? 2000, f.mountainous >= 0.25)
        : null,
    siegeCtx: {
      wardenChr: setup.wardenChr ?? 50,
      wardenTrait: setup.wardenTrait ?? null,
      // 강이 흐르는 전장이라야 수공이 성립한다 (§6.3-③)
      riverside: f.hasRiver,
    },
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
    if (e.troops <= 0) return '병력이 없는 부대가 있습니다.';
    if (!e.officer) continue; // 지휘관 없는 수비대 (§3.5)
    if (seen.has(e.officer)) return '같은 인물을 두 번 낼 수 없습니다.';
    seen.add(e.officer);
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
