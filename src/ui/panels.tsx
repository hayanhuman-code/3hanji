/**
 * panels.tsx — 우측 사이드 패널 (거점 / 인물 / 외교 / 제도 / 연대기)
 *
 * 시스템 상세계획 §4 의 ②③④ 화면에 해당한다. 모달이 아니라 사이드 패널로 둔다.
 */

import { useState } from 'react';
import {
  INSTITUTIONS,
  availableUnits,
  castleDef,
  castleName,
  factionColor,
  factionDef,
  factionName,
  officerDef,
  unitDef,
} from '../core/data';
import { CHINA_ID, CHINA_NAME } from '../core/diplomacy';
import { B, SKILLS, conscriptCost, loyaltyFactor, maxTroops } from '../core/formulas';

import { stockCap, validateCommand } from '../core/domestic';
import { OPEN_SEA_PORTS, seaClosed } from '../core/military';
import { foresightHints } from '../core/events';
import {
  armyTroops,
  availableOfficersAt,
  factionCastles,
  factionOfficers,
  factionTraits,
  getRelation,
  hasInstitution,
} from '../core/state';
import { victoryStatus } from '../core/victory';
import type { Command, DevKey, GameState, OfficerState } from '../core/types';
import { fmt, fmtTroops } from '../core/util';
import { useGame } from './store';

const ROLE_LABEL: Record<string, string> = {
  general: '무장',
  civil: '문관',
  royal: '왕족',
  monk: '승려',
  artisan: '장인',
};

/**
 * 개발 항목 — 한자 한 글자 + 한글 (문서 §7 "한자 1글자를 쓴다").
 * 한자만 두지 않는 이유는 GameScreen 의 Res 와 같다 — 기호만으로 전달하지 않는다.
 */
const DEV_LABEL: Record<DevKey, [mark: string, name: string]> = {
  agri: ['農', '농업'],
  commerce: ['商', '상업'],
  wall: ['郭', '성곽'],
  barracks: ['營', '병영'],
};

/** 거점 지형 */
const TERRAIN_LABEL: Record<string, [string, string]> = {
  plain: ['平', '평야'],
  mountain: ['山', '산악'],
  river: ['河', '강안'],
  coast: ['海', '연안'],
};

const STATUS_LABEL: Record<string, string> = {
  war: '전쟁',
  peace: '화평',
  alliance: '동맹',
  tribute: '조공',
};

/* ------------------------------------------------------------------ *
 * 공통 조각
 * ------------------------------------------------------------------ */

function Bar({ value, max, cap }: { value: number; max: number; cap?: boolean }) {
  return (
    <div className={`bar${cap ? ' cap' : ''}`}>
      <i style={{ width: `${Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100))}%` }} />
    </div>
  );
}

