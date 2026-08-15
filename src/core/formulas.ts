/**
 * formulas.ts — 게임의 모든 수치 계산이 모이는 단 하나의 파일.
 *
 * 시스템 상세계획 §3.2 / §7 원칙:
 *   "밸런싱 변수는 전부 데이터와 formulas.ts 에 있으므로,
 *    테스트→수정 사이클을 코드 재작성 없이 반복한다."
 *
 * 그러므로 이 파일 밖에서는 마법의 숫자(magic number)를 쓰지 않는다.
 * 수치를 바꿀 때는 CHANGELOG.md 에 이유를 남긴다.
 */

import type {
  CastleDef,
  CastleState,
  DevKey,
  FactionState,
  HexTerrain,
  OfficerDef,
  Season,
  UnitTypeDef,
} from './types';
import { clamp } from './util';

/* ================================================================== *
 * B — 밸런스 상수 테이블
 * ================================================================== */

export const B = {
  /* --- 경제 --- */
  /** 농업 개발도 1당 계절 곡물 산출 */
  grainPerAgri: 20,
  /** 상업 개발도 1당 계절 재화 산출 */
  goldPerCommerce: 8,
  /** 거점당 기본 철 산출 */
  ironBase: 20,
  /** (상업+병영) 개발도 1당 철 산출 */
  ironPerDev: 0.15,
  /** 광산 거점 철 배율 */
  ironMineMultiplier: 3,
  /** 특산 거점 보정 */
  granaryBonus: 1.25,
  tradeHubBonus: 1.25,
  /** 도성 보정 */
  capitalIncomeBonus: 1.15,

  /** 계절별 곡물 산출 배율 (봄·여름·가을·겨울) */
  seasonGrain: [0.5, 0.6, 2.3, 0.3] as const,
  /** 계절별 병량 소모 배율 */
  seasonUpkeep: [1.0, 1.0, 1.0, 1.5] as const,

  /** 주둔군 1명당 계절 병량 소모 */
  grainPerTroop: 0.05,
  /** 출진 중인 군대의 병량 소모 배율 */
  fieldUpkeepMultiplier: 1.6,
  /** 민심이 수입에 미치는 영향 (0.5 ~ 1.2) */
  loyaltyIncomeFloor: 0.5,
  loyaltyIncomeSpan: 0.7,

  /* --- 내정 명령 --- */
  developBase: 9,
  /** 개발 1회 비용 (재화) */
  developCost: 220,
  /** 개발도가 상한에 가까울수록 체감 */
  developDiminish: 0.55,

  trainBase: 9,
  trainCost: 90,
  patrolBase: 8,
  patrolCost: 70,
  searchCost: 150,

  /** 병영 개발도 1당 수용 병력 */
  troopsPerBarracks: 220,
  /** 징병 1000명당 민심 감소 */
  conscriptLoyaltyCost: 1.6,
  /** 징병으로 들어온 신병의 훈련도 */
  recruitTraining: 20,
  recruitMorale: 55,
  /** 한 번에 징병 가능한 최대치 */
  conscriptMax: 8000,

  /* --- 병량 비축(농성) --- */
  /** 거점 비축 상한 = 농업 개발도 × 계수 */
  stockPerAgri: 60,
  /** 매 턴 자동 비축 비율 (수입 곡물 중) */
  stockFillRatio: 0.25,

  /* --- 인물 --- */
  /** 등용 성공 기준선 */
  recruitDC: 55,
  /** 탐색 1회 인재 발견 기준 */
  searchDC: 60,
  /** 충성도가 이 아래면 배신 판정 */
  defectThreshold: 40,

  /* --- 전투 --- */
  /** 데미지 기본 계수 */
  damageScale: 0.28,
  /** 사기 계수 하한/폭 */
  moraleFloor: 0.6,
  moraleSpan: 0.5,
  /** 훈련도 계수 하한/폭 */
  trainingFloor: 0.7,
  trainingSpan: 0.4,
  /** 지휘관 보정 하한/폭 */
  commandFloor: 0.8,
  commandSpan: 0.4,
  /** 사기가 이 아래로 떨어지면 붕괴(퇴각) */
  routMorale: 15,
  /** 피해량에 비례한 사기 감소 계수 */
  moraleLossScale: 45,
  moraleLossCap: 22,
  /** 전투 최대 라운드 (초과 시 공격 측 실패) */
  maxBattleTurns: 30,
  /** 성벽 HP = 이 값 + 성곽 개발도 × 계수 */
  wallHpBase: 200,
  wallHpPerWall: 20,
  /** 공성병기의 성벽 피해 계수 */
  siegeWallDamage: 0.15,
  /** 일반 병종이 성벽에 주는 피해 계수 */
  normalWallDamage: 0.015,
  /** 산성 방어 보정 */
  mountainFortressBonus: 1.3,
  /** 성벽 위 방어 보정 */
  wallDefenseBonus: 1.5,
  /** 도하 중 피격 시 추가 피해 (살수대첩 재현) */
  riverAmbushMultiplier: 2.0,

  /* --- 포위전 --- */
  /** 포위 1턴당 수비 측 비축 병량 소모 배율 */
  siegeStockDrain: 2.5,
  /** 병량이 떨어진 성의 턴당 사기·병력 감소율 */
  starvationTroopLoss: 0.08,
  starvationMoraleLoss: 12,

  /* --- 외교 --- */
  allianceDC: 55,
  peaceDC: 45,
  tributeCauseGain: 12,
  tributeAutonomyLoss: 8,
  tributeGoldCost: 600,
  /** 복속 요구 판정 기준선 */
  vassalDC: 55,
  /** 복속을 요구하려면 상대의 이 배 이상을 가지고 있어야 한다 */
  vassalCastleRatio: 2.0,
  /** 복속 요구에 드는 명분 */
  vassalCauseCost: 10,
  /** 조공국이 매 턴 종주국에 바치는 재화 비율 */
  vassalTributeRatio: 0.15,
  /** 선전포고에 드는 명분 */
  declareCauseCost: 15,
  /** 동맹 파기 시 우호도·명분 페널티 */
  breakTrustPenalty: 45,
  breakCausePenalty: 20,
  /** 사절 파견 비용 */
  envoyCost: 200,
  giftTrustPerGold: 0.02,

  /* --- 귀족회의 --- */
  councilDriftPerTurn: 1.5,
  /** 지지도가 이 아래면 정변 위험 */
  coupThreshold: 25,
  coupChancePerTurn: 0.12,

  /* --- 민심 --- */
  loyaltyDriftToward: 55,
  loyaltyDriftRate: 0.06,
  /** 점령 직후 민심 */
  conqueredLoyalty: 25,

  /* --- AI --- */
  /** 이 배율 이상이면 강공 */
  aiMinAttackRatio: 1.35,
  /** 강공은 무리지만 포위는 걸 만한 배율 */
  aiMinSiegeRatio: 0.55,
  aiReserveGrainTurns: 3,
} as const;

