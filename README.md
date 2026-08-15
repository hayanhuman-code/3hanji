# 삼한지(三韓志): 천하삼분

한국 삼국시대를 배경으로 한 턴제 그랜드 스트래티지의 **M1 웹 프로토타입**.

### ▶ [브라우저에서 바로 플레이](https://hayanhuman-code.github.io/3hanji/)

설치 없이 열린다. `main` 에 푸시할 때마다 GitHub Actions 가 자동으로 다시 배포한다.

[기획서](docs/game-design.md)와 [시스템 구성 상세계획](docs/system-plan.md)을 구현한 것으로,
상세계획 §6 의 **Phase 0 ~ Phase 3(= M1 프로토타입 완성)** 과 Phase 4 항목 일부가 들어 있다.
"이길 수 있고 질 수 있는 게임"까지 와 있다.

직접 돌려 보려면:

```bash
npm install
npm run dev        # 개발 서버
npm run validate   # JSON 데이터 검증
npm test           # 스모크 테스트 22종
npm run simulate   # AI 자동 대전 승률 집계
npm run build      # 정적 빌드
```

---

## 지금 할 수 있는 것

- 시나리오 2종(642년 「천하삼분의 끝」, 551년 「한강의 주인」) 중 하나를 골라
  고구려·백제·신라 가운데 한 나라를 맡는다.
- 계절(1년 4턴) 단위로 **내정 · 인사 · 외교 · 군사** 명령을 내리고 턴을 넘긴다.
- 출진하면 **헥스 전술 전투**가 열린다. 직접 지휘하거나 위임할 수 있다.
- 산성에 농성하고, 포위로 적의 병량을 말리고, 도하 중인 적을 친다.
- 사서 인용문이 붙은 **역사 이벤트**를 만나고, 역사대로 갈지 다른 길로 갈지 고른다.
- 통일하거나, 다른 두 나라를 조공국으로 복속시켜 패권을 잡거나, 망한다.

전투 화면은 전략맵 없이도 뜬다 — 시작 화면의 **「전투 시뮬레이터 (안시성 농성)」**로 전투만 따로 확인할 수 있다.

---

## 구현 범위

### 들어 있는 것

| 계획서 항목 | 구현 |
|---|---|
| §3.1 턴 엔진 (7단계) | `src/core/turn.ts` — ④전투·⑤이벤트에서 UI 상호작용을 위해 재개 가능하게 나뉜다 |
| §3.2 내정 모듈 | 개발(농/상/성곽/병영)·징병·훈련·순찰·탐색·병량 비축·등용·포로 처리 |
| §3.3 전투 모듈 (헥스) | 13×9 헥스, 병종 상성, 지형, 사기, 성벽 HP, 공성병기, 도하 피격, 자동 전투 |
| §3.4 AI 모듈 | 3단계 우선순위 휴리스틱 + 세력 성향 파라미터 |
| §3.5 외교 모듈 | 우호도·전쟁/화평/동맹/조공, 선전포고(명분), 조공(대중국), 예물, 복속 요구 |
| §3.6 이벤트 엔진 | 조건-효과 선언형 + 미니 DSL 파서 (`src/core/dsl.ts`) |
| §3.7 저장/로드 | localStorage 자동저장 + JSON 파일 내보내기/불러오기 |
| §4 UI ①②③④⑤⑥⑦ | 전략맵·내정 패널·인물·외교·전투·이벤트 컷·결산 전부 |
| §7 자동 시뮬레이션 | `npm run simulate` — 헤드리스 AI 대전 승률 집계 |
| §8 데이터 검증기 | `npm run validate` — 스키마·참조 무결성·조건식 문법 검사 |
| 기획서 §4.3 제도 반포 | 율령·불교·태학·박사·화랑도·군제·조창 7종 + 귀족회의 판정·강행·정변 |
| 기획서 §6.3 산성 공성전 | 강공 / 포위(병량전) 선택, 산성 방어 배율, 농성 중 기습 |
| 기획서 §6.4 외세 침공 | 645년 당 태종 친정 (간이 스크립트) |