function OfficerChip({
  officer,
  selected,
  onClick,
}: {
  officer: OfficerState;
  selected?: boolean;
  onClick?: () => void;
}) {
  const def = officerDef(officer.id);
  // 이름 옆에 역할을 적어 두면 76 거점에 300명을 흩어 놓아도 누가 무엇을 하는 사람인지 보인다.
  const g = officer.growth ?? {};
  const s = def.stats;
  return (
    <div
      className={`officer-chip${officer.acted ? ' acted' : ''}`}
      style={{
        borderColor: selected ? 'var(--jinsa)' : undefined,
        cursor: onClick ? 'pointer' : 'default',
      }}
      onClick={onClick}
      title={[def.note, def.source && `출전: ${def.source}`].filter(Boolean).join('\n')}
    >
      <div className="portrait">{def.name.slice(0, 1)}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="row between">
          <b>
            {def.name}
            {def.ruler && ' 王'}
          </b>
          <span className="faint" style={{ fontSize: 11 }}>
            {ROLE_LABEL[def.role] ?? ''} · {officer.acted ? '행동함' : officer.armyId ? '출진 중' : '대기'}
          </span>
        </div>
        <div className="stats">
          <span>
            통<b>{s.lead + (g.lead ?? 0)}</b>
          </span>
          <span>
            무<b>{s.war + (g.war ?? 0)}</b>
          </span>
          <span>
            지<b>{s.int + (g.int ?? 0)}</b>
          </span>
          <span>
            정<b>{s.pol + (g.pol ?? 0)}</b>
          </span>
          <span>
            매<b>{s.chr + (g.chr ?? 0)}</b>
          </span>
        </div>
        {def.skills.length > 0 && (
          <div className="faint" style={{ fontSize: 11 }}>
            {def.skills.map((k) => SKILLS[k]?.name ?? k).join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 거점 패널
 * ------------------------------------------------------------------ */

export function CastlePanel({ state, onMarch }: { state: GameState; onMarch: () => void }) {
  const selected = useGame((s) => s.selected);
  const issue = useGame((s) => s.issue);
  const [officer, setOfficer] = useState<string | null>(null);
  const [conscript, setConscript] = useState(false);
  const [unitType, setUnitType] = useState<string>('');
  const [amount, setAmount] = useState(3000);

  if (!selected) return <p className="muted">지도에서 거점을 고르십시오.</p>;
  const castle = state.castles[selected];
  const def = castleDef(selected);
  const mine = castle.owner === state.playerFaction;
  const faction = state.playerFaction;

  const free = mine ? availableOfficersAt(state, selected) : [];
  const active = officer && free.some((o) => o.id === officer) ? officer : free[0]?.id ?? null;
  const units = availableUnits(faction, state.factions[faction].institutions);

  const run = (cmd: Command) => {
    if (issue(cmd)) setConscript(false);
  };

  const typeLabel =
    { capital: '도성', major: '대성', fort: '산성', port: '항구' }[def.type] ?? def.type;

  return (
    <div className="stack">
      <div>
        <div className="castle-head">
          <h2>{def.name}</h2>
          <span className="tag">{typeLabel}</span>
          <span className="faction-badge" style={{ background: factionColor(castle.owner) }}>
            {factionName(castle.owner)}
          </span>
        </div>
        <div className="faint" style={{ fontSize: 12 }}>
          {def.region} · {TERRAIN_LABEL[def.terrain]?.[0]} {TERRAIN_LABEL[def.terrain]?.[1]}
          {def.special === 'siege_defense_bonus' && ' · 농성에 유리한 지세'}
          {def.special === 'iron_mine' && ' · 철 산지'}
          {def.special === 'trade_hub' && ' · 교역 요충'}
          {def.special === 'granary' && ' · 곡창'}
        </div>
        {def.routes.sea.length > 0 && (
          <div className="faint" style={{ fontSize: 11.5 }}>
            뱃길{' '}
            {def.routes.sea.map((id, i) => (
              <span key={id}>
                {i > 0 && ' · '}
                {castleName(id)}
                {seaClosed(def.id, id, state.season) ? (
                  <b style={{ color: 'var(--jinsa)' }}> (겨울 폐쇄)</b>
                ) : OPEN_SEA_PORTS.has(id) || OPEN_SEA_PORTS.has(def.id) ? (
                  <span> (원해)</span>
                ) : null}
              </span>
            ))}
          </div>
        )}
      </div>

      {castle.besiegedBy && (
        <div className="tag" style={{ borderColor: 'var(--jinsa)', color: 'var(--jinsa)' }}>
          {factionName(castle.besiegedBy)}에게 포위된 지 {castle.siegeTurns}계절
        </div>
      )}

      <div>
        {(['agri', 'commerce', 'wall', 'barracks'] as DevKey[]).map((k) => (
          <div className="dev-row" key={k} title={DEV_LABEL[k][1]}>
            <span className="muted">
              <i className="mark">{DEV_LABEL[k][0]}</i> {DEV_LABEL[k][1]}
            </span>
            <Bar value={castle.dev[k]} max={def.maxDev[k]} cap={castle.dev[k] >= def.maxDev[k]} />
            <span className="num faint">
              {Math.round(castle.dev[k])} / {def.maxDev[k]}
            </span>
          </div>
        ))}
      </div>

      <table className="grid">
        <tbody>
          <tr>
            <td>병력</td>
            <td className="n">
              {fmt(castle.troops)} <span className="faint">/ {fmt(maxTroops(castle))}</span>
            </td>
            <td>훈련도</td>
            <td className="n">{Math.round(castle.training)}</td>
          </tr>
          <tr>
            <td>민심</td>
            <td className="n">{Math.round(castle.loyalty)}</td>
            <td>비축 병량</td>
            <td className="n">
              {fmt(castle.stock)}
              <span className="faint"> / {fmt(stockCap(state, faction, selected))}</span>
            </td>
          </tr>
        </tbody>
      </table>

      {castle.composition.length > 0 && (
        <div className="faint" style={{ fontSize: 12 }}>
          {castle.composition.map((u) => `${unitDef(u.unitType).name} ${fmtTroops(u.count)}`).join(' · ')}
        </div>
      )}

      {!mine && <p className="muted">아군 거점이 아닙니다.</p>}

      {mine && (
        <>
          <hr className="sep" />
          <div className="row between">
            <span className="muted" style={{ fontSize: 12 }}>
              명령을 맡길 인물
            </span>
            <span className="faint" style={{ fontSize: 11 }}>
              대기 {free.length}명
            </span>
          </div>
          <div className="stack" style={{ gap: 5 }}>
            {castle.officers.map((id) => {
              const o = state.officers[id];
              if (!o) return null;
              return (
                <OfficerChip
                  key={id}
                  officer={o}
                  selected={active === id}
                  onClick={() => !o.acted && setOfficer(id)}
                />
              );
            })}
            {castle.officers.length === 0 && <p className="faint">이 성에 인물이 없습니다.</p>}
          </div>

          <hr className="sep" />
          <div className="cmd-grid">
            {(['agri', 'commerce', 'wall', 'barracks'] as DevKey[]).map((k) => (
              <button
                key={k}
                className="btn small"
                disabled={!active}
                onClick={() =>
                  active &&
                  run({ kind: 'develop', faction, officer: active, castle: selected, target: k })
                }
              >
                {DEV_LABEL[k]} 개발
              </button>
            ))}
            <button
              className="btn small"
              disabled={!active}
              onClick={() => active && run({ kind: 'train', faction, officer: active, castle: selected })}
            >
              훈련
            </button>
            <button
              className="btn small"
              disabled={!active}
              onClick={() => active && run({ kind: 'patrol', faction, officer: active, castle: selected })}
            >
              순찰
            </button>
            <button
              className="btn small"
              disabled={!active}
              onClick={() => active && run({ kind: 'search', faction, officer: active, castle: selected })}
            >
              탐색
            </button>
            <button
              className="btn small"
              disabled={!active}
              onClick={() =>
                active &&
                run({
                  kind: 'stockpile',
                  faction,
                  officer: active,
                  castle: selected,
                  grain: Math.min(3000, state.factions[faction].resources.grain),
                })
              }
            >
              병량 비축
            </button>
            <button
              className="btn small"
              disabled={!active}
              onClick={() => {
                setConscript((v) => !v);
                if (!unitType) setUnitType(units[0]?.id ?? 'infantry');
              }}
            >
              징병
            </button>
          </div>

          {conscript && active && (
            <div className="stack" style={{ gap: 6, marginTop: 4 }}>
              <select
                className="btn small"
                value={unitType}
                onChange={(e) => setUnitType(e.target.value)}
              >
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} — 공{u.attack} 방{u.defense} 사거리{u.range}
                  </option>
                ))}
              </select>
              <div className="row">
                <input
                  type="range"
                  min={500}
                  max={B.conscriptMax}
                  step={500}
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  style={{ flex: 1 }}
                />
                <span className="num" style={{ width: 62, textAlign: 'right' }}>
                  {fmt(amount)}
                </span>
              </div>
              {unitType && (
                <div className="faint" style={{ fontSize: 12 }}>
                  비용 재화 {fmt(conscriptCost(unitDef(unitType), amount, factionTraits(state, faction)).gold)} · 철{' '}
                  {fmt(conscriptCost(unitDef(unitType), amount, factionTraits(state, faction)).iron)}
                </div>
              )}
              <button
                className="btn primary small"
                onClick={() =>
                  run({
                    kind: 'conscript',
                    faction,
                    officer: active,
                    castle: selected,
                    amount,
                    unitType,
                  })
                }
              >
                징집한다
              </button>
            </div>
          )}

          <button className="btn primary" style={{ marginTop: 4 }} onClick={onMarch}>
            출진
          </button>

          <div className="faint" style={{ fontSize: 11.5 }}>
            수입 보정: 민심 계수 {loyaltyFactor(castle.loyalty).toFixed(2)}
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 인물 패널
 * ------------------------------------------------------------------ */

export function OfficerPanel({ state }: { state: GameState }) {
  const issue = useGame((s) => s.issue);
  const select = useGame((s) => s.select);
  const faction = state.playerFaction;
  const mine = factionOfficers(state, faction);
  const captives = Object.values(state.officers).filter(
    (o) => o.status === 'captured' && o.captor === faction
  );
  const found = Object.values(state.officers).filter(
    (o) =>
      o.status === 'free' &&
      !o.hidden &&
      o.location &&
      state.castles[o.location]?.owner === faction
  );

  return (
    <div className="stack">
      <div className="section-label" style={{ margin: 0 }}>
        휘하 {mine.length}명
      </div>
      {mine.map((o) => (
        <div key={o.id}>
          <OfficerChip officer={o} onClick={() => o.location && select(o.location)} />
          <div className="faint" style={{ fontSize: 11, paddingLeft: 4 }}>
            {o.armyId
              ? `출진 중 (${fmtTroops(armyTroops(state.armies[o.armyId]))})`
              : o.location
                ? castleName(o.location)
                : '—'}{' '}
            · 충성 {Math.round(o.loyalty)}
          </div>
        </div>
      ))}

      {found.length > 0 && (
        <>
          <div className="section-label" style={{ marginBottom: 0 }}>
            재야 — 등용할 수 있다
          </div>
          {found.map((o) => (
            <div key={o.id} className="stack" style={{ gap: 4 }}>
              <OfficerChip officer={o} />
              <div className="row">
                <span className="faint" style={{ fontSize: 11, flex: 1 }}>
                  {o.location ? castleName(o.location) : ''}
                </span>
                {o.location &&
                  availableOfficersAt(state, o.location).slice(0, 1).map((recruiter) => (
                    <button
                      key={recruiter.id}
                      className="btn small"
                      onClick={() =>
                        issue({
                          kind: 'recruit',
                          faction,
                          officer: recruiter.id,
                          castle: o.location!,
                          targetOfficer: o.id,
                        })
                      }
                    >
                      {officerDef(recruiter.id).name}이(가) 청한다
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </>
      )}

      {captives.length > 0 && (
        <>
          <div className="section-label" style={{ marginBottom: 0 }}>
            포로
          </div>
          {captives.map((o) => {
            const def = officerDef(o.id);
            const loyal = def.loyalty_type === 'loyal';
            return (
              <div key={o.id} className="stack" style={{ gap: 4 }}>
                <OfficerChip officer={o} />
                <div className="row">
                  <button
                    className="btn small"
                    disabled={loyal}
                    title={loyal ? '충의로 이름난 자는 항복하지 않는다.' : ''}
                    onClick={() =>
                      issue({ kind: 'captive', faction, targetOfficer: o.id, action: 'recruit' })
                    }
                  >
                    등용
                  </button>
                  <button
                    className="btn small"
                    onClick={() =>
                      issue({ kind: 'captive', faction, targetOfficer: o.id, action: 'release' })
                    }
                  >
                    석방
                  </button>
                  <button
                    className="btn small"
                    onClick={() =>
                      issue({ kind: 'captive', faction, targetOfficer: o.id, action: 'execute' })
                    }
                  >
                    처형
                  </button>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 외교 패널
 * ------------------------------------------------------------------ */

export function DiplomacyPanel({ state }: { state: GameState }) {
  const issue = useGame((s) => s.issue);
  const faction = state.playerFaction;
  const [envoy, setEnvoy] = useState<string>('');

  const envoys = factionOfficers(state, faction).filter((o) => !o.acted && !o.armyId);
  const active = envoy && envoys.some((o) => o.id === envoy) ? envoy : envoys[0]?.id ?? '';
  const others = Object.values(state.factions).filter((f) => f.alive && f.id !== faction);
  const status = victoryStatus(state, faction);

  const send = (to: string, action: Command extends { kind: 'diplomacy' } ? never : string) => {
    if (!active) return;
    issue({
      kind: 'diplomacy',
      faction,
      officer: active,
      to,
      action: action as 'peace',
    });
  };

  return (
    <div className="stack">
      <div>
        <div className="section-label" style={{ margin: '0 0 6px' }}>
          사절
        </div>
        <select className="btn small block" value={active} onChange={(e) => setEnvoy(e.target.value)}>
          {envoys.length === 0 && <option>보낼 인물이 없습니다</option>}
          {envoys.map((o) => {
            const d = officerDef(o.id);
            return (
              <option key={o.id} value={o.id}>
                {d.name} (정{d.stats.pol} 매{d.stats.chr})
              </option>
            );
          })}
        </select>
      </div>

      {others.map((f) => {
        const rel = getRelation(state, faction, f.id);
        const theirs = factionCastles(state, f.id).length;
        return (
          <div key={f.id} className="card" style={{ padding: 12 }}>
            <div className="row between">
              <h3 style={{ fontSize: 16 }}>
                <span className="swatch" style={{ background: factionColor(f.id) }} />
                {factionName(f.id)}
              </h3>
              <span
                className="tag"
                style={{
                  borderColor:
                    rel.status === 'war'
                      ? 'var(--jinsa)'
                      : rel.status === 'alliance'
                        ? 'var(--su)'
                        : undefined,
                }}
              >
                {STATUS_LABEL[rel.status]}
                {rel.status === 'tribute' && rel.overlord === faction ? ' (아국에)' : ''}
                {rel.status === 'tribute' && rel.overlord === f.id ? ' (상대에)' : ''}
              </span>
            </div>
            <div className="faint" style={{ fontSize: 11.5, margin: '4px 0 8px' }}>
              우호도 {Math.round(rel.trust)} · 거점 {theirs}
              {rel.truceTurns > 0 && ` · 정전 ${rel.truceTurns}턴`}
            </div>
            <div className="row" style={{ flexWrap: 'wrap', gap: 5 }}>
              <button className="btn small" disabled={!active} onClick={() => send(f.id, 'peace')}>
                화평
              </button>
              <button className="btn small" disabled={!active} onClick={() => send(f.id, 'alliance')}>
                동맹
              </button>
              <button className="btn small" disabled={!active} onClick={() => send(f.id, 'declare')}>
                선전포고
              </button>
              <button className="btn small" disabled={!active} onClick={() => send(f.id, 'break')}>
                파기
              </button>
              <button
                className="btn small"
                disabled={!active}
                onClick={() => send(f.id, 'demand_tribute')}
                title={`복속을 받아내려면 상대의 ${B.vassalCastleRatio}배 이상을 차지해야 합니다.`}
              >
                복속 요구
              </button>
              <button
                className="btn small"
                disabled={!active}
                onClick={() =>
                  active &&
                  issue({
                    kind: 'diplomacy',
                    faction,
                    officer: active,
                    to: f.id,
                    action: 'gift',
                    gold: 800,
                  })
                }
              >
                예물 800
              </button>
            </div>
          </div>
        );
      })}

      <div className="card" style={{ padding: 12 }}>
        <h3 style={{ fontSize: 16 }}>{CHINA_NAME}</h3>
        <p style={{ marginTop: 4 }}>
          조공하면 명분과 교역 이익을 얻지만 자주성이 깎인다. 현재 자주성{' '}
          <b className="num">{Math.round(state.factions[faction].autonomy)}</b>
        </p>
        <button className="btn small" disabled={!active} onClick={() => send(CHINA_ID, 'tribute')}>
          조공 사절 (재화 {B.tributeGoldCost})
        </button>
      </div>

      <hr className="sep" />
      <div className="faint" style={{ fontSize: 12 }}>
        승리 진행 — 거점 {status.castles}/{status.totalCastles} · 조공국 {status.vassals}/
        {others.length}
        <br />
        현재 승리 조건: {state.options.victory === 'hegemony' ? '패권 (타국을 모두 복속)' : '통일 (전 거점 점령)'}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 제도 패널
 * ------------------------------------------------------------------ */

export function InstitutionPanel({ state }: { state: GameState }) {
  const issue = useGame((s) => s.issue);
  const faction = state.playerFaction;
  const f = state.factions[faction];
  const list = INSTITUTIONS.filter((i) => !i.faction || i.faction === faction);
  const council = factionDef(faction).council.type;
  const councilName =
    { jega: '제가회의', jeongsaam: '정사암', hwabaek: '화백회의', none: '—' }[council] ?? '—';

  return (
    <div className="stack">
      <div className="card" style={{ padding: 12 }}>
        <div className="row between">
          <b>{councilName}</b>
          <span className="num">{Math.round(f.councilSupport)}</span>
        </div>
        <Bar value={f.councilSupport} max={100} />
        <p className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>
          큰 정책은 귀족회의의 지지를 받아야 한다. 지지도가 {B.coupThreshold} 아래로 내려가면 정변이 일어난다.
        </p>
      </div>

      {list.map((def) => {
        const owned = f.institutions.includes(def.id);
        const err = validateCommand(state, { kind: 'institution', faction, institution: def.id });
        return (
          <div key={def.id} className="card" style={{ padding: 12 }}>
            <div className="row between">
              <h3 style={{ fontSize: 15 }}>{def.name}</h3>
              {owned ? (
                <span className="tag" style={{ borderColor: 'var(--su)' }}>
                  반포함
                </span>
              ) : (
                <span className="faint num" style={{ fontSize: 11.5 }}>
                  재화 {fmt(def.cost.gold)}
                  {def.cost.cause ? ` · 명분 ${def.cost.cause}` : ''} · 지지 {def.councilDC}
                </span>
              )}
            </div>
            <p>{def.desc}</p>
            {!owned && (
              <div className="row" style={{ marginTop: 6 }}>
                <button
                  className="btn small"
                  disabled={!!err}
                  title={err ?? ''}
                  onClick={() => issue({ kind: 'institution', faction, institution: def.id })}
                >
                  반포
                </button>
                {err && (
                  <span className="faint" style={{ fontSize: 11 }}>
                    {err}
                  </span>
                )}
                {err?.startsWith('귀족회의') && (
                  <button
                    className="btn small"
                    onClick={() =>
                      issue({ kind: 'institution', faction, institution: def.id, force: true })
                    }
                  >
                    강행
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {hasInstitution(state, faction, 'hwarangdo') && (
        <p className="faint" style={{ fontSize: 12 }}>
          화랑도가 열려 있다. 탐색으로 아직 세상에 나오지 않은 청년을 발탁할 수 있다.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 연대기
 * ------------------------------------------------------------------ */

export function ChroniclePanel({ state }: { state: GameState }) {
  const hints = foresightHints(state, state.playerFaction);
  const hasForesight = factionOfficers(state, state.playerFaction).some((o) =>
    officerDef(o.id).skills.includes('foresight')
  );

  return (
    <div className="stack">
      {hasForesight && hints.length > 0 && (
        <div className="card" style={{ padding: 12 }}>
          <h3 style={{ fontSize: 15 }}>혜안</h3>
          <p>다가올 일이 어렴풋이 보인다.</p>
          {hints.map((h) => (
            <div key={h} className="faint" style={{ fontSize: 12 }}>
              · {h}
            </div>
          ))}
        </div>
      )}

      <div className="section-label" style={{ margin: 0 }}>
        연대기
      </div>
      {state.chronicle
        .slice()
        .reverse()
        .map((c, i) => (
          <div className="chronicle-item" key={i}>
            <span className="yr">
              {c.year}년 {['봄', '여름', '가을', '겨울'][c.season]}
            </span>
            <span>{c.text}</span>
          </div>
        ))}
    </div>
  );
}