/* ================================================================== *
 * 특기 (skills)
 * ================================================================== */

export const SKILLS: Record<string, { name: string; desc: string }> = {
  cav: { name: '기병', desc: '기병 계열 공격력 +15%' },
  archery: { name: '궁술', desc: '궁병 계열 공격력 +15%, 사거리 +1' },
  naval: { name: '수군', desc: '수군 +20%, 도하 페널티 면제' },
  siegecraft: { name: '공성', desc: '성벽 피해 +35%' },
  fortify: { name: '축성', desc: '수비 시 성벽 방어 +25%, 성곽 개발 +50%' },
  oratory: { name: '변설', desc: '외교·등용 판정 +15' },
  medicine: { name: '의술', desc: '전투 후 병력 회복 +8%' },
  flood_attack: { name: '수공', desc: '강·갯벌 지형 공격 +30% (여름 +10% 추가)' },
  scheme: { name: '계략', desc: '내응·첩보 성공률 +20%' },
  forced_march: { name: '강행', desc: '전략 이동 2거점/턴' },
  intimidate: { name: '위압', desc: '적 사기 감소 +50%' },
  autocrat: { name: '독재', desc: '귀족회의 판정 무시, 민심 -3/턴' },
  trade: { name: '교역', desc: '배치 거점 상업 수입 +25%' },
  buddhism: { name: '불교', desc: '배치 거점 민심 +2/턴' },
  hwarang: { name: '화랑', desc: '탐색 시 성장형 인재 발견 확률 증가' },
  unify: { name: '통합', desc: '아군 전 부대 사기 +10' },
  foresight: { name: '혜안', desc: '다가올 이벤트를 미리 본다' },
  resolve: { name: '결사', desc: '병력 열세일수록 전군 공격력 상승 (최대 +40%)' },
  tang_diplomacy: { name: '대당외교', desc: '중국 왕조 상대 외교 판정 +25' },
  culture: { name: '문예', desc: '배치 거점 민심 +3/턴, 등용 판정 +10' },
};

