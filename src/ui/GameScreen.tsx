/**
 * GameScreen.tsx — 전략 화면 조립.
 *
 * 문서 §4 의 창(窓) 시스템: 지도가 화면 전체를 쓰고, UI 는 그 위에 떠 있는 창으로 얹는다.
 * 사이드바로 지도를 자르지 않는다.
 *
 *   상단 고정 바 — 국력 (연·계절, 자원, 턴 종료)
 *   우상 창      — 거점·인물·외교·제도·연대기 (탭)
 *   좌하 창      — 사초(史草) 로그
 *   좌상·우하    — 줌·범례 (StrategyMap 이 그린다)
 */

import { useCallback, useMemo, useState } from 'react';
import { factionColor, factionName } from '../core/data';
import { downloadSave, saveToStorage } from '../core/save';
import { factionCastles, factionTroops } from '../core/state';
import { EventModal, GameOverModal, MarchDialog, ReportModal, reachableFrom } from './dialogs';
import {
  CastlePanel,
  ChroniclePanel,
  DiplomacyPanel,
  InstitutionPanel,
  OfficerPanel,
} from './panels';
import { StrategyMap } from './StrategyMap';
import { Window } from './Window';
import { useGame, type SidePanel } from './store';
import { fmt, fmtTroops } from '../core/util';

const TABS: Array<{ id: SidePanel; label: string }> = [
  { id: 'castle', label: '거점' },
  { id: 'officers', label: '인물' },
  { id: 'diplomacy', label: '외교' },
  { id: 'institutions', label: '제도' },
  { id: 'chronicle', label: '연대기' },
];

/**
 * 자원 표기 — 한자 한 글자 + 한글 (문서 §7 "한자 1글자를 쓴다").
 *
 * 한자만 남기지 않는 이유: 읽는 사람이 한자를 모를 수 있다. 문서가 금하는 것은
 * "색·기호만으로 정보를 전달하는 것"이므로 한글 라벨을 함께 남긴다.
 */
function Res({ mark, label, value }: { mark: string; label: string; value: string | number }) {
  return (
    <span className="res-item" title={label}>
      <i className="mark">{mark}</i>
      <b>{label}</b>
      <em>{value}</em>
    </span>
  );
}

