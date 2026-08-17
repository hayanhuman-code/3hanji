/**
 * FieldSim.tsx — 전투 시뮬레이터 단독 페이지.
 *
 * 전략맵과 붙이지 않는다. 편성과 전장을 바꿔 가며 수십 판을 빠르게 돌려 봐야
 * 밸런싱이 되기 때문이다(기획서 §9 「먼저 만들 것」). 전략 레이어와의 연결은
 * 나중에 붙인다 — 그때도 이 화면은 그대로 남아 밸런스를 재는 자리가 된다.
 *
 * 화면은 두 단계다.  편성(3열·예비대) → 전투(배속·개입)
 */

import { useCallback, useState } from 'react';
import { OFFICERS, factionName } from '../../core/data';
import { ROW_LABEL, TIER_CAP, TIER_NAME } from '../../core/field/balance';
import { BATTLEFIELD_IDS, battlefield, fieldSummary } from '../../core/field/battlefield';
import { createField, validateEntries } from '../../core/field/setup';
import { runToEnd } from '../../core/field/sim';
import type { FieldEntry, FieldSetup, FieldState, Row, Tier } from '../../core/field/types';
import { MAX_UNITS } from '../../core/field/types';
import { TROOPS, TROOP_LABEL, TROOP_MARK, type FactionId, type Troop } from '../../core/types';
import { useGame } from '../store';
import { FieldPlay } from './FieldPlay';

const FACTIONS: FactionId[] = ['goguryeo', 'baekje', 'silla', 'gaya'];
const ROWS: Row[] = ['front', 'mid', 'rear'];

const STATS = new Map(OFFICERS.map((o) => [o.id, o.stats]));
// 지휘관 없는 수비대는 통솔 40 상당으로 돈다 (§3.5)
const statsOf = (id: string) => STATS.get(id) ?? { lead: 40, war: 40, int: 40 };
const intOf = (id: string) => statsOf(id).int;

/** 그 계열이 제자리로 삼는 열 */
const HOME_ROW: Record<Troop, Row> = { inf: 'front', cav: 'mid', arc: 'rear', str: 'rear' };

function defaultTiers(): Record<Troop, Tier> {
  return { inf: 2, cav: 2, arc: 2, str: 2 };
}

/** 세력에서 좋은 순으로 뽑아 자동 편성한다 — 밸런스를 재려면 빨리 채워야 한다 */
function autoArmy(faction: FactionId, count: number, troops: number): FieldEntry[] {
  const mix: Troop[] = ['inf', 'inf', 'cav', 'arc', 'inf', 'cav', 'str', 'inf', 'arc', 'cav', 'inf', 'str'];
  const used = new Set<string>();
  const out: FieldEntry[] = [];
  for (let i = 0; i < count; i++) {
    const t = mix[i % mix.length];
    const o = OFFICERS.filter((x) => x.faction === faction && x.troop === t && !used.has(x.id)).sort(
      (a, b) => b.stats.lead + b.stats.war - (a.stats.lead + a.stats.war)
    )[0];
    if (!o) continue;
    used.add(o.id);
    out.push({ officer: o.id, troops, row: HOME_ROW[t], reserve: i >= count - 2 && count >= 6 });
  }
  return out;
}