/**
 * 지휘 계산에 필요한 최소 정보.
 * OfficerDef 는 구조적으로 이 타입을 만족하며, 전투 모듈은 전략 모듈을 몰라도
 * 이 형태의 값만 넘기면 된다(단독 실행 요건).
 */
export interface CommanderLike {
  stats: OfficerDef['stats'];
  skills: string[];
}

export function hasSkill(def: CommanderLike | undefined, skill: string): boolean {
  return !!def && def.skills.includes(skill);
}

/* ================================================================== *
 * 계절
 * ================================================================== */

/** 겨울에는 압록강이 얼어 도하 페널티가 사라진다. */
export function riversFrozen(season: Season): boolean {
  return season === 3;
}

/** 여름 장마 — 수공 보정 */
export function isRainySeason(season: Season): boolean {
  return season === 1;
}

/* ================================================================== *
 * 내정
 * ================================================================== */

/** 민심이 수입·개발에 미치는 계수 (0.5 ~ 1.2) */
export function loyaltyFactor(loyalty: number): number {
  return B.loyaltyIncomeFloor + (clamp(loyalty, 0, 100) / 100) * B.loyaltyIncomeSpan;
}

/** 개발 명령 1회의 개발도 증가량 */
export function developGain(
  officer: CommanderLike,
  castle: CastleState,
  def: CastleDef,
  key: DevKey
): number {
  const cur = castle.dev[key];
  const max = def.maxDev[key];
  if (cur >= max) return 0;
  // 상한에 가까울수록 체감한다.
  const room = (max - cur) / Math.max(1, max);
  const diminish = B.developDiminish + (1 - B.developDiminish) * room;
  // 성곽은 축성 특기, 그 외는 정치가 주 능력.
  const skillBonus = key === 'wall' && hasSkill(officer, 'fortify') ? 1.5 : 1;
  const gain =
    B.developBase * (officer.stats.pol / 100) * loyaltyFactor(castle.loyalty) * diminish * skillBonus;
  return Math.min(max - cur, Math.max(1, gain));
}

/** 훈련 명령 1회의 훈련도 증가량 */
export function trainGain(officer: CommanderLike, castle: CastleState): number {
  const room = (100 - castle.training) / 100;
  return B.trainBase * (officer.stats.lead / 100) * (0.4 + 0.6 * room);
}

/** 순찰 명령 1회의 민심 증가량 */
export function patrolGain(officer: CommanderLike, castle: CastleState): number {
  const room = (100 - castle.loyalty) / 100;
  return B.patrolBase * (officer.stats.chr / 100) * (0.4 + 0.6 * room);
}

/** 탐색 성공 판정값 (0~100). 난수와 비교한다. */
export function searchScore(officer: CommanderLike): number {
  return officer.stats.int * 0.5 + officer.stats.chr * 0.5;
}

/** 거점의 최대 주둔 병력 */
export function maxTroops(castle: CastleState): number {
  return Math.round(castle.dev.barracks * B.troopsPerBarracks);
}

/** 거점 비축 병량 상한 */
export function maxStock(castle: CastleState): number {
  return Math.round(castle.dev.agri * B.stockPerAgri);
}

