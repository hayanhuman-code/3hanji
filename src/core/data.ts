/**
 * data.ts — JSON 데이터 레이어의 단일 진입점.
 *
 * 게임 코어는 JSON 파일을 직접 import 하지 않고 항상 이 모듈을 거친다.
 * (나중에 데이터를 원격에서 받아오거나 MOD 를 얹더라도 여기만 바꾸면 된다.)
 */

import castlesJson from '../data/castles.json';
import factionsJson from '../data/factions.json';
import officersJson from '../data/officers.json';
import unitTypesJson from '../data/unitTypes.json';
import institutionsJson from '../data/institutions.json';
import eventsJson from '../data/events.json';
import scenario642 from '../data/scenarios/scenario-642.json';
import scenario551 from '../data/scenarios/scenario-551.json';

import type {
  CastleDef,
  CastleId,
  EventDef,
  FactionDef,
  FactionId,
  InstitutionDef,
  OfficerDef,
  OfficerId,
  ScenarioDef,
  UnitTypeDef,
  UnitTypeId,
} from './types';

export const CASTLES = castlesJson as unknown as CastleDef[];
export const FACTIONS = factionsJson as unknown as FactionDef[];
export const OFFICERS = officersJson as unknown as OfficerDef[];
export const UNIT_TYPES = unitTypesJson as unknown as UnitTypeDef[];
export const INSTITUTIONS = institutionsJson as unknown as InstitutionDef[];
export const EVENTS = eventsJson as unknown as EventDef[];
export const SCENARIOS = [scenario642, scenario551] as unknown as ScenarioDef[];

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

/** 해당 연도에 활동 중인 인물 */
export function officersAliveIn(year: number): OfficerDef[] {
  return OFFICERS.filter((o) => o.birth + 15 <= year && o.death >= year);
}

export const PLAYABLE_FACTIONS = FACTIONS.filter((f) => f.playable);
