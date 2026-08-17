/**
 * store.ts — UI 상태 저장소 (Zustand)
 *
 * 게임 코어는 GameState 를 제자리에서 고치는 명령형 API 다.
 * 여기서는 코어를 호출한 뒤 revision 을 올려 구독자에게 알린다.
 * (코어를 순수 함수로 유지하면서 매 턴 전체를 복사하는 비용을 피하기 위한 절충)
 */

import { create } from 'zustand';
import { fieldStats } from '../core/field/bridge';
import { createField } from '../core/field/setup';
import { runToEnd } from '../core/field/sim';
import type { FieldState } from '../core/field/types';
import { applyDomesticCommand, validateCommand } from '../core/domestic';
import { applyDiplomacy, validateDiplomacy } from '../core/diplomacy';
import { applyMarch, validateMarch } from '../core/military';
import { RngCursor } from '../core/rng';
import { createGame, type NewGameConfig } from '../core/state';
import { loadFromStorage, saveToStorage } from '../core/save';
import { beginNextTurn, completeBattle, completeEvent, resolveTurn } from '../core/turn';
import type { EventDef, Command, GameState, PendingEvent, CastleId } from '../core/types';

export type Screen = 'title' | 'game' | 'field';
export type SidePanel = 'castle' | 'officers' | 'diplomacy' | 'institutions' | 'chronicle';

interface EventPrompt {
  pending: PendingEvent;
  def: EventDef;
}

interface Store {
  screen: Screen;
  revision: number;
  state: GameState | null;
  /**
   * 지금 벌어지고 있는 전장. 전략 턴이 여기서 멈춰 서 있다.
   * (단독 시뮬레이터는 이 자리를 쓰지 않는다 — 제 화면 안에서 판을 만든다)
   */
  field: FieldState | null;
  event: EventPrompt | null;
  showReport: boolean;
  selected: CastleId | null;
  panel: SidePanel;
  message: string | null;
  busy: boolean;

  setScreen: (s: Screen) => void;
  newGame: (config: NewGameConfig) => void;
  loadSaved: () => boolean;
  adoptState: (s: GameState) => void;
  select: (id: CastleId | null) => void;
  setPanel: (p: SidePanel) => void;
  notify: (msg: string | null) => void;

  issue: (cmd: Command) => boolean;
  endTurn: () => void;
  chooseEvent: (index: number) => void;
  closeReport: () => void;

  /** 전장을 한 틱 이상 진행했다고 알린다 (코어가 제자리에서 고치므로) */
  fieldTouch: () => void;
  /** 즉시결판 — 같은 시뮬레이션을 렌더링 없이 끝까지 */
  fieldSettle: () => void;
  /** 결과를 전략맵에 반영하고 지도로 돌아간다 */
  fieldFinish: () => void;
}

export const useGame = create<Store>((set, get) => {
  /** 코어를 건드린 뒤 구독자에게 알린다. */
  const touch = () => set((s) => ({ revision: s.revision + 1 }));

  /** 턴 처리를 진행하다 UI 가 필요한 지점에서 멈춘다. */
  const drive = () => {
    const state = get().state;
    if (!state) return;
    for (;;) {
      const step = resolveTurn(state);
      if (step.kind === 'battle') {
        set({ field: createField(step.setup), busy: false });
        touch();
        return;
      }
      if (step.kind === 'event') {
        set({ event: { pending: step.pending, def: step.def }, busy: false });
        touch();
        return;
      }
      break;
    }
    saveToStorage(state, 'auto');
    set({ showReport: state.phase === 'report', busy: false });
    touch();
  };

  return {
    screen: 'title',
    revision: 0,
    state: null,
    field: null,
    event: null,
    showReport: false,
    selected: null,
    panel: 'castle',
    message: null,
    busy: false,

    setScreen: (screen) => set({ screen }),

    newGame: (config) => {
      const state = createGame(config);
      const first = Object.values(state.castles).find((c) => c.owner === config.playerFaction);
      set({
        state,
        screen: 'game',
        selected: first?.id ?? null,
        panel: 'castle',
        field: null,
        event: null,
        showReport: false,
        message: null,
      });
      saveToStorage(state, 'auto');
      touch();
    },

    loadSaved: () => {
      const state = loadFromStorage('auto') ?? loadFromStorage('manual');
      if (!state) return false;
      get().adoptState(state);
      return true;
    },

    adoptState: (state) => {
      const first = Object.values(state.castles).find((c) => c.owner === state.playerFaction);
      set({
        state,
        screen: 'game',
        selected: first?.id ?? null,
        field: null,
        event: null,
        showReport: state.phase === 'report',
        message: null,
      });
      touch();
    },

    select: (id) => set({ selected: id, panel: 'castle' }),
    setPanel: (panel) => set({ panel }),
    notify: (message) => set({ message }),

    issue: (cmd) => {
      const state = get().state;
      if (!state) return false;
      if (state.phase !== 'command') {
        set({ message: '지금은 명령을 내릴 수 없습니다.' });
        return false;
      }
      const rng = new RngCursor(state.rng);

      let error: string | null = null;
      let text: string | null = null;

      if (cmd.kind === 'march') {
        error = validateMarch(state, cmd);
        if (!error) text = applyMarch(state, cmd);
      } else if (cmd.kind === 'diplomacy') {
        error = validateDiplomacy(state, cmd);
        if (!error) text = applyDiplomacy(state, cmd, rng);
      } else {
        error = validateCommand(state, cmd);
        if (!error) text = applyDomesticCommand(state, cmd, rng);
      }

      state.rng = rng.seed;
      if (error) {
        set({ message: error });
        touch();
        return false;
      }
      if (text) {
        state.log.push({
          turn: state.turn,
          year: state.year,
          season: state.season,
          faction: cmd.faction,
          kind: cmd.kind === 'march' ? 'military' : cmd.kind === 'diplomacy' ? 'diplomacy' : 'domestic',
          text,
        });
      }
      set({ message: text });
      touch();
      return true;
    },

    endTurn: () => {
      const state = get().state;
      if (!state || state.phase !== 'command') return;
      set({ busy: true, message: null });
      // 화면이 "처리 중"을 그릴 틈을 준다.
      setTimeout(drive, 10);
    },

    chooseEvent: (index) => {
      const state = get().state;
      if (!state) return;
      completeEvent(state, index);
      set({ event: null, busy: true });
      setTimeout(drive, 10);
    },

    closeReport: () => {
      const state = get().state;
      if (!state) return;
      beginNextTurn(state);
      set({ showReport: false });
      touch();
    },

    /* ------------------------------ 전장 ------------------------------ */

    fieldTouch: touch,

    fieldSettle: () => {
      const f = get().field;
      const state = get().state;
      if (!f || !state) return;
      runToEnd(f, fieldStats(state));
      touch();
    },

    fieldFinish: () => {
      const { field, state } = get();
      if (!field?.result || !state) return;
      completeBattle(state, field.result);
      set({ field: null, busy: true });
      setTimeout(drive, 10);
    },
  };
});

/** 컴포넌트에서 게임 상태를 안전하게 꺼내는 헬퍼 */
export function useGameState(): GameState {
  const state = useGame((s) => s.state);
  if (!state) throw new Error('게임이 시작되지 않았습니다');
  return state;
}