export function FieldSim() {
  const setScreen = useGame((s) => s.setScreen);
  const notify = useGame((s) => s.notify);

  /* ---------------- 편성 ---------------- */
  const [fieldId, setFieldId] = useState('hanseong');
  const [season, setSeason] = useState<0 | 1 | 2 | 3>(0);
  const [atkF, setAtkF] = useState<FactionId>('goguryeo');
  const [defF, setDefF] = useState<FactionId>('silla');
  const [atkTiers, setAtkTiers] = useState<Record<Troop, Tier>>(defaultTiers);
  const [defTiers, setDefTiers] = useState<Record<Troop, Tier>>(defaultTiers);
  const [troopsEach, setTroopsEach] = useState(4000);
  const [count, setCount] = useState(8);
  const [atk, setAtk] = useState<FieldEntry[]>(() => autoArmy('goguryeo', 8, 4000));
  const [def, setDef] = useState<FieldEntry[]>(() => autoArmy('silla', 8, 4000));
  const [seed, setSeed] = useState(20260817);

  /* ---------------- 전투 ---------------- */
  const [state, setState] = useState<FieldState | null>(null);

  const rebuild = useCallback(() => {
    setAtk(autoArmy(atkF, count, troopsEach));
    setDef(autoArmy(defF, count, troopsEach));
  }, [atkF, defF, count, troopsEach]);

  const begin = () => {
    const e1 = validateEntries(atk);
    const e2 = validateEntries(def);
    if (e1 || e2) {
      notify(e1 ?? e2);
      return;
    }
    const setup: FieldSetup = {
      fieldId,
      seed,
      season,
      siege: battlefield(fieldId).tiles.some((r) => r.includes('W')),
      playerSide: 'attacker',
      attackerFaction: atkF,
      defenderFaction: defF,
      tiers: { attacker: atkTiers, defender: defTiers },
      attacker: atk,
      defender: def,
    };
    setState(createField(setup));
  };

  const settle = () => {
    if (state) runToEnd(state, statsOf);
  };

  /* ---------------- 편성 화면 ---------------- */
  if (!state) {
    const f = battlefield(fieldId);
    return (
      <div className="field-setup">
        <div className="field-setup-inner">
          <div className="row between" style={{ marginBottom: 18 }}>
            <h1 style={{ fontSize: 26 }}>
              전투 시뮬레이터 <span className="faint" style={{ fontSize: 13 }}>戰場</span>
            </h1>
            <button className="btn ghost" onClick={() => setScreen('title')}>
              나가기
            </button>
          </div>

          <p className="faint" style={{ marginBottom: 20, maxWidth: 680, fontSize: 12 }}>
            전략맵과 분리된 화면입니다. 편성과 전장을 바꿔 가며 반복해 돌려 보는 곳이고,
            같은 씨앗이면 언제나 같은 결과가 납니다.
          </p>

          <div className="section-label" style={{ marginTop: 0 }}>전장</div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <select className="btn" value={fieldId} onChange={(e) => setFieldId(e.target.value)}>
              {BATTLEFIELD_IDS.map((id) => (
                <option key={id} value={id}>
                  {battlefield(id).name}
                </option>
              ))}
            </select>
            <span className="faint">{fieldSummary(f)} · 7×5km</span>
            <select
              className="btn"
              value={season}
              onChange={(e) => setSeason(Number(e.target.value) as 0 | 1 | 2 | 3)}
            >
              {['봄', '여름 (수계 강함)', '가을 (화계 강함)', '겨울 (소모 큼)'].map((s, i) => (
                <option key={i} value={i}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="section-label">양측</div>
          <div className="field-sides">
            {(
              [
                ['attacker', atkF, setAtkF, atkTiers, setAtkTiers] as const,
                ['defender', defF, setDefF, defTiers, setDefTiers] as const,
              ]
            ).map(([side, fac, setFac, tiers, setTiers]) => (
              <div key={side} className="card" style={{ padding: 12 }}>
                <div className="row between">
                  <b>{side === 'attacker' ? '공격 측' : '수비 측'}</b>
                  <select
                    className="btn small"
                    value={fac}
                    onChange={(e) => setFac(e.target.value as FactionId)}
                  >
                    {FACTIONS.map((x) => (
                      <option key={x} value={x}>
                        {factionName(x)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="faint" style={{ fontSize: 11, margin: '8px 0 4px' }}>
                  국가 병종 단계 — 나라가 강해지면 그 장수가 이끄는 병종이 좋아진다
                </div>
                {TROOPS.map((t) => (
                  <div key={t} className="tier-row">
                    <span>
                      <i className="mark">{TROOP_MARK[t]}</i> {TROOP_LABEL[t]}
                    </span>
                    <span className="tier-btns">
                      {([1, 2, 3, 4] as Tier[]).map((n) => {
                        const cap = TIER_CAP[fac][t];
                        const locked = n > cap;
                        return (
                          <button
                            key={n}
                            className={`btn small${tiers[t] === n ? ' on' : ''}`}
                            disabled={locked}
                            title={locked ? `${factionName(fac)}는 ${t} 계열을 ${cap}단계까지만 올립니다` : TIER_NAME[t][n]}
                            onClick={() => setTiers({ ...tiers, [t]: n })}
                          >
                            {n}
                          </button>
                        );
                      })}
                    </span>
                    <span className="faint num">{TIER_NAME[t][tiers[t]]}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div className="section-label">편성</div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
            <label className="faint">
              부대 수
              <input
                type="number"
                min={1}
                max={MAX_UNITS}
                value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(MAX_UNITS, Number(e.target.value))))}
                style={{ width: 56, marginLeft: 6 }}
              />
            </label>
            <label className="faint">
              부대별 병력
              <input
                type="number"
                min={500}
                step={500}
                value={troopsEach}
                onChange={(e) => setTroopsEach(Math.max(500, Number(e.target.value)))}
                style={{ width: 80, marginLeft: 6 }}
              />
            </label>
            <label className="faint">
              씨앗
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value))}
                style={{ width: 110, marginLeft: 6 }}
              />
            </label>
            <button className="btn small" onClick={rebuild}>
              자동 편성
            </button>
          </div>

          <div className="field-armies">
            {([['공격', atk, setAtk], ['수비', def, setDef]] as const).map(([label, list, setList]) => (
              <div key={label}>
                <div className="section-label" style={{ marginTop: 14 }}>
                  {label} {list.length}부대 · {list.reduce((s, e) => s + e.troops, 0).toLocaleString()}명
                </div>
                <div className="entry-list">
                  {list.map((e, i) => {
                    const o = OFFICERS.find((x) => x.id === e.officer)!;
                    const fit = HOME_ROW[o.troop] === e.row;
                    return (
                      <div key={e.officer} className={`entry${e.reserve ? ' reserve' : ''}`}>
                        <b>
                          {o.name}
                          <i className="troop">{TROOP_MARK[o.troop]}</i>
                        </b>
                        <span className="tabs">
                          {ROWS.map((r) => (
                            <button
                              key={r}
                              className={e.row === r ? 'on' : ''}
                              onClick={() => {
                                const next = [...list];
                                next[i] = { ...e, row: r };
                                setList(next);
                              }}
                            >
                              {ROW_LABEL[r]}
                            </button>
                          ))}
                        </span>
                        <button
                          className={`btn small${e.reserve ? ' on' : ''}`}
                          title="예비대는 전선에 서지 않는다. 전황을 보고 투입한다"
                          onClick={() => {
                            const next = [...list];
                            next[i] = { ...e, reserve: !e.reserve };
                            setList(next);
                          }}
                        >
                          예비
                        </button>
                        {!fit && (
                          <span className="bad" style={{ fontSize: 10.5 }}>
                            열이 안 맞음
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="row" style={{ marginTop: 22 }}>
            <button className="btn primary" onClick={begin}>
              전투 시작
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ---------------- 전투 화면 ---------------- */
  return (
    <FieldPlay
      state={state}
      statsOf={statsOf}
      intOf={intOf}
      side="attacker"
      tiers={atkTiers}
      onSettle={settle}
      finishLabel="편성으로"
      onFinish={() => setState(null)}
      notify={notify}
    />
  );
}
