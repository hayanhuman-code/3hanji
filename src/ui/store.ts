/**
 * store.ts — UI 상태 저장소 (Zustand)
 *
 * 게임 코어는 GameState 를 제자리에서 고치는 명령형 API 다.
 * 여기서는 코어를 호출한 뒤 revision 을 올려 구독자에게 알린다.
 * (코어를 순수 함수로 유지하면서 매 턴 전체를 복사하는 비용을 피하기 위한 절충)
 */

import { create } from 'zustand';
import type { BattleResult, BattleState } from '../core/battle/battleState';
import { createBattle } from '../core/battle/battleState';
import {
  attackUnit as coreAttackUnit,
  attackWall as coreAttackWall,
  endSideTurn,
  runAITurn,
  runBattleToEnd,
  moveUnit as coreMoveUnit,
  withdraw as coreWithdraw,
} from '../core/battle/battleEngine';
import { applyDomesticCommand, validateCommand } from '../core/domestic';
import { applyDiplomacy, validateDiplomacy } from '../core/diplomacy';
import { applyMarch, validateMarch } from '../core/military';
import { RngCursor } from '../core/rng';
import { createGame, type NewGameConfig } from '../core/state';
import { loadFromStorage, saveToStorage } from '../core/save';
import { beginNextTurn, completeBattle, completeEvent, resolveTurn } from '../core/turn';
import type { EventDef, Command, GameState, PendingEvent, CastleId } from '../core/types';
import type { Axial } from '../core/battle/hex';

export type Screen = 'title' | 'game' | 'sandbox' | 'field';
export type SidePanel = 'castle' | 'officers' | 'diplomacy' | 'institutions' | 'chronicle';

interface EventPrompt {
  pending: PendingEvent;
  def: EventDef;
}

interface Store {
  screen: Screen;
  revision: number;
  state: GameState | null;
  battle: BattleState | null;
  /** 전투가 전략 턴의 일부인가(true) 단독 시뮬레이터인가(false) */
  battleIsLive: boolean;
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

  startSandbox: (battle: BattleState) => void;
  battleMove: (unitId: string, to: Axial) => void;
  battleAttack: (unitId: string, targetId: string) => void;
  battleAttackWall: (unitId: string, target: Axial) => void;
  battleEndTurn: () => void;
  battleDelegate: () => void;
  battleWithdraw: () => void;
  battleFinish: () => void;
}

export const useGame = create<Store>((set, get) => {
  /** 코어를 건드린 뒤 구독자에게 알린다. */
  const touch = () => set((s) => ({ revision: s.revision + 1 }));

  /**
   * 플레이어 차례가 될 때까지(또는 전투가 끝날 때까지) AI 를 진행시킨다.
   * 수비 측으로 붙는 전투는 적 차례로 시작하므로, 이걸 하지 않으면 화면이 멈춘 채로 있게 된다.
   */
  const advanceToPlayer = (b: BattleState) => {
    let guard = 0;
    while (!b.finished && b.playerSide && b.activeSide !== b.playerSide && guard++ < 100) {
      runAITurn(b);
    }
  };

  /** 턴 처리를 진행하다 UI 가 필요한 지점에서 멈춘다. */
  const drive = () => {
    const state = get().state;
    if (!state) return;
    for (;;) {
      const step = resolveTurn(state);
      if (step.kind === 'battle') {
        const b = createBattle(step.setup);
        advanceToPlayer(b);
        set({ battle: b, battleIsLive: true, busy: false });
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
    battle: null,
    battleIsLive: false,
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
        battle: null,
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
        battle: null,
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

    /* ------------------------------ 전투 ------------------------------ */

    startSandbox: (battle) => {
      advanceToPlayer(battle);
      set({ battle, battleIsLive: false, screen: 'sandbox' });
      touch();
    },

    battleMove: (unitId, to) => {
      const b = get().battle;
      if (!b) return;
      coreMoveUnit(b, unitId, to);
      touch();
    },

    battleAttack: (unitId, targetId) => {
      const b = get().battle;
      if (!b) return;
      coreAttackUnit(b, unitId, targetId);
      touch();
    },

    battleAttackWall: (unitId, target) => {
      const b = get().battle;
      if (!b) return;
      coreAttackWall(b, unitId, target);
      touch();
    },

    battleEndTurn: () => {
      const b = get().battle;
      if (!b || b.finished) return;
      endSideTurn(b);
      // 플레이어 차례가 다시 올 때까지 AI 를 돌린다.
      let guard = 0;
      while (!b.finished && b.activeSide !== b.playerSide && guard++ < 100) {
        runAITurn(b);
      }
      touch();
    },

    battleDelegate: () => {
      const b = get().battle;
      if (!b) return;
      runBattleToEnd(b);
      touch();
    },

    battleWithdraw: () => {
      const b = get().battle;
      if (!b || !b.playerSide) return;
      coreWithdraw(b, b.playerSide);
      touch();
    },

    battleFinish: () => {
      const { battle, state, battleIsLive } = get();
      if (!battle?.result) return;
      if (!battleIsLive || !state) {
        set({ battle: null, screen: battleIsLive ? 'game' : 'title' });
        touch();
        return;
      }
      completeBattle(state, battle.result as BattleResult);
      set({ battle: null, busy: true });
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
