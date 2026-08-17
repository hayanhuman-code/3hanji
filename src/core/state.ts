/**
 * state.ts — gameState 의 생성과 조회.
 *
 * 상태를 "만드는 함수"와 "읽는 함수"만 둔다.
 * 상태를 바꾸는 규칙은 turn.ts / domestic.ts / military.ts 등이 담당한다.
 */

import {
  CASTLES,
  FACTIONS,
  OFFICERS,
  castleDef,
  factionDef,
  officerDef,
  officerWindow,
  scenarioDef,
} from './data';
import { B } from './formulas';
import { seedFromString } from './rng';
import { clamp, relationKey } from './util';
import type {
  Army,
  CastleId,
  CastleState,
  FactionId,
  FactionState,
  GameOptions,
  GameState,
  LogEntry,
  OfficerDef,
  OfficerId,
  OfficerState,
  Relation,
  ScenarioDef,
  Season,
  UnitStack,
} from './types';

export const STATE_VERSION = 1;

/** 세력별 기본 주둔군 편성 비율 */
const DEFAULT_COMPOSITION: Record<FactionId, Array<[string, number]>> = {
  goguryeo: [
    ['infantry', 0.45],
    ['gaema', 0.22],
    ['maekgung', 0.33],
  ],
  baekje: [
    ['infantry', 0.52],
    ['archer', 0.3],
    ['navy', 0.18],
  ],
  silla: [
    ['infantry', 0.38],
    ['spear', 0.37],
    ['archer', 0.25],
  ],
  gaya: [
    ['ironclad', 0.6],
    ['archer', 0.4],
  ],
};

export function defaultComposition(faction: FactionId, troops: number): UnitStack[] {
  const mix = DEFAULT_COMPOSITION[faction] ?? [['infantry', 1]];
  const stacks: UnitStack[] = mix.map(([unitType, ratio]) => ({
    unitType,
    count: Math.round(troops * ratio),
  }));
  // 반올림 오차를 첫 스택에 흡수시켜 합계를 정확히 맞춘다.
  const diff = troops - stacks.reduce((s, u) => s + u.count, 0);
  if (stacks.length > 0) stacks[0].count += diff;
  return stacks.filter((s) => s.count > 0);
}

export const DEFAULT_OPTIONS: GameOptions = {
  historicalEvents: true,
  autoBattle: false,
  // 통일(전 거점 점령)은 언제나 승리다. 패권은 옵션으로 켰을 때만 판정하며,
  // 한 판을 현실적인 길이 안에 끝맺게 해 주는 쪽이라 기본값으로 둔다.
  victory: 'hegemony',
  difficulty: 'normal',
};

export interface NewGameConfig {
  scenarioId: string;
  playerFaction: FactionId;
  options?: Partial<GameOptions>;
  seed?: number;
}