/** 징병 1명당 비용 */
export function conscriptCost(
  unit: UnitTypeDef,
  amount: number,
  traits: readonly string[] = []
): { gold: number; iron: number } {
  // 중장기병을 국가의 뼈대로 삼은 세력은 기병을 더 싸게 기른다.
  const discount =
    traits.includes('heavy_cavalry') && unit.class === 'cavalry' && unit.faction !== null ? 0.85 : 1;
  return {
    gold: Math.round((unit.cost.gold * amount * discount) / 1000),
    iron: Math.round((unit.cost.iron * amount * discount) / 1000),
  };
}

/* ================================================================== *
 * 수입·소모
 * ================================================================== */

export interface CastleIncome {
  grain: number;
  gold: number;
  iron: number;
}

/**
 * 세력 고유 특성(factions.json 의 traits)이 수치에 미치는 영향.
 * 기획서 §2.1 의 "고유 강점" 표를 실제 계산으로 옮긴 자리다.
 */
export const TRAITS: Record<string, string> = {
  conquest_state: '정복 국가 — 점령 직후 민심 하락이 덜하다',
  heavy_cavalry: '중장기병 — 자국 기병 계열 징병 비용 -15%',
  frontier_defense: '변경 방어 — 산성 등급 거점의 성벽 방어 +10%',
  maritime_trade: '해상 교역 — 항구 거점 상업 수입 +15%',
  dual_diplomacy: '이중 외교 — 외교 판정 +8',
  wa_alliance: '왜와의 동맹 — 항구 거점 병력 회복 보정',
  hwarang: '화랑도 — 탐색으로 성장형 인재를 얻는다',
  diplomacy_flex: '외교 유연성 — 화평·동맹 판정 +10',
  capital_defense: '도성 방어 — 도성 방어력 +25%',
  iron_monopoly: '철 독점 — 철 산출 +50%',
  confederacy: '연맹체 — 중앙집권 불가',
};

export function castleIncome(
  castle: CastleState,
  def: CastleDef,
  season: Season,
  opts: { tradeOfficer?: boolean; taxBonus?: number; traits?: readonly string[] } = {}
): CastleIncome {
  const lf = loyaltyFactor(castle.loyalty);
  const capital = def.type === 'capital' ? B.capitalIncomeBonus : 1;
  const tax = 1 + (opts.taxBonus ?? 0);

  let grain = castle.dev.agri * B.grainPerAgri * lf * B.seasonGrain[season] * capital * tax;
  if (def.special === 'granary') grain *= B.granaryBonus;

  let gold = castle.dev.commerce * B.goldPerCommerce * lf * capital * tax;
  if (def.special === 'trade_hub') gold *= B.tradeHubBonus;
  if (opts.tradeOfficer) gold *= 1.25;
  // 해상 교역 국가(백제)는 항구에서 더 번다.
  if (def.type === 'port' && opts.traits?.includes('maritime_trade')) gold *= 1.15;

  let iron = B.ironBase + (castle.dev.commerce + castle.dev.barracks) * B.ironPerDev;
  if (def.special === 'iron_mine') iron *= B.ironMineMultiplier;
  if (opts.traits?.includes('iron_monopoly')) iron *= 1.5;

  return { grain: Math.round(grain), gold: Math.round(gold), iron: Math.round(iron) };
}

/** 주둔 병력의 계절 병량 소모 */
export function garrisonUpkeep(troops: number, season: Season): number {
  return Math.round(troops * B.grainPerTroop * B.seasonUpkeep[season]);
}

/** 출진 부대의 계절 병량 소모 */
export function fieldUpkeep(troops: number, season: Season): number {
  return Math.round(troops * B.grainPerTroop * B.seasonUpkeep[season] * B.fieldUpkeepMultiplier);
}

/* ================================================================== *
 * 전투
 * ================================================================== */

export function moraleFactor(morale: number): number {
  return B.moraleFloor + (clamp(morale, 0, 100) / 100) * B.moraleSpan;
}

export function trainingFactor(training: number): number {
  return B.trainingFloor + (clamp(training, 0, 100) / 100) * B.trainingSpan;
}

/** 공격 지휘관 보정 */
export function attackCommandFactor(o: CommanderLike | undefined): number {
  if (!o) return 1;
  const v = o.stats.lead * 0.6 + o.stats.war * 0.4;
  return B.commandFloor + (v / 100) * B.commandSpan;
}

