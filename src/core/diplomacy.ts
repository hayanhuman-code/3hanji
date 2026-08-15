/**
 * diplomacy.ts — 외교 모듈 (시스템 상세계획 §3.5)
 *
 * 관계값 = 우호도(-100~100) + 상태(전쟁/화평/동맹/조공).
 * 대형 결정(선전포고·동맹 파기)은 귀족회의 지지도 판정을 거친다.
 */

import { factionName, officerDef, officerName } from './data';
import { B, councilPass, diplomacyScore } from './formulas';
import type { RngCursor } from './rng';
import {
  addChronicle,
  addLog,
  factionHasSkill,
  getRelation,
} from './state';
import type { DiplomacyCommand, FactionId, GameState } from './types';
import { clamp } from './util';

/** 중국 왕조는 NPC 이므로 실제 세력 객체 없이 이 ID 로만 다룬다. */
export const CHINA_ID = 'china';
export const CHINA_NAME = '중국 왕조';

export function diploTargetName(id: FactionId): string {
  return id === CHINA_ID ? CHINA_NAME : factionName(id);
}

export function validateDiplomacy(state: GameState, cmd: DiplomacyCommand): string | null {
  const f = state.factions[cmd.faction];
  if (!f?.alive) return '멸망한 세력입니다.';

  const envoy = state.officers[cmd.officer];
  if (!envoy || envoy.faction !== cmd.faction || envoy.status !== 'active')
    return '사절로 보낼 인물을 정해야 합니다.';
  if (envoy.acted) return `${officerName(cmd.officer)}은(는) 이번 계절에 이미 움직였습니다.`;
  if (envoy.armyId) return '출진 중인 인물은 사절로 보낼 수 없습니다.';

  if (cmd.action === 'tribute') {
    if (f.resources.gold < B.tributeGoldCost) return '조공에 쓸 재화가 부족합니다.';
    return null;
  }

  if (cmd.to === CHINA_ID) return '중국 왕조에는 조공만 보낼 수 있습니다.';
  const target = state.factions[cmd.to];
  if (!target?.alive) return '없는 세력입니다.';
  if (cmd.to === cmd.faction) return '자기 자신과는 교섭할 수 없습니다.';

  const rel = getRelation(state, cmd.faction, cmd.to);

  switch (cmd.action) {
    case 'declare':
      if (rel.status === 'war') return '이미 전쟁 중입니다.';
      if (rel.truceTurns > 0) return `정전 협정이 ${rel.truceTurns}턴 남았습니다.`;
      if (rel.status === 'tribute') {
        if (rel.overlord === cmd.faction) return '조공을 받는 쪽이 먼저 칠 명분이 없습니다.';
        // 종주국을 치려면 그만큼 힘을 길러야 한다.
        if (countCastles(state, cmd.faction) <= countCastles(state, cmd.to))
          return '아직 종주국에 맞설 힘이 없습니다.';
      }
      if (f.resources.cause < B.declareCauseCost)
        return `명분이 부족합니다. (필요 ${B.declareCauseCost})`;
      if (
        rel.status === 'alliance' &&
        !councilPass(f, 60, factionHasSkill(state, cmd.faction, 'autocrat'))
      )
        return '동맹을 깨는 일에 귀족회의가 반대합니다.';
      return null;
    case 'alliance':
      if (rel.status === 'alliance') return '이미 동맹입니다.';
      if (rel.status === 'war') return '전쟁 중에는 곧바로 동맹할 수 없습니다. 먼저 화평이 필요합니다.';
      if (f.resources.gold < B.envoyCost) return '재화가 부족합니다.';
      return null;
    case 'peace':
      if (rel.status !== 'war') return '전쟁 중이 아닙니다.';
      if (f.resources.gold < B.envoyCost) return '재화가 부족합니다.';
      return null;
    case 'break':
      if (rel.status !== 'alliance' && rel.status !== 'tribute')
        return '동맹도 조공 관계도 아닙니다.';
      return null;
    case 'gift':
      if ((cmd.gold ?? 0) <= 0) return '보낼 재화를 정해야 합니다.';
      if (f.resources.gold < (cmd.gold ?? 0)) return '재화가 부족합니다.';
      return null;
    case 'demand_tribute': {
      if (rel.status === 'tribute') return '이미 조공 관계입니다.';
      const mine = countCastles(state, cmd.faction);
      const theirs = countCastles(state, cmd.to);
      if (theirs === 0) return '이미 무너진 세력입니다.';
      if (mine < theirs * B.vassalCastleRatio)
        return `복속을 요구하려면 상대의 ${B.vassalCastleRatio}배 이상을 차지해야 합니다. (아군 ${mine} / 상대 ${theirs})`;
      if (f.resources.cause < B.vassalCauseCost)
        return `명분이 부족합니다. (필요 ${B.vassalCauseCost})`;
      return null;
    }
    default:
      return null;
  }
}

