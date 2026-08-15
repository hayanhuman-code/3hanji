/**
 * data.ts — JSON 데이터 레이어의 단일 진입점.
 *
 * 게임 코어는 JSON 파일을 직접 import 하지 않고 항상 이 모듈을 거친다.
 * (나중에 데이터를 원격에서 받아오거나 MOD 를 얹더라도 여기만 바꾸면 된다.)
 */

import castlesJson from '../data/castles.json';
import mapdataJson from '../data/mapdata.json';
import factionsJson from '../data/factions.json';
import officersJson from '../data/officers.json';
import unitTypesJson from '../data/unitTypes.json';
import institutionsJson from '../data/institutions.json';
import eventsJson from '../data/events.json';
import scenario642 from '../data/scenarios/scenario-642.json';
import scenario551 from '../data/scenarios/scenario-551.json';
import scenario001 from '../data/scenarios/scenario-001.json';

import type {
  CastleDef,
  CastleId,
  EventDef,
  FactionDef,
  FactionId,
  InstitutionDef,
  MapData,
  OfficerDef,
  OfficerId,
  ScenarioDef,
  UnitTypeDef,
  UnitTypeId,
} from './types';

export const CASTLES = castlesJson as unknown as CastleDef[];

/**
 * 지도 원본 — 실제 경위도에서 뽑은 해안선·하천·산맥과 길의 곡선 경로.
 * castles.json 은 여기서 build-castles.ts 가 생성한 것이고,
 * 이 파일 자체는 전략맵을 그리는 데 쓴다.
 */
export const MAP = mapdataJson as unknown as MapData;

/** 거점 쌍 → 길의 SVG 경로. 지도에서 직선 대신 이 곡선을 그린다. */
const routePathIndex = new Map<string, { d: string; sea: boolean }>();
for (const r of MAP.routes.land) routePathIndex.set(routeKey(r.a, r.b), { d: r.d, sea: false });
for (const r of MAP.routes.sea) routePathIndex.set(routeKey(r.a, r.b), { d: r.d, sea: true });

export function routeKey(a: CastleId, b: CastleId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function routePath(a: CastleId, b: CastleId): { d: string; sea: boolean } | undefined {
  return routePathIndex.get(routeKey(a, b));
}

export const ROUTES = [...routePathIndex.entries()].map(([key, v]) => {
  const [a, b] = key.split('|');
  return { a, b, ...v };
});
export const FACTIONS = factionsJson as unknown as FactionDef[];
export const OFFICERS = officersJson as unknown as OfficerDef[];
export const UNIT_TYPES = unitTypesJson as unknown as UnitTypeDef[];
export const INSTITUTIONS = institutionsJson as unknown as InstitutionDef[];
export const EVENTS = eventsJson as unknown as EventDef[];
export const SCENARIOS = [scenario642, scenario551, scenario001] as unknown as ScenarioDef[];

const castleIndex = new Map<CastleId, CastleDef>(CASTLES.map((c) => [c.id, c]));
const factionIndex = new Map<FactionId, FactionDef>(FACTIONS.map((f) => [f.id, f]));
const officerIndex = new Map<OfficerId, OfficerDef>(OFFICERS.map((o) => [o.id, o]));
const unitIndex = new Map<UnitTypeId, UnitTypeDef>(UNIT_TYPES.map((u) => [u.id, u]));
const institutionIndex = new Map<string, InstitutionDef>(INSTITUTIONS.map((i) => [i.id, i]));
const eventIndex = new Map<string, EventDef>(EVENTS.map((e) => [e.id, e]));
const scenarioIndex = new Map<string, ScenarioDef>(SCENARIOS.map((s) => [s.id, s]));

export function castleDef(id: CastleId): CastleDef {
  const d = castleIndex.get(id);
  if (!d) throw new Error(`알 수 없는 거점: ${id}`);
  return d;
}

export function factionDef(id: FactionId): FactionDef {
  const d = factionIndex.get(id);
  if (!d) throw new Error(`알 수 없는 세력: ${id}`);
  return d;
}

export function officerDef(id: OfficerId): OfficerDef {
  const d = officerIndex.get(id);
  if (!d) throw new Error(`알 수 없는 인물: ${id}`);
  return d;
}

/** 존재하지 않아도 되는 조회 (이벤트 DSL 등) */
export function tryOfficerDef(id: OfficerId): OfficerDef | undefined {
  return officerIndex.get(id);
}

export function unitDef(id: UnitTypeId): UnitTypeDef {
  const d = unitIndex.get(id);
  if (!d) throw new Error(`알 수 없는 병종: ${id}`);
  return d;
}

export function institutionDef(id: string): InstitutionDef {
  const d = institutionIndex.get(id);
  if (!d) throw new Error(`알 수 없는 제도: ${id}`);
  return d;
}

export function eventDef(id: string): EventDef {
  const d = eventIndex.get(id);
  if (!d) throw new Error(`알 수 없는 이벤트: ${id}`);
  return d;
}

export function scenarioDef(id: string): ScenarioDef {
  const d = scenarioIndex.get(id);
  if (!d) throw new Error(`알 수 없는 시나리오: ${id}`);
  return d;
}

export function castleName(id: CastleId): string {
  return castleIndex.get(id)?.name ?? id;
}

export function factionName(id: FactionId | null): string {
  if (!id) return '중립';
  return factionIndex.get(id)?.name ?? id;
}

export function officerName(id: OfficerId): string {
  return officerIndex.get(id)?.name ?? id;
}

export function factionColor(id: FactionId | null): string {
  if (!id) return '#7a7a7a';
  return factionIndex.get(id)?.color ?? '#7a7a7a';
}

/** 특정 세력이 징병할 수 있는 병종 목록 */
export function availableUnits(faction: FactionId, institutions: string[]): UnitTypeDef[] {
  return UNIT_TYPES.filter((u) => {
    if (u.faction !== null && u.faction !== faction) return false;
    if (u.requires && !institutions.includes(u.requires)) return false;
    return true;
  });
}

/** 인물이 성인으로 판에 서는 나이 */
export const ADULT_AGE = 16;

/**
 * 이 시나리오에서 인물이 활동하는 구간 [등장 연도, 퇴장 연도].
 * 명부에 없으면 null — 역사 시나리오의 가상 인물, 압축 시나리오의 역사 전용 인물이 그렇다.
 *
 * 압축 모드는 나이를 연도로 되돌린다:
 *   등장 = 시작 연도 + (성인이 되기까지 남은 햇수)
 *   퇴장 = 시작 연도 + (수명 - 지금 나이)
 */
export function officerWindow(
  def: OfficerDef,
  scenario: Pick<ScenarioDef, 'roster' | 'startYear'>
): { appear: number; retire: number } | null {
  if (scenario.roster === 'compressed') {
    if (def.age === null || def.lifespan === null) return null;
    return {
      appear: scenario.startYear + Math.max(0, ADULT_AGE - def.age),
      retire: scenario.startYear + (def.lifespan - def.age),
    };
  }
  if (def.appear === null || def.retire === null) return null;
  return { appear: def.appear, retire: def.retire };
}

/** 해당 연도에 활동 중인 인물 */
export function officersAliveIn(
  year: number,
  scenario: Pick<ScenarioDef, 'roster' | 'startYear'>
): OfficerDef[] {
  return OFFICERS.filter((o) => {
    const w = officerWindow(o, scenario);
    return w !== null && w.appear <= year && w.retire >= year;
  });
}

export const PLAYABLE_FACTIONS = FACTIONS.filter((f) => f.playable);
