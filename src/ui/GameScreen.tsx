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

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { usePhone } from './useMediaQuery';
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
 * 폰에서는 시트를 하나만 연다 — 390px 화면에 창 둘이 겹치면 볼 것이 없다.
 * 그래서 데스크톱의 「사초 창」과 국력 바 버튼들이 갈 곳이 필요하다.
 * 탭 두 개를 더 붙여 같은 시트 안으로 들인다.
 */
type ExtraTab = 'log' | 'etc';
const EXTRA_TABS: Array<{ id: ExtraTab; label: string }> = [
  { id: 'log', label: '사초' },
  { id: 'etc', label: '기타' },
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

  const phone = usePhone();
  const [marchFrom, setMarchFrom] = useState<string | null>(null);
  const [marchTarget, setMarchTarget] = useState('');
  const [openPanel, setOpenPanel] = useState(true);
  const [openLog, setOpenLog] = useState(true);
  /** 폰에서만 쓰는 추가 탭. null 이면 위의 다섯 탭(store 의 panel) 을 보여 준다. */
  const [extra, setExtra] = useState<ExtraTab | null>(null);

  // 폰으로 좁아지면 창 둘이 시트 하나로 합쳐진다. 사초만 열려 있었다면
  // 그 상태를 잃지 않도록 사초 탭으로 옮겨 준다.
  useEffect(() => {
    if (!phone) return;
    setOpenPanel(true);
    setExtra((e) => (e === null && !openPanel && openLog ? 'log' : e));
    // openPanel/openLog 는 시작 조건으로만 읽는다. 폰 진입 시점 한 번이면 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone]);

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
      // 폰에서는 시트가 하나뿐이라, 사초를 보던 중에 거점을 누르면
      // 아무 일도 일어나지 않은 것처럼 보인다. 거점 쪽으로 돌려 준다.
      if (phone) {
        setExtra(null);
        setPanel('castle');
      }
    },
    [marchTargets, select, phone, setPanel]
  );

  if (!state) return null;
  const me = state.factions[state.playerFaction];
  const r = me.resources;
  const myReport = state.reports.find((x) => x.faction === state.playerFaction);
  const pending = Object.values(state.officers).filter(
    (o) => o.faction === state.playerFaction && o.status === 'active' && !o.acted && !o.armyId
  ).length;

  /*
   * 창 안에 들어갈 것들을 먼저 만들어 둔다. 데스크톱은 창 둘에 나눠 담고
   * 폰은 시트 하나에 탭으로 담는다 — 담는 그릇만 다르고 내용은 같아야 한다.
   */
  const panelBody = (
    <>
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
    </>
  );

  const logBody = (
    <div className="log">
      {state.log
        .filter((l) => l.faction === null || l.faction === state.playerFaction || l.kind === 'battle')
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
  );

  /* 폰 전용. 지도 위에서 걷어낸 버튼들과, 좁은 화면에서 감춘 범례가 여기 모인다. */
  const etcBody = (
    <div className="etc">
      <div className="etc-legend">
        {Object.values(state.factions)
          .filter((f) => f.alive)
          .map((f) => (
            <span key={f.id}>
              <i style={{ background: factionColor(f.id) }} />
              {factionName(f.id)}
              <em>{Object.values(state.castles).filter((c) => c.owner === f.id).length}</em>
            </span>
          ))}
      </div>
      <div className="etc-btns">
        <button
          className="btn"
          onClick={() => {
            saveToStorage(state, 'manual');
            notify('저장했습니다.');
          }}
        >
          저장
        </button>
        <button className="btn" onClick={() => downloadSave(state)}>
          내보내기
        </button>
        <button className="btn ghost" onClick={() => setScreen('title')}>
          나가기
        </button>
      </div>
    </div>
  );

  return (
    <div className="game">
      {/* 국력 — 늘 상단에 있고 닫을 수 없다 (문서 §4) */}
      <div className="topbar">
        {/*
         * 1행. 데스크톱에서는 `display: contents` 라 이 래퍼가 레이아웃에서 사라지고
         * 국력 바는 지금까지처럼 한 줄짜리 flex 그대로다. 폰에서만 진짜 행이 된다.
         *
         * flex-wrap 과 order 로 접어 보려다 실패했다 — 자원 줄이 max-content(408px)
         * 로 버티며 레이아웃 뷰포트 자체를 390 → 432 로 넓혀, 화면 오른쪽이 잘렸다.
         * 줄을 진짜 블록으로 나눠야 스크롤 컨테이너가 부모 폭에 묶인다.
         */}
        <div className="bar-row bar-a">
          <span className="date">
            {state.year}년 {['봄', '여름', '가을', '겨울'][state.season]}
          </span>
          <span
            className="faction-badge"
            style={{ background: factionColor(state.playerFaction) }}
          >
            {factionName(state.playerFaction)}
          </span>
        </div>

        <div className="res">
          <Res mark="穀" label="곡물" value={fmt(r.grain)} />
          <Res mark="財" label="재화" value={fmt(r.gold)} />
          <Res mark="鐵" label="철" value={fmt(r.iron)} />
          <Res mark="義" label="명분" value={Math.round(r.cause)} />
          <Res mark="城" label="거점" value={factionCastles(state, state.playerFaction).length} />
          <Res mark="兵" label="병력" value={fmtTroops(factionTroops(state, state.playerFaction))} />
          <Res mark="議" label="지지" value={Math.round(me.councilSupport)} />
        </div>

        <div className="bar-row bar-b">
          <div className="spacer" />

          <span className="cap">대기 인물 {pending}</span>
          {/* 폰에서는 이 다섯이 시트 「기타」 탭으로 간다. 지도 위에 남는 것은 턴 종료 하나. */}
          <button
            className={`btn small only-wide${openPanel ? ' on' : ''}`}
            onClick={() => setOpenPanel((v) => !v)}
          >
            거점창
          </button>
          <button
            className={`btn small only-wide${openLog ? ' on' : ''}`}
            onClick={() => setOpenLog((v) => !v)}
          >
            사초
          </button>
          <button
            className="btn small only-wide"
            onClick={() => {
              saveToStorage(state, 'manual');
              notify('저장했습니다.');
            }}
          >
            저장
          </button>
          <button className="btn small only-wide" onClick={() => downloadSave(state)}>
            내보내기
          </button>
          <button className="btn small ghost only-wide" onClick={() => setScreen('title')}>
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

      {phone ? (
        /* 폰 — 시트 하나. 사초와 국력 바 버튼들이 탭으로 함께 들어온다. */
        <Window
          id="sheet"
          title={
            extra
              ? (EXTRA_TABS.find((t) => t.id === extra)?.label ?? '')
              : (TABS.find((t) => t.id === panel)?.label ?? '거점')
          }
          x={0}
          y={0}
          width={0}
          head={
            <div className="tabs">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  className={!extra && panel === t.id ? 'on' : ''}
                  onClick={() => {
                    setExtra(null);
                    setPanel(t.id);
                  }}
                >
                  {t.label}
                </button>
              ))}
              {EXTRA_TABS.map((t) => (
                <button
                  key={t.id}
                  className={extra === t.id ? 'on' : ''}
                  onClick={() => setExtra(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          }
        >
          {extra === 'log' ? logBody : extra === 'etc' ? etcBody : panelBody}
        </Window>
      ) : (
        <>
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
              {panelBody}
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
              {logBody}
            </Window>
          )}
        </>
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