/** 방어 지휘관 보정 */
export function defenseCommandFactor(o: CommanderLike | undefined): number {
  if (!o) return 1;
  const v = o.stats.lead * 0.6 + o.stats.int * 0.4;
  return B.commandFloor + (v / 100) * B.commandSpan;
}

/** 병종 × 지형 계수 */
export function terrainFactor(unit: UnitTypeDef, terrain: HexTerrain, season: Season): number {
  let f = unit.terrain[terrain] ?? 1;
  // 겨울 결빙 — 강이 평지처럼 굳는다.
  if (terrain === 'river' && riversFrozen(season) && !unit.naval) {
    f = Math.max(f, 0.95);
  }
  return f;
}

/** 병종 상성 배율 */
export function counterFactor(attacker: UnitTypeDef, defender: UnitTypeDef): number {
  return attacker.counters[defender.class] ?? 1;
}

export interface DamageInput {
  attackerCount: number;
  attackerUnit: UnitTypeDef;
  attackerMorale: number;
  attackerTraining: number;
  attackerOfficer?: CommanderLike;
  attackerTerrain: HexTerrain;

  defenderCount: number;
  defenderUnit: UnitTypeDef;
  defenderMorale: number;
  defenderTraining: number;
  defenderOfficer?: CommanderLike;
  defenderTerrain: HexTerrain;

  season: Season;
  /** 방어 측이 성벽 위에 있는가 */
  onWall?: boolean;
  /** 산성 보정을 받는가 */
  mountainFortress?: boolean;
  /** 방어 측이 도하 중인가 (살수대첩 메커니즘) */
  defenderCrossingRiver?: boolean;
  /** 공격 측 열세 비율 (결사 특기용): 아군 총병력 / 적 총병력 */
  attackerForceRatio?: number;
  /** 난수 변동 (0.85~1.15 등) */
  jitter?: number;
}

/** 한 번의 공격이 주는 병력 피해 */
export function computeDamage(i: DamageInput): number {
  const atkUnit = i.attackerUnit;
  const defUnit = i.defenderUnit;

  let atk = atkUnit.attack;
  let def = defUnit.defense;

  // 특기 보정 — 공격 측
  const ao = i.attackerOfficer;
  if (ao) {
    if (hasSkill(ao, 'cav') && atkUnit.class === 'cavalry') atk *= 1.15;
    if (hasSkill(ao, 'archery') && atkUnit.class === 'archer') atk *= 1.15;
    if (hasSkill(ao, 'naval') && atkUnit.class === 'navy') atk *= 1.2;
    if (
      hasSkill(ao, 'flood_attack') &&
      (i.defenderTerrain === 'river' || i.defenderTerrain === 'mudflat')
    ) {
      atk *= isRainySeason(i.season) ? 1.4 : 1.3;
    }
    // 결사 — 열세일수록 강해진다.
    if (hasSkill(ao, 'resolve') && i.attackerForceRatio !== undefined && i.attackerForceRatio < 1) {
      atk *= 1 + Math.min(0.4, (1 - i.attackerForceRatio) * 0.6);
    }
  }

  // 특기 보정 — 방어 측
  const dof = i.defenderOfficer;
  if (dof && hasSkill(dof, 'fortify') && i.onWall) def *= 1.25;

  // 지형
  const atkTerrain = terrainFactor(atkUnit, i.attackerTerrain, i.season);
  const defTerrain = terrainFactor(defUnit, i.defenderTerrain, i.season);

  let defMul = defTerrain;
  if (i.onWall) defMul *= B.wallDefenseBonus;
  if (i.mountainFortress) defMul *= B.mountainFortressBonus;

  const effAtk = atk * atkTerrain * counterFactor(atkUnit, defUnit);
  const effDef = Math.max(1, def * defMul);

  let base =
    i.attackerCount *
    (effAtk / (effAtk + effDef)) *
    B.damageScale *
    moraleFactor(i.attackerMorale) *
    trainingFactor(i.attackerTraining) *
    attackCommandFactor(i.attackerOfficer);

  // 방어 측 지휘 보정으로 경감
  base /= defenseCommandFactor(i.defenderOfficer);
  // 방어 측 사기·훈련도가 낮으면 더 크게 무너진다.
  base /= (moraleFactor(i.defenderMorale) + trainingFactor(i.defenderTraining)) / 2;

  // 도하 중 피격 — 살수대첩
  if (i.defenderCrossingRiver && !defUnit.naval) base *= B.riverAmbushMultiplier;

  base *= i.jitter ?? 1;

  return Math.max(1, Math.min(i.defenderCount, Math.round(base)));
}