export function createGame(config: NewGameConfig): GameState {
  const scenario = scenarioDef(config.scenarioId);
  const options: GameOptions = { ...DEFAULT_OPTIONS, ...(config.options ?? {}) };
  const year = scenario.startYear;

  /* --- 거점 --- */
  const ownerOf = new Map<CastleId, FactionId>();
  for (const [faction, list] of Object.entries(scenario.ownership)) {
    for (const cid of list) ownerOf.set(cid, faction);
  }

  const castles: Record<CastleId, CastleState> = {};
  for (const def of CASTLES) {
    const owner = ownerOf.get(def.id) ?? null;
    const troops = owner ? scenario.troops?.[def.id] ?? estimateTroops(def.type) : 0;
    castles[def.id] = {
      id: def.id,
      owner,
      dev: { ...def.base },
      troops,
      composition: owner ? defaultComposition(owner, troops) : [],
      loyalty: owner ? 62 : 45,
      training: owner ? 55 : 30,
      stock: Math.round(def.base.agri * B.stockPerAgri * 0.55),
      officers: [],
      besiegedBy: null,
      siegeTurns: 0,
    };
  }

  /* --- 세력 --- */
  const factions: Record<FactionId, FactionState> = {};
  for (const def of FACTIONS) {
    const owns = (scenario.ownership[def.id] ?? []).length > 0;
    const r = scenario.resources?.[def.id] ?? {};
    const mod = scenario.factionMods?.[def.id] ?? {};
    factions[def.id] = {
      id: def.id,
      resources: {
        grain: r.grain ?? 8000,
        gold: r.gold ?? 3000,
        iron: r.iron ?? 300,
        cause: r.cause ?? 10,
      },
      personality: { ...def.personality, ...(mod.personality ?? {}) },
      councilSupport: mod.councilSupport ?? def.council.support,
      institutions: [],
      autonomy: mod.autonomy ?? 80,
      alive: owns,
      flags: [],
      isAI: def.id !== config.playerFaction,
      // 모두 1단계에서 시작한다. 여기서부터 무엇을 키울지가 갈린다 (§2.1)
      troopTiers: { inf: 1, cav: 1, arc: 1, str: 1 },
    };
  }

  /* --- 인물 --- */
  const deadAtStart = new Set(scenario.dead ?? []);
  const spread = makeSpreader(scenario);
  const officers: Record<OfficerId, OfficerState> = {};
  for (const def of OFFICERS) {
    const win = officerWindow(def, scenario);
    const active = win !== null && win.appear <= year && win.retire >= year && !deadAtStart.has(def.id);
    if (!active) {
      // 이 시나리오의 명부에 없는 인물(win === null)은 처음부터 없는 사람으로 둔다.
      const gone = win === null || win.retire < year || deadAtStart.has(def.id);
      officers[def.id] = {
        id: def.id,
        faction: null,
        location: null,
        armyId: null,
        loyalty: 70,
        acted: false,
        // 아직 나이가 안 찼으면 'free' 로 두었다가 등장 연도에 turn.ts 가 깨운다.
        status: gone ? 'dead' : 'free',
        hidden: true,
      };
      continue;
    }

    const placed = scenario.placement?.[def.id];
    let location: CastleId | null = null;
    let faction: FactionId | null = null;
    let hidden = true;

    if (placed && castles[placed]) {
      // 배치가 명시되면 그 거점의 주인을 섬긴다. (예: 금관가야 왕족의 신라 귀부)
      location = placed;
      faction = castles[placed].owner;
      hidden = faction === null;
    } else if (def.faction && factions[def.faction]?.alive) {
      location = spread(def.faction, def);
      faction = def.faction;
      hidden = false;
    } else if (def.home && castles[def.home]) {
      location = def.home;
      faction = null;
      hidden = true;
    }

    officers[def.id] = {
      id: def.id,
      faction,
      location,
      armyId: null,
      loyalty: faction ? (def.loyalty_type === 'loyal' ? 88 : 70) : 60,
      acted: false,
      status: faction ? 'active' : 'free',
      hidden,
    };
    if (location && faction) castles[location].officers.push(def.id);
  }

  /* --- 외교 --- */
  const relations: Record<string, Relation> = {};
  const ids = FACTIONS.map((f) => f.id);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      relations[relationKey(ids[i], ids[j])] = { status: 'peace', trust: 0, truceTurns: 0 };
    }
  }
  for (const r of scenario.relations ?? []) {
    relations[relationKey(r.a, r.b)] = { status: r.status, trust: r.trust, truceTurns: 0 };
  }

  const state: GameState = {
    version: STATE_VERSION,
    scenarioId: scenario.id,
    playerFaction: config.playerFaction,
    options,
    turn: 1,
    year,
    season: scenario.startSeason,
    phase: 'command',
    factions,
    castles,
    officers,
    armies: {},
    relations,
    rng: config.seed ?? seedFromString(`${scenario.id}:${config.playerFaction}`),
    nextId: 1,
    firedEvents: [],
    pendingBattles: [],
    pendingEvents: [],
    reports: [],
    log: [],
    chronicle: [
      {
        year,
        season: scenario.startSeason,
        text: `${scenario.name} — ${scenario.desc}`,
      },
    ],
    result: null,
  };

  addLog(state, null, 'system', `${scenario.name} (${year}년) 개시.`);
  return state;
}

function estimateTroops(type: string): number {
  switch (type) {
    case 'capital':
      return 12000;
    case 'major':
      return 8000;
    case 'fort':
      return 7000;
    default:
      return 5000;
  }
}

/**
 * 배치가 명시되지 않은 인물을 세력 영토에 흩는 배분기.
 *
 * 전부 도성에 몰아넣으면 76 거점 판에서 한 성에 60 명이 서고 나머지는 텅 빈다.
 * 등급이 높은 인물이 큰 성에 가도록 거점을 등급순으로 늘어놓고 차례로 채운다.
 *
 * 상태를 한 판 안에서만 들고 있어야 한다 — 모듈 전역에 두면 시뮬레이터가
 * 한 프로세스에서 수백 판을 돌릴 때 배치가 판마다 달라진다.
 */
function makeSpreader(scenario: ScenarioDef): (f: FactionId, def: OfficerDef) => CastleId | null {
  const order = new Map<string, CastleId[]>();
  const cursor = new Map<string, number>();
  const rank: Record<string, number> = { capital: 0, major: 1, fort: 2, port: 3 };

  return (faction, def) => {
    let list = order.get(faction);
    if (!list) {
      list = [...(scenario.ownership[faction] ?? [])].sort(
        (a, b) =>
          (rank[castleDef(a).type] ?? 9) - (rank[castleDef(b).type] ?? 9) || a.localeCompare(b)
      );
      order.set(faction, list);
    }
    if (list.length === 0) return null;
    // 1급은 앞쪽(도성·대성)에서만 돌린다. 이름난 장수가 변방 초소에 앉지 않도록.
    const top = def.tier === 1;
    const span = top ? Math.max(1, Math.ceil(list.length / 3)) : list.length;
    const key = `${faction}|${top}`;
    const i = cursor.get(key) ?? 0;
    cursor.set(key, i + 1);
    return list[i % span];
  };
}

