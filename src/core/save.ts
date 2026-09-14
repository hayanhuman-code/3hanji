/**
 * save.ts — 저장/로드 (시스템 상세계획 §3.7)
 *
 * gameState 는 순수한 값들로만 이루어져 있으므로 JSON 직렬화가 곧 세이브다.
 * 웹에서는 localStorage + 파일 다운로드/업로드를 함께 지원한다.
 */

import { STATE_VERSION } from './state';
import type { GameState } from './types';

const STORAGE_KEY = 'samhanji.save';
const AUTOSAVE_KEY = 'samhanji.autosave';

export interface SaveEnvelope {
  format: 'samhanji-save';
  version: number;
  savedAt: string;
  state: GameState;
}

export function serialize(state: GameState): string {
  const env: SaveEnvelope = {
    format: 'samhanji-save',
    version: STATE_VERSION,
    savedAt: new Date().toISOString(),
    state,
  };
  return JSON.stringify(env);
}

/**
 * 지원하는 가장 오래된 세이브 형식. 이보다 낮으면 변환 규칙이 없다.
 */
export const MIN_SAVE_VERSION = 1;

/**
 * 구버전 상태를 현재 형식으로 올린다.
 *
 * **덧붙이기만 한다.** 값을 고쳐 쓰기 시작하면 「옛 세이브를 열었더니 다른
 * 게임이 되어 있다」가 되므로, 없는 필드를 채우는 일만 한다.
 * v2 인 상태는 한 글자도 건드리지 않는다(직렬화 왕복이 동일해야 한다).
 */
function migrate(state: GameState, from: number): GameState {
  if (from < 2) {
    // v1 에는 구조화 사건과 관전자 플래그가 없었다.
    state.events = [];
    state.nextEventId = 1;
    state.spectator = false;
    state.version = 2;
  }
  return state;
}

/**
 * 상태의 꼴이 맞는지 본다.
 *
 * 세이브가 깨졌거나 남의 JSON 이어도 예전에는 그대로 GameState 로 간주해
 * 첫 턴에 알 수 없는 자리에서 터졌다. **틀린 세이브를 정상으로 여기지 않는다.**
 */
function isGameStateLike(v: unknown): v is GameState {
  if (!v || typeof v !== 'object') return false;
  const s = v as Partial<GameState>;
  const rec = (x: unknown) => !!x && typeof x === 'object' && !Array.isArray(x);
  return (
    typeof s.scenarioId === 'string' &&
    typeof s.playerFaction === 'string' &&
    typeof s.turn === 'number' &&
    typeof s.year === 'number' &&
    typeof s.rng === 'number' &&
    rec(s.factions) &&
    rec(s.castles) &&
    rec(s.officers) &&
    rec(s.armies) &&
    rec(s.relations) &&
    Array.isArray(s.log) &&
    Array.isArray(s.chronicle)
  );
}

export function deserialize(text: string): GameState {
  const parsed = JSON.parse(text) as SaveEnvelope | GameState;
  if (parsed && typeof parsed === 'object' && 'format' in parsed && parsed.format === 'samhanji-save') {
    const version = (parsed as SaveEnvelope).version;
    if (typeof version !== 'number' || version < MIN_SAVE_VERSION || version > STATE_VERSION) {
      throw new Error(
        `세이브 버전이 다릅니다. (세이브 v${version} / 게임 v${STATE_VERSION})`
      );
    }
    const state = (parsed as SaveEnvelope).state;
    if (!isGameStateLike(state)) throw new Error('세이브 내용이 손상되었습니다.');
    return migrate(state, version);
  }
  // 봉투 없이 상태만 있는 형식도 받아준다 — 다만 꼴은 확인한다.
  if (!isGameStateLike(parsed)) throw new Error('세이브 파일이 아닙니다.');
  return migrate(parsed, typeof parsed.version === 'number' ? parsed.version : 1);
}

/* ------------------------------- 브라우저 ------------------------------- */

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function saveToStorage(state: GameState, slot: 'manual' | 'auto' = 'manual'): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(slot === 'auto' ? AUTOSAVE_KEY : STORAGE_KEY, serialize(state));
    return true;
  } catch {
    return false;
  }
}

export function loadFromStorage(slot: 'manual' | 'auto' = 'manual'): GameState | null {
  const s = storage();
  if (!s) return null;
  const text = s.getItem(slot === 'auto' ? AUTOSAVE_KEY : STORAGE_KEY);
  if (!text) return null;
  try {
    return deserialize(text);
  } catch {
    return null;
  }
}

export function hasSave(slot: 'manual' | 'auto' = 'manual'): boolean {
  const s = storage();
  return !!s?.getItem(slot === 'auto' ? AUTOSAVE_KEY : STORAGE_KEY);
}

export function clearSave(slot: 'manual' | 'auto' = 'manual'): void {
  storage()?.removeItem(slot === 'auto' ? AUTOSAVE_KEY : STORAGE_KEY);
}

/** 세이브 파일 내려받기 */
export function downloadSave(state: GameState): void {
  const blob = new Blob([serialize(state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `samhanji-${state.scenarioId}-${state.year}년${['봄', '여름', '가을', '겨울'][state.season]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 세이브 파일 읽기 */
export async function readSaveFile(file: File): Promise<GameState> {
  const text = await file.text();
  return deserialize(text);
}
