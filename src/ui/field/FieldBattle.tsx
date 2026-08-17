/**
 * FieldBattle.tsx — 전략 턴 안에서 벌어지는 전투.
 *
 * 화면 자체는 FieldPlay 가 전부 그린다. 여기서 하는 일은 셋뿐이다.
 *   1. 저장소의 판과 게임 상태를 이어 준다
 *   2. 이 전투에서 플레이어가 어느 쪽인지 판별한다
 *   3. 끝나면 결과를 전략맵으로 돌려보낸다
 */

import { fieldStats } from '../../core/field/bridge';
import type { Tier } from '../../core/field/types';
import type { Troop } from '../../core/types';
import { useGame } from '../store';
import { FieldPlay } from './FieldPlay';

const TIER1: Record<Troop, Tier> = { inf: 1, cav: 1, arc: 1, str: 1 };

export function FieldBattle() {
  const field = useGame((s) => s.field);
  const state = useGame((s) => s.state);
  const fieldTouch = useGame((s) => s.fieldTouch);
  const fieldSettle = useGame((s) => s.fieldSettle);
  const fieldFinish = useGame((s) => s.fieldFinish);
  const notify = useGame((s) => s.notify);
  if (!field || !state) return null;

  const statsOf = fieldStats(state);
  const side = field.playerSide;
  // 계략 조건은 **내 나라의** 병종 단계로 잰다
  const myFaction = side === 'attacker' ? field.attackerFaction : field.defenderFaction;
  const tiers = state.factions[myFaction]?.troopTiers ?? TIER1;

  return (
    <FieldPlay
      state={field}
      statsOf={statsOf}
      intOf={(id) => statsOf(id).int}
      side={side}
      tiers={tiers}
      onTouch={fieldTouch}
      onSettle={fieldSettle}
      finishLabel="전략으로 돌아간다"
      onFinish={fieldFinish}
      notify={notify}
    />
  );
}
