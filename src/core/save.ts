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

export function deserialize(text: string): GameState {
  const parsed = JSON.parse(text) as SaveEnvelope | GameState;
  if ('format' in parsed && parsed.format === 'samhanji-save') {
    if (parsed.version !== STATE_VERSION) {
      throw new Error(
        `세이브 버전이 다릅니다. (세이브 v${parsed.version} / 게임 v${STATE_VERSION})`
      );
    }
    return parsed.state;
  }
  // 봉투 없이 상태만 있는 형식도 받아준다.
  return parsed as GameState;
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