function countCastles(state: GameState, faction: FactionId): number {
  return Object.values(state.castles).filter((c) => c.owner === faction).length;
}

export function applyDiplomacy(
  state: GameState,
  cmd: DiplomacyCommand,
  rng: RngCursor
): string | null {
  if (validateDiplomacy(state, cmd)) return null;
  const f = state.factions[cmd.faction];
  const envoy = state.officers[cmd.officer];
  envoy.acted = true;
  const envoyDef = officerDef(cmd.officer);

  /* --- 조공 (대중국) --- */
  if (cmd.action === 'tribute') {
    f.resources.gold -= B.tributeGoldCost;
    const score = diplomacyScore(envoyDef, 40, { targetIsChina: true });
    const bonus = score >= 70 ? 1.5 : 1;
    f.resources.cause = clamp(f.resources.cause + B.tributeCauseGain * bonus, 0, 100);
    f.autonomy = clamp(f.autonomy - B.tributeAutonomyLoss, 0, 100);
    // 조공로가 열리면 교역 이익도 따라온다.
    f.resources.gold += Math.round(B.tributeGoldCost * 0.4 * bonus);
    const text = `${envoyDef.name}을(를) ${CHINA_NAME}에 보내 조공했다. (명분 +${Math.round(
      B.tributeCauseGain * bonus
    )}, 자주성 -${B.tributeAutonomyLoss})`;
    addLog(state, cmd.faction, 'diplomacy', text);
    return text;
  }

  const rel = getRelation(state, cmd.faction, cmd.to);
  const targetName = factionName(cmd.to);

  switch (cmd.action) {
    case 'gift': {
      const gold = cmd.gold ?? 0;
      f.resources.gold -= gold;
      const gain = Math.round(gold * B.giftTrustPerGold);
      rel.trust = clamp(rel.trust + gain, -100, 100);
      const text = `${targetName}에 재화 ${gold.toLocaleString()}을(를) 보냈다. (우호도 +${gain})`;
      addLog(state, cmd.faction, 'diplomacy', text);
      return text;
    }

    case 'declare': {
      f.resources.cause -= B.declareCauseCost;
      if (rel.status === 'alliance') {
        rel.trust = clamp(rel.trust - B.breakTrustPenalty, -100, 100);
        f.resources.cause = clamp(f.resources.cause - B.breakCausePenalty, 0, 100);
        f.councilSupport = clamp(f.councilSupport - 10, 0, 100);
      }
      rel.status = 'war';
      rel.trust = Math.min(rel.trust, -40);
      const text = `${targetName}에 선전포고했다.`;
      addLog(state, cmd.faction, 'diplomacy', text);
      addChronicle(state, `${factionName(cmd.faction)}, ${targetName}에 군사를 일으키다.`);
      return text;
    }

    case 'demand_tribute': {
      f.resources.cause -= B.vassalCauseCost;
      const mine = countCastles(state, cmd.faction);
      const theirs = countCastles(state, cmd.to);
      // 힘의 차이가 클수록, 사절이 뛰어날수록 무릎을 꿇린다.
      // 복속 요구는 청이 아니라 위협이다. 우호도보다 힘의 격차가 훨씬 크게 작용한다.
      const gap = Math.min(60, (mine / Math.max(1, theirs) - 1) * 22);
      const score =
        gap * 1.4 +
        (envoyDef.stats.pol + envoyDef.stats.chr) / 8 +
        (envoyDef.skills.includes('oratory') ? 10 : 0) +
        rel.trust * 0.1 +
        f.resources.cause * 0.15 +
        desperationBonus(state, cmd.to, cmd.faction) * 0.5 +
        rng.int(-8, 8);

      if (score >= B.vassalDC) {
        rel.status = 'tribute';
        rel.overlord = cmd.faction;
        rel.truceTurns = 8;
        rel.trust = clamp(rel.trust + 20, -100, 100);
        state.factions[cmd.to].autonomy = clamp(state.factions[cmd.to].autonomy - 40, 0, 100);
        const text = `${targetName}이(가) 조공을 약속하고 신속(臣屬)했다.`;
        addLog(state, cmd.faction, 'diplomacy', text);
        addChronicle(state, `${targetName}, ${factionName(cmd.faction)}에 신속하다.`);
        return text;
      }
      rel.trust = clamp(rel.trust - 12, -100, 100);
      const text = `${targetName}이(가) 복속 요구를 물리쳤다. (판정 ${Math.round(score)} / 필요 ${B.vassalDC})`;
      addLog(state, cmd.faction, 'diplomacy', text);
      return text;
    }

    case 'break': {
      // 조공 관계를 깨는 것은 독립 선언이다.
      if (rel.status === 'tribute') {
        rel.status = 'war';
        rel.overlord = null;
        rel.trust = clamp(rel.trust - 60, -100, 100);
        state.factions[cmd.faction].autonomy = clamp(
          state.factions[cmd.faction].autonomy + 30,
          0,
          100
        );
        const text = `${targetName}에 대한 신속을 끊고 독립을 선언했다.`;
        addLog(state, cmd.faction, 'diplomacy', text);
        addChronicle(state, `${factionName(cmd.faction)}, ${targetName}에서 떨어져 나오다.`);
        return text;
      }
      rel.status = 'peace';
      rel.trust = clamp(rel.trust - B.breakTrustPenalty, -100, 100);
      f.resources.cause = clamp(f.resources.cause - B.breakCausePenalty, 0, 100);
      f.councilSupport = clamp(f.councilSupport - 8, 0, 100);
      const text = `${targetName}와(과)의 동맹을 파기했다.`;
      addLog(state, cmd.faction, 'diplomacy', text);
      return text;
    }

    case 'alliance':
    case 'peace': {
      f.resources.gold -= B.envoyCost;
      const dc = cmd.action === 'alliance' ? B.allianceDC : B.peaceDC;
      const score = diplomacyScore(envoyDef, rel.trust, { giftGold: cmd.gold ?? 0 });
      // 상대가 지고 있을수록 화평을 받아들인다.
      const desperation = desperationBonus(state, cmd.to, cmd.faction);
      const roll = score + desperation + rng.int(-10, 10);

      if (roll >= dc) {
        if (cmd.action === 'alliance') {
          rel.status = 'alliance';
          rel.trust = clamp(Math.max(rel.trust, 40), -100, 100);
        } else {
          rel.status = 'peace';
          rel.truceTurns = 6;
          rel.trust = clamp(rel.trust + 15, -100, 100);
        }
        const text =
          cmd.action === 'alliance'
            ? `${envoyDef.name}의 변설로 ${targetName}와(과) 동맹을 맺었다.`
            : `${targetName}와(과) 화평했다. (정전 6턴)`;
        addLog(state, cmd.faction, 'diplomacy', text);
        addChronicle(
          state,
          cmd.action === 'alliance'
            ? `${factionName(cmd.faction)}·${targetName} 동맹.`
            : `${factionName(cmd.faction)}·${targetName} 화평.`
        );
        return text;
      }

      rel.trust = clamp(rel.trust + 4, -100, 100);
      const text = `${targetName}이(가) ${envoyDef.name}의 제안을 물리쳤다. (판정 ${Math.round(roll)} / 필요 ${dc})`;
      addLog(state, cmd.faction, 'diplomacy', text);
      return text;
    }

    default:
      return null;
  }
}