### 아직 없는 것

거점 60개·인물 300명·이벤트 100종의 콘텐츠 양산(Phase 5), 시나리오 1·2·4·IF,
천도, 일기토·설전, 내응(첩자 공작), 화공, 왜의 백강 파병, 초상화·BGM.
자세한 목록과 우선순위는 [백로그](docs/backlog.md)에 있다.

---

## 코드가 어디에 있는가

```
src/
  core/                 게임 코어 — React 를 전혀 모른다. 그대로 헤드리스로 돌아간다.
    types.ts            모든 타입. 정적 데이터(Def)와 동적 상태(State)를 분리
    formulas.ts         ★ 모든 수치 계산이 모이는 단 하나의 파일. 밸런싱은 여기만 고친다
    turn.ts             턴 엔진 (①~⑦)
    state.ts            gameState 생성과 조회
    domestic.ts         내정 명령의 검증·적용
    military.ts         출진·행군·보급·포위, 전략↔전투 이음매
    diplomacy.ts        외교
    ai.ts               규칙 기반 AI
    events.ts / dsl.ts / effects.ts   이벤트 엔진과 조건식·효과 해석
    victory.ts save.ts rng.ts util.ts
    battle/             전술 전투 — core 의 나머지를 몰라도 단독 실행된다
      hex.ts battleState.ts battleEngine.ts
  data/                 ★ 밸런싱·콘텐츠 작업 영역. 전부 JSON
    castles.json officers.json factions.json unitTypes.json
    institutions.json events.json scenarios/*.json
  ui/                   React + Zustand
scripts/
  validate-data.ts      데이터 검증기
  test.ts               스모크 테스트 (의존성 없음)
  simulate.ts           AI 자동 대전
  dev/browser-smoke.mjs 실제 브라우저 구동 확인 (Playwright)
```

**코드를 건드리지 않고 할 수 있는 일**

- 인물 추가·능력치 조정 → `src/data/officers.json`
- 거점·지도 → `src/data/castles.json` (좌표는 0~1000 정규화 공간)
- 병종·상성 → `src/data/unitTypes.json`
- 이벤트 추가 → `src/data/events.json` (조건식과 효과는 아래 문법)
- 시나리오 추가 → `src/data/scenarios/` 에 JSON 하나 + `src/core/data.ts` 에 import 한 줄

고친 뒤에는 반드시 `npm run validate` 를 돌린다. 오타·끊긴 참조·잘못된 조건식을 잡아 준다.

### 이벤트 조건식 문법

```
year >= 642 AND owns(silla, daeya)
alliance(silla, baekje) AND NOT war(goguryeo, silla)
castles(baekje) > 6 OR gold(baekje) >= 5000
flag(nadang) AND institution(bulgyo) AND alive(kim_chunchu)
```

쓸 수 있는 술어: `owns · war · peace · alliance · tribute · trust · flag · institution ·
alive · serves · hasSkill · castles · troops · gold · grain · cause · autonomy · council · factionAlive`
변수: `year · season · turn`

### 이벤트 효과 문법

```
gold:+800        grain:-2000      cause:+10       council:-12     autonomy:-20
loyalty_all:+8   loyalty(daeya):-20              troops(hanseong):-4000
trust(baekje):+20   war(baekje)   alliance(goguryeo)   break_alliance(baekje)
kill(bidam)      join(pilbu)      flag:alt_history     take_castle(hanseong)
give_castle(yodong, none)         invasion(tang, 60000)      reveal_talent
```

---

## 밸런스 현황

계획서 §7 이 정한 방식대로 AI 끼리 자동 대전시켜 잰 값이다 (`npm run simulate`).
목표는 세력별 승률 25~40%.

**642년 「천하삼분의 끝」** — 100회, 최대 160턴(40년)