export function GameScreen() {
  const state = useGame((s) => s.state);
  const selected = useGame((s) => s.selected);
  const select = useGame((s) => s.select);
  const panel = useGame((s) => s.panel);
  const setPanel = useGame((s) => s.setPanel);
  const endTurn = useGame((s) => s.endTurn);
  const busy = useGame((s) => s.busy);
  const event = useGame((s) => s.event);
  const chooseEvent = useGame((s) => s.chooseEvent);
  const showReport = useGame((s) => s.showReport);
  const closeReport = useGame((s) => s.closeReport);
  const setScreen = useGame((s) => s.setScreen);
  const notify = useGame((s) => s.notify);
  // 코어가 상태를 제자리에서 고치므로 revision 을 구독해 다시 그린다.
  useGame((s) => s.revision);

  const [marchFrom, setMarchFrom] = useState<string | null>(null);
  const [marchTarget, setMarchTarget] = useState('');
  const [openPanel, setOpenPanel] = useState(true);
  const [openLog, setOpenLog] = useState(true);

  // 출진 중이면 도달 가능한 거점을 지도에 밝힌다. 76 거점 판에서
  // 목적지를 드롭다운 이름으로만 고르게 하는 것은 무리다.
  const marchTargets = useMemo(() => {
    if (!state || !marchFrom) return null;
    return new Set(reachableFrom(state, state.playerFaction, marchFrom).map((c) => c.id));
  }, [state, marchFrom]);

  // 지도 클릭은 평소에는 거점 선택이지만, 출진 중에는 목적지 지정이 된다.
  const onMapSelect = useCallback(
    (id: string) => {
      if (marchTargets) {
        if (marchTargets.has(id)) setMarchTarget(id);
        return;
      }
      select(id);
      setOpenPanel(true);
    },
    [marchTargets, select]
  );

  if (!state) return null;
  const me = state.factions[state.playerFaction];
  const r = me.resources;
  const myReport = state.reports.find((x) => x.faction === state.playerFaction);
  const pending = Object.values(state.officers).filter(
    (o) => o.faction === state.playerFaction && o.status === 'active' && !o.acted && !o.armyId
  ).length;

  return (
    <div className="game">
      {/* 국력 — 늘 상단에 있고 닫을 수 없다 (문서 §4) */}
      <div className="topbar">
        <span className="date">
          {state.year}년 {['봄', '여름', '가을', '겨울'][state.season]}
        </span>
        <span className="faction-badge" style={{ background: factionColor(state.playerFaction) }}>
          {factionName(state.playerFaction)}
        </span>

        <div className="res">
          <Res mark="穀" label="곡물" value={fmt(r.grain)} />
          <Res mark="財" label="재화" value={fmt(r.gold)} />
          <Res mark="鐵" label="철" value={fmt(r.iron)} />
          <Res mark="義" label="명분" value={Math.round(r.cause)} />
          <Res mark="城" label="거점" value={factionCastles(state, state.playerFaction).length} />
          <Res mark="兵" label="병력" value={fmtTroops(factionTroops(state, state.playerFaction))} />
          <Res mark="議" label="지지" value={Math.round(me.councilSupport)} />
        </div>

        <div className="spacer" />

        <span className="cap">대기 인물 {pending}</span>
        <button
          className={`btn small${openPanel ? ' on' : ''}`}
          onClick={() => setOpenPanel((v) => !v)}
        >
          거점창
        </button>
        <button className={`btn small${openLog ? ' on' : ''}`} onClick={() => setOpenLog((v) => !v)}>
          사초
        </button>
        <button
          className="btn small"
          onClick={() => {
            saveToStorage(state, 'manual');
            notify('저장했습니다.');
          }}
        >
          저장
        </button>
        <button className="btn small" onClick={() => downloadSave(state)}>
          내보내기
        </button>
        <button className="btn small ghost" onClick={() => setScreen('title')}>
          나가기
        </button>
        <button
          className="btn primary"
          onClick={endTurn}
          disabled={busy || state.phase !== 'command'}
        >
          {busy ? '처리 중…' : '턴 종료'}
        </button>
      </div>

      {/* 지도는 화면 전체를 쓴다 */}
      <div className="map-wrap">
        <StrategyMap
          state={state}
          selected={selected}
          onSelect={onMapSelect}
          marchTargets={marchTargets}
        />
      </div>

      {openPanel && (
        <Window
          id="panel"
          title={TABS.find((t) => t.id === panel)?.label ?? '거점'}
          x={-12}
          y={62}
          width={382}
          maxHeight={Math.round(window.innerHeight * 0.6)}
          onClose={() => setOpenPanel(false)}
          head={
            <div className="tabs">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  className={panel === t.id ? 'on' : ''}
                  onClick={() => setPanel(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          }
        >
          {panel === 'castle' && (
            <CastlePanel
              state={state}
              onMarch={() => {
                if (!selected) return;
                setMarchTarget('');
                setMarchFrom(selected);
              }}
            />
          )}
          {panel === 'officers' && <OfficerPanel state={state} />}
          {panel === 'diplomacy' && <DiplomacyPanel state={state} />}
          {panel === 'institutions' && <InstitutionPanel state={state} />}
          {panel === 'chronicle' && <ChroniclePanel state={state} />}
        </Window>
      )}

      {openLog && (
        <Window
          id="log"
          title="사초 史草"
          x={12}
          y={-236}
          width={420}
          maxHeight={190}
          onClose={() => setOpenLog(false)}
        >
          <div className="log">
            {state.log
              .filter(
                (l) => l.faction === null || l.faction === state.playerFaction || l.kind === 'battle'
              )
              .slice(-80)
              .reverse()
              .map((l, i) => (
                <div key={i}>
                  <span className="when">
                    {l.year}
                    {['봄', '여름', '가을', '겨울'][l.season]}
                  </span>
                  {l.text}
                </div>
              ))}
          </div>
        </Window>
      )}

      {marchFrom && (
        <MarchDialog
          state={state}
          from={marchFrom}
          target={marchTarget}
          onTarget={setMarchTarget}
          onClose={() => setMarchFrom(null)}
        />
      )}
      {event && <EventModal def={event.def} onChoose={chooseEvent} />}
      {showReport && !state.result && (
        <ReportModal
          report={myReport}
          year={myReport?.year ?? state.year}
          season={myReport?.season ?? state.season}
          onClose={closeReport}
        />
      )}
      {state.result && <GameOverModal state={state} />}
    </div>
  );
}