/**
 * 상대가 궁지에 몰렸을수록 화평·동맹을 받아들이기 쉽다.
 * (전선이 여럿이거나 거점을 잃고 있으면 손을 잡는다.)
 */
function desperationBonus(state: GameState, target: FactionId, proposer: FactionId): number {
  let bonus = 0;
  const wars = Object.keys(state.relations).filter((k) => {
    const [a, b] = k.split('|');
    if (a !== target && b !== target) return false;
    return state.relations[k].status === 'war';
  }).length;
  bonus += (wars - 1) * 12;

  const targetCastles = Object.values(state.castles).filter((c) => c.owner === target).length;
  const proposerCastles = Object.values(state.castles).filter((c) => c.owner === proposer).length;
  if (targetCastles < proposerCastles) bonus += (proposerCastles - targetCastles) * 3;
  return bonus;
}

/** 매 턴 우호도는 서서히 0 으로 수렴한다. 동맹은 조금씩 두터워진다. */
export function driftRelations(state: GameState): void {
  for (const key of Object.keys(state.relations)) {
    const rel = state.relations[key];
    if (rel.status === 'alliance') {
      rel.trust = clamp(rel.trust + 1, -100, 100);
    } else if (rel.status === 'war') {
      rel.trust = clamp(rel.trust - 1, -100, 100);
    } else {
      rel.trust = clamp(rel.trust + (rel.trust > 0 ? -0.5 : 0.5), -100, 100);
    }
  }
}