| 세력 | 승률 | 결착승 |
|---|---|---|
| 고구려 | 44.0% | 14 |
| 백제 | 22.0% | 3 |
| 신라 | 34.0% | 9 |

결착률 26%, 평균 결착 75.5턴(약 19년).

**551년 「한강의 주인」** — 60회

| 세력 | 승률 | 결착승 |
|---|---|---|
| 고구려 | 51.7% | 17 |
| 백제 | 3.3% | 0 |
| 신라 | 45.0% | 10 |

642년은 목표 구간에 거의 들어와 있다. **551년의 백제는 아직 명백히 약하다** — 4거점으로 시작하는데
553년 배신 이벤트와 554년 관산성 이벤트를 연달아 맞고, 현재 AI 가 영토 규모에 비례해 눈덩이처럼
커지기 때문이다. 미해결 항목으로 [백로그](docs/backlog.md)에 올려 두었다.

전투 밸런스는 `npm test` 가 지킨다 — 장창보병이 개마무사를 막아 세우는지, 같은 병력의 강공을
산성이 버텨 내는지, 대군이면 결국 성이 떨어지는지를 매번 20회씩 돌려 확인한다.

---

## 계획과 달라진 점

계획서를 그대로 따르지 않은 곳과 그 이유.

1. **순수 함수 대신 제자리 변경(in-place mutation)** — 계획은 `applyCommand(state, cmd) → newState`
   였으나, 매 턴 상태 전체를 복사하는 비용을 피해 코어는 상태를 제자리에서 고친다.
   대신 결정론적 RNG 시드를 상태에 담아, 세이브/로드와 재현성이라는 원래 목적은 그대로 지켰다.
   (`npm test` 의 "로드한 상태에서 이어서 돌려도 같은 결과가 나온다"가 이걸 검증한다.)
2. **전투맵 9×7 → 13×9** — 9열로는 성벽선(공격 진영 3열 + 성벽 + 성 안쪽)이 들어가지 않았다.
3. **병종 상성표를 n×n 이 아니라 계열(class) 기준으로** — 병종이 늘 때마다 표가 제곱으로
   커지는 것을 피했다. 병종에 `class` 를 두고 계열 대 계열로만 상성을 적는다.
4. **전투 모듈의 장수 정보를 값으로 전달** — "전투는 전략 없이 단독 실행"이라는 요건을 지키려면
   전투가 `OfficerState` 를 참조해선 안 된다. 필요한 능력치·특기만 복사해 넘긴다.
5. **패권 승리를 기본값으로** — 통일(전 거점 점령)만으로는 40년 안에 판이 끝나지 않았다(결착률 0%).
   기획서 §3 의 두 번째 승리 조건인 조공국 복속을 구현하니 결착률 26%가 되었다. 통일 조건도 옵션으로 남아 있다.
6. **시나리오별 세력 사정(`factionMods`)을 스키마에 추가** — 같은 고구려라도 551년과 642년의
   조정 결속·대외 자세가 달라야 한다. 코드가 아니라 시나리오 JSON 에서 조절한다.

---

## 고증에 관하여

인물 능력치, 세력별 영토 표기, 거점 인접 관계는 **사료를 바탕으로 한 게임적 해석**이며
학술적 고증을 확정하는 것이 아니다. 기획서 §11 이 짚은 대로 이 부분은 민감한 영역이므로,
이벤트에는 가능한 한 출전(삼국사기·삼국유사 등)을 함께 적어 두었다
(`src/data/events.json` 의 `source` 항목).

거점 16개는 60개 계획의 축소판이라 한 노드가 넓은 권역을 대표한다. 지명은 실제이되
인접 관계는 이동 그래프로서의 단순화다.

---

## 라이선스·출처

프로토타입. 코드는 이 저장소 안에서만 쓰인다. 외부 에셋은 쓰지 않았고 초상화·일러스트는
전부 자리표시자다(이름 첫 글자). BGM 없음.