/** 피해량에 따른 사기 감소 */
export function moraleLoss(lost: number, before: number, enemyIntimidate = false): number {
  const ratio = lost / Math.max(1, before);
  let v = Math.min(B.moraleLossCap, B.moraleLossScale * ratio);
  if (enemyIntimidate) v *= 1.5;
  return v;
}

/** 성벽 최대 HP */
export function wallHp(wallDev: number): number {
  return Math.round(B.wallHpBase + wallDev * B.wallHpPerWall);
}

/** 성벽에 주는 피해 */
export function wallDamage(count: number, unit: UnitTypeDef, officer?: CommanderLike): number {
  const rate = unit.siege ? B.siegeWallDamage : B.normalWallDamage;
  const skill = hasSkill(officer, 'siegecraft') ? 1.35 : 1;
  return Math.max(1, Math.round(count * rate * skill));
}

/**
 * 부대 전투력 — 자동 전투와 AI 판단에 쓰는 요약 지표.
 * 실제 전술 전투를 돌리지 않고도 대략의 우열을 재기 위한 값.
 */
export function stackPower(
  count: number,
  unit: UnitTypeDef,
  morale: number,
  training: number,
  officer?: CommanderLike
): number {
  return (
    count *
    ((unit.attack + unit.defense) / 2 / 40) *
    moraleFactor(morale) *
    trainingFactor(training) *
    attackCommandFactor(officer)
  );
}

/* ================================================================== *
 * 외교
 * ================================================================== */

/** 외교 제안 성공 판정값. DC 이상이면 성공. */
export function diplomacyScore(
  envoy: CommanderLike,
  trust: number,
  opts: { giftGold?: number; targetIsChina?: boolean } = {}
): number {
  let score = trust * 0.5 + envoy.stats.pol * 0.25 + envoy.stats.chr * 0.25;
  if (hasSkill(envoy, 'oratory')) score += 15;
  if (opts.targetIsChina && hasSkill(envoy, 'tang_diplomacy')) score += 25;
  score += (opts.giftGold ?? 0) * B.giftTrustPerGold;
  return score;
}

/** 등용 성공 판정값 */
export function recruitScore(
  recruiter: CommanderLike,
  target: OfficerDef,
  opts: { sameFactionOrigin?: boolean; captive?: boolean } = {}
): number {
  let score = recruiter.stats.chr * 0.6 + recruiter.stats.pol * 0.2 - target.stats.pol * 0.1;
  if (hasSkill(recruiter, 'oratory')) score += 15;
  if (hasSkill(recruiter, 'culture')) score += 10;
  if (opts.sameFactionOrigin) score += 20;
  // 충의형은 좀처럼 넘어오지 않고, 야심형·용병형은 쉽게 넘어온다.
  switch (target.loyalty_type) {
    case 'loyal':
      score -= opts.captive ? 200 : 25; // 포로가 된 충의형은 등용 불가
      break;
    case 'ambitious':
      score += 5;
      break;
    case 'mercenary':
      score += 20;
      break;
  }
  return score;
}

/* ================================================================== *
 * 세력 종합 지표 (UI·AI 공용)
 * ================================================================== */

export function factionScore(opts: {
  castles: number;
  troops: number;
  gold: number;
  grain: number;
  officers: number;
}): number {
  return (
    opts.castles * 1000 +
    opts.troops * 0.15 +
    opts.gold * 0.05 +
    opts.grain * 0.02 +
    opts.officers * 120
  );
}

/** 귀족회의 판정 — 지지도가 DC 이상이면 통과 */
export function councilPass(f: FactionState, dc: number, hasAutocrat: boolean): boolean {
  if (hasAutocrat) return true;
  return f.councilSupport >= dc;
}