/* ================================================================== *
 * 조회 (selectors)
 * ================================================================== */

export function nextId(state: GameState, prefix: string): string {
  return `${prefix}${state.nextId++}`;
}

export function getRelation(state: GameState, a: FactionId, b: FactionId): Relation {
  const key = relationKey(a, b);
  let r = state.relations[key];
  if (!r) {
    r = { status: 'peace', trust: 0, truceTurns: 0 };
    state.relations[key] = r;
  }
  return r;
}

export function atWar(state: GameState, a: FactionId | null, b: FactionId | null): boolean {
  if (!a || !b || a === b) return false;
  return getRelation(state, a, b).status === 'war';
}

export function isAllied(state: GameState, a: FactionId | null, b: FactionId | null): boolean {
  if (!a || !b || a === b) return false;
  return getRelation(state, a, b).status === 'alliance';
}

export function factionCastles(state: GameState, faction: FactionId): CastleState[] {
  return Object.values(state.castles).filter((c) => c.owner === faction);
}

export function factionOfficers(state: GameState, faction: FactionId): OfficerState[] {
  return Object.values(state.officers).filter(
    (o) => o.faction === faction && o.status === 'active'
  );
}

export function factionArmies(state: GameState, faction: FactionId): Army[] {
  return Object.values(state.armies).filter((a) => a.faction === faction);
}

export function armyTroops(army: Army): number {
  return army.units.reduce((s, u) => s + u.count, 0);
}

export function factionTroops(state: GameState, faction: FactionId): number {
  const garrison = factionCastles(state, faction).reduce((s, c) => s + c.troops, 0);
  const field = factionArmies(state, faction).reduce((s, a) => s + armyTroops(a), 0);
  return garrison + field;
}

/** 거점에 있고 아직 명령을 쓰지 않은 인물 */
export function availableOfficersAt(state: GameState, castle: CastleId): OfficerState[] {
  const c = state.castles[castle];
  if (!c) return [];
  return c.officers
    .map((id) => state.officers[id])
    .filter((o) => o && o.status === 'active' && !o.acted && o.armyId === null);
}

/** 거점의 최고 지휘관(통솔 기준) */
export function bestCommanderAt(state: GameState, castle: CastleId): OfficerState | undefined {
  const list = state.castles[castle]?.officers
    .map((id) => state.officers[id])
    .filter((o) => o && o.status === 'active' && o.armyId === null);
  if (!list || list.length === 0) return undefined;
  return list.reduce((best, o) =>
    officerDef(o.id).stats.lead > officerDef(best.id).stats.lead ? o : best
  );
}

/** 세력 고유 특성 목록 (factions.json 의 traits) */
export function factionTraits(state: GameState, faction: FactionId): readonly string[] {
  void state;
  try {
    return factionDef(faction).traits;
  } catch {
    return [];
  }
}

export function hasInstitution(state: GameState, faction: FactionId, id: string): boolean {
  return state.factions[faction]?.institutions.includes(id) ?? false;
}

/** 세력에 특기 보유자가 있는지 (독재 등 세력 단위 특기 판정) */
export function factionHasSkill(state: GameState, faction: FactionId, skill: string): boolean {
  return factionOfficers(state, faction).some((o) => officerDef(o.id).skills.includes(skill));
}

export function addLog(
  state: GameState,
  faction: FactionId | null,
  kind: LogEntry['kind'],
  text: string
): void {
  state.log.push({
    turn: state.turn,
    year: state.year,
    season: state.season,
    faction,
    kind,
    text,
  });
  // 로그가 무한히 자라지 않도록 최근분만 유지한다.
  if (state.log.length > 600) state.log.splice(0, state.log.length - 600);
}

export function addChronicle(state: GameState, text: string): void {
  state.chronicle.push({ year: state.year, season: state.season, text });
}

export function adjustLoyalty(castle: CastleState, delta: number): void {
  castle.loyalty = clamp(castle.loyalty + delta, 0, 100);
}

export function adjustResource(
  state: GameState,
  faction: FactionId,
  key: 'grain' | 'gold' | 'iron' | 'cause',
  delta: number
): void {
  const f = state.factions[faction];
  if (!f) return;
  f.resources[key] = Math.max(0, f.resources[key] + delta);
  if (key === 'cause') f.resources.cause = clamp(f.resources.cause, 0, 100);
}

/** 세력의 도성 (없으면 아무 거점) */
export function capitalCastle(state: GameState, faction: FactionId): CastleState | undefined {
  const owned = factionCastles(state, faction);
  return owned.find((c) => castleDef(c.id).type === 'capital') ?? owned[0];
}

export function seasonLabel(season: Season): string {
  return ['봄', '여름', '가을', '겨울'][season];
}

export function factionLabel(id: FactionId): string {
  try {
    return factionDef(id).name;
  } catch {
    return id;
  }
}
