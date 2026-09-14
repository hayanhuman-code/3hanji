/**
 * naval.ts — 수군에 관한 단 하나의 규칙.
 *
 * 수군은 두 층에 걸쳐 있어 규칙이 갈라지기 쉬웠다. 실제로 갈라져 있었다.
 *
 *   · 이동(전략)  — 부대에 수군 **병종**이 있는가만 봤다
 *   · 전투(전장)  — 출진 부대는 무조건 육상으로 섰다. 수군 편성이 아예 없었다
 *   · 화면        — 둘 중 무엇도 보여 주지 않았다
 *
 * 그래서 백제의 수군 3,000을 실어 상륙을 강행한 군대가, 막상 상륙지에서는
 * 물에서 힘을 못 쓰는 보병으로 싸웠다.
 *
 * 규칙을 여기 한 곳에 둔다. **배를 띄우는 것과 수전을 치르는 것은 다른
 * 조건이다** (전투 기획서 §3.4).
 *
 *   · 항로 통행 — 수군 **병종**이 있으면 된다. 배가 있으면 건넌다.
 *   · 수군 편성 — 그 배를 이끌 `naval` 적성 **장수**가 있어야 한다.
 *                 없으면 병력은 배에 타고 갈 뿐, 싸울 때는 육상 부대다.
 */

import { officerDef, unitDef } from './data';
import type { OfficerId, UnitStack } from './types';

export interface NavalPlan {
  /** 수군 병종의 병력 */
  navyTroops: number;
  /** 그 수군을 이끌 수 있는 장수 (없으면 빈 배열) */
  leaders: OfficerId[];
  /** 배는 있으나 이끌 사람이 없다 — 탑승만 가능 */
  boardOnly: boolean;
}

/** 이 병종이 수군인가 */
export function isNavyUnit(unitType: string): boolean {
  try {
    return unitDef(unitType).class === 'navy';
  } catch {
    return false;
  }
}

/**
 * 이 편성이 수군으로 무엇을 할 수 있는가.
 *
 * 화면·이동 검증·전투 생성이 모두 이 답을 쓴다.
 */
export function navalPlan(
  units: readonly UnitStack[] | undefined,
  officers: readonly OfficerId[] = []
): NavalPlan {
  const navyTroops = (units ?? [])
    .filter((u) => u.count > 0 && isNavyUnit(u.unitType))
    .reduce((a, u) => a + u.count, 0);
  const leaders = officers.filter((id) => {
    try {
      return officerDef(id).naval;
    } catch {
      return false;
    }
  });
  return {
    navyTroops,
    leaders: navyTroops > 0 ? leaders : [],
    boardOnly: navyTroops > 0 && leaders.length === 0,
  };
}

/**
 * 적이 지키는 항로로 배를 댈 수 있는가 (상륙 강행).
 *
 * **배를 보는 조건이지 장수를 보는 조건이 아니다.** 수군 적성 장수까지
 * 요구하면 642년 판에서 상륙 강행이 사실상 사라진다(백제의 수군 장수가
 * 한 명뿐이다). 배가 없으면 못 건너는 것과, 배는 있으나 수전을 못 하는
 * 것은 다른 이야기다 — 후자는 전장에서 갚는다.
 */
export function canSail(units: readonly UnitStack[] | undefined): boolean {
  return navalPlan(units).navyTroops > 0;
}
