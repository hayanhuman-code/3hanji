/**
 * 삼한지 — 전역 타입 정의
 *
 * 설계 원칙(시스템 상세계획 §1.1)에 따라
 *  - "정적 데이터(Def)" 와 "동적 상태(State)" 를 타입 레벨에서 분리한다.
 *  - Def 는 JSON 파일에서 읽어오는 읽기 전용 참조 데이터.
 *  - State 는 턴마다 순수 함수로 갱신되는 직렬화 가능한 값.
 */

export type FactionId = string;
export type CastleId = string;
export type OfficerId = string;
export type UnitTypeId = string;
export type ArmyId = string;
export type EventId = string;
export type InstitutionId = string;

/* ------------------------------------------------------------------ *
 * 공통 열거형
 * ------------------------------------------------------------------ */

/** 계절. 1년 = 4턴. */
export const SEASONS = ['봄', '여름', '가을', '겨울'] as const;
export type Season = 0 | 1 | 2 | 3;

/** 전략맵 거점 등급 */
export type CastleType = 'capital' | 'major' | 'fort' | 'port';

/** 전략맵 거점 지형 (전투맵 생성의 기반이 된다) */
export type StrategicTerrain = 'plain' | 'mountain' | 'river' | 'coast';

/** 전술 전투 헥스 지형 */
export type HexTerrain =
  | 'plain'
  | 'forest'
  | 'hill'
  | 'mountain'
  | 'river'
  | 'mudflat'
  | 'wall'
  | 'gate'
  | 'keep';

/** 개발 항목 */
export type DevKey = 'agri' | 'commerce' | 'wall' | 'barracks';

/** 자원 종류 */
export type ResourceKey = 'grain' | 'gold' | 'iron' | 'cause';

/** 외교 상태 */
export type DiploStatus = 'war' | 'peace' | 'alliance' | 'tribute';

/** 인물 충성 성향 — 등용·배신 판정에 쓰인다 */
export type LoyaltyType = 'loyal' | 'ambitious' | 'mercenary';

/** 귀족 회의체 종류 */
export type CouncilType = 'jega' | 'jeongsaam' | 'hwabaek' | 'none';

/* ------------------------------------------------------------------ *
 * 정적 데이터 (JSON)
 * ------------------------------------------------------------------ */

export interface CastleDef {
  id: CastleId;
  name: string;
  type: CastleType;
  region: string;
  /** 전략맵 SVG 좌표 (mapdata.json 과 같은 1760×2049 공간) */
  position: { x: number; y: number };
  /** 인접 거점 — 군대 이동 그래프의 간선. routes.land ∪ routes.sea */
  neighbors: CastleId[];
  /**
   * 간선의 종류. 육군은 sea 전용 간선을 지날 수 없고,
   * 원해 항로는 겨울에 닫힌다(military.ts 의 통행 판정 참조).
   */
  routes: { land: CastleId[]; sea: CastleId[] };
  terrain: StrategicTerrain;
  base: Record<DevKey, number>;
  maxDev: Record<DevKey, number>;
  /** 거점 고유 특성 (formulas.ts 에서 해석) */
  special?: string | null;
}

/**
 * 지도 원본(mapdata.json).
 * 지리 파이프라인(pipeline/build_map.py)이 실제 경위도를 투영해 만든 것으로,
 * 모든 값이 SVG path 문자열이다. 게임 규칙은 여기에 의존하지 않고
 * build-castles.ts 가 뽑아낸 CastleDef 만 본다.
 */
export interface MapData {
  width: number;
  height: number;
  /** 해안선(육지 폴리곤) */
  land: string;
  islets: string;
  lakes: string;
  rivers: Record<string, string>;
  /** 산맥 — 산 기호가 이어진 선. fill:none 으로 그려야 한다. */
  ranges: Record<string, string>;
  castles: Array<{
    id: CastleId;
    name: string;
    type: CastleType;
    f: FactionId;
    x: number;
    y: number;
    lon: number;
    lat: number;
  }>;
  routes: {
    land: Array<{ a: CastleId; b: CastleId; d: string }>;
    sea: Array<{ a: CastleId; b: CastleId; d: string }>;
  };
}

/** 인물의 역할. 등용 우선순위와 인물 목록 정렬에 쓴다. */
export type OfficerRole = 'general' | 'civil' | 'royal' | 'monk' | 'artisan';

/**
 * 병종 계열 — 기병(騎) · 보병(步) · 궁병(弓) · 책략(策).
 *
 * 이것이 전투 v2 의 뼈대다. 장수는 계열이 고정되고, 계열마다 국가가 따로
 * 기술 단계를 올린다. 넷을 다 올릴 자원은 없으므로 무엇을 키울지가 곧 전략이다.
 */
export type Troop = 'cav' | 'inf' | 'arc' | 'str';

export const TROOPS: readonly Troop[] = ['inf', 'cav', 'arc', 'str'] as const;

/** 화면 표기 — 한자 한 글자 (문서 §7: 이모지 금지) */
export const TROOP_MARK: Record<Troop, string> = {
  inf: '步',
  cav: '騎',
  arc: '弓',
  str: '策',
};

export const TROOP_LABEL: Record<Troop, string> = {
  inf: '보병계',
  cav: '기병계',
  arc: '궁병계',
  str: '책략계',
};

/**
 * 인물 명부는 **두 벌의 창(window)** 을 갖는다.
 *
 *  - 역사 시나리오(642·551) → `appear` ~ `retire` (실제 활동 연도)
 *  - 압축 시나리오(원년)     → `age` ~ `lifespan` (원년 시점 나이와 수명)
 *
 * 700년에 걸친 300명을 실제 연표대로 세우면 어느 해에도 20~30명밖에 남지 않아
 * 76 거점을 채울 수 없다. 그래서 압축 캠페인은 나이를 다시 매겨
 * 광개토대왕과 김유신을 같은 판에 세운다 (docs/officers.md).
 * 어느 창을 쓸지는 `ScenarioDef.roster` 가 정한다.
 */
export interface OfficerDef {
  id: OfficerId;
  name: string;
  faction: FactionId | null;
  tier: 1 | 2 | 3;
  role: OfficerRole;
  /** 세력 시작 군주 여부 (압축 캠페인에서 세력당 1명) */
  ruler: boolean;
  /** 역사 모드 등장·퇴장 연도. null 이면 역사 시나리오에 나오지 않는다. */
  appear: number | null;
  retire: number | null;
  /** 압축 모드 원년 나이와 사망 나이. null 이면 압축 시나리오에 나오지 않는다. */
  age: number | null;
  lifespan: number | null;
  stats: {
    lead: number; // 통솔
    war: number; // 무력
    int: number; // 지력
    pol: number; // 정치
    chr: number; // 매력
  };
  skills: string[];
  loyalty_type: LoyaltyType;
  /**
   * 병종 계열 (전투 기획서 §3.1). **전직도 변경도 없다.**
   * 장수가 강해지는 것이 아니라, 나라가 강해지면 그가 이끄는 병종이 좋아진다.
   */
  troop: Troop;
  /**
   * 수군 부대를 이끌 수 있는가 (§3.4). false 면 배에 탑승만 가능하다.
   * 수군 장수가 없으면 바닷길을 쓸 수 없다 — 수로 13개가 존재하는 이유다.
   */
  naval: boolean;
  /** 재야 인물이 숨어 있는 거점 (탐색으로 발견) */
  home?: CastleId | null;
  portrait?: string | null;
  /** 사료 근거 — 인물 카드에 그대로 표시한다 (기획서 §11 고증 대응) */
  source?: string;
  note?: string;
}

export interface FactionDef {
  id: FactionId;
  name: string;
  color: string;
  /** 세력 고유 특성 — formulas.ts 가 해석 */
  traits: string[];
  council: { type: CouncilType; support: number };
  /** AI 성향 파라미터 (시스템 상세계획 §3.4) */
  personality: {
    aggression: number; // 공격성 0~1
    expansion: number; // 확장욕 0~1
    diplomacy: number; // 외교선호 0~1
  };
  playable: boolean;
  /** 세력 소개문 (세력 선택 화면) */
  blurb?: string;
  strength?: string;
  weakness?: string;
}

/** 병종 계열 — 상성표를 n×n 이 아니라 계열 기준으로 관리한다. */
export type UnitClass = 'infantry' | 'spear' | 'cavalry' | 'archer' | 'siege' | 'navy';

export interface UnitTypeDef {
  id: UnitTypeId;
  name: string;
  /** 특정 세력 전용 병종이면 세력 ID, 공용이면 null */
  faction: FactionId | null;
  class: UnitClass;
  /** 1000명당 징병 비용 */
  cost: { gold: number; iron: number };
  attack: number;
  defense: number;
  /** 사거리(헥스). 1 = 근접 */
  range: number;
  /** 이동력(헥스) */
  move: number;
  /** 지형 계수 (생략된 지형은 1.0) */
  terrain: Partial<Record<HexTerrain, number>>;
  /** 병종 상성 — 이 병종이 해당 계열을 칠 때의 배율 (생략 시 1.0) */
  counters: Partial<Record<UnitClass, number>>;
  /** 공성병기 여부 — 성벽에 직접 피해를 준다 */
  siege?: boolean;
  /** 도하·갯벌 페널티 면제 */
  naval?: boolean;
  /** 요구 제도/특성 (없으면 항상 징병 가능) */
  requires?: string | null;
  desc?: string;
}

export interface InstitutionDef {
  id: InstitutionId;
  name: string;
  /** 반포 가능 세력 (null = 전 세력) */
  faction: FactionId | null;
  cost: { gold: number; cause?: number };
  /** 반포 요구 조건 (미니 DSL) */
  requires?: string;
  /** 귀족회의 지지도 판정 난이도 */
  councilDC: number;
  /** 반포 시 즉시 효과 */
  effects: string[];
  desc: string;
}

/** 이벤트 — 조건-효과 선언형 (시스템 상세계획 §2.4) */
export interface EventChoice {
  text: string;
  effects: string[];
  /** AI 가 이 선택지를 고를 가중치 */
  aiWeight?: number;
}

export interface EventDef {
  id: EventId;
  name: string;
  /** 역사 이벤트 여부 — "역사 이벤트 OFF" 옵션에서 제외된다 */
  historical: boolean;
  /** 발동 대상 세력 (null = 전 세력 공통) */
  faction?: FactionId | null;
  trigger: {
    year?: number;
    yearFrom?: number;
    yearTo?: number;
    /** 미니 DSL 조건식 */
    condition?: string;
    /** 발생 확률 (0~1). 생략 시 1 */
    chance?: number;
  };
  /** 1회성 여부 (기본 true) */
  once?: boolean;
  /** 사서 인용문 — 이벤트 컷 연출용 */
  quote?: string;
  source?: string;
  text: string;
  choices: EventChoice[];
}

export interface ScenarioDef {
  id: string;
  name: string;
  startYear: number;
  startSeason: Season;
  desc: string;
  /**
   * 인물 명부를 어느 창으로 거를지.
   * 'historical' — 서기 연도로 (642·551년). 생략 시 기본값.
   * 'compressed' — 원년 기준 나이로 (700년을 접은 올스타 판).
   */
  roster?: 'historical' | 'compressed';
  recommended: FactionId[];
  /** 세력별 거점 소유 */
  ownership: Record<FactionId, CastleId[]>;
  /** 인물 초기 배치. 생략된 인물은 소속 세력 도성에 자동 배치 */
  placement?: Record<OfficerId, CastleId>;
  /** 시나리오 시작 시점에 이미 죽은 것으로 처리할 인물 */
  dead?: OfficerId[];
  /** 초기 자원 (세력 기본값 덮어쓰기) */
  resources?: Record<FactionId, Partial<Record<ResourceKey, number>>>;
  /** 초기 병력 (거점별). 생략 시 병영 개발도로 자동 산출 */
  troops?: Record<CastleId, number>;
  /** 초기 외교 관계 */
  relations?: Array<{ a: FactionId; b: FactionId; status: DiploStatus; trust: number }>;
  /** 이 시나리오에서 활성화되는 이벤트 (생략 시 전체) */
  events?: EventId[];
  /**
   * 시나리오 시점의 세력 사정.
   * 같은 나라라도 연대에 따라 조정의 결속과 대외 자세가 다르다.
   * (예: 551년의 고구려는 안팎으로 흔들리는 중이었다)
   */
  factionMods?: Record<
    FactionId,
    {
      councilSupport?: number;
      autonomy?: number;
      personality?: Partial<{ aggression: number; expansion: number; diplomacy: number }>;
      note?: string;
    }
  >;
}

/* ------------------------------------------------------------------ *
 * 동적 상태
 * ------------------------------------------------------------------ */

export interface CastleState {
  id: CastleId;
  owner: FactionId | null;
  dev: Record<DevKey, number>;
  /** 주둔 병력 (명) */
  troops: number;
  /** 주둔군 병종 구성 — 합계는 troops 와 일치 */
  composition: UnitStack[];
  /** 민심 0~100 */
  loyalty: number;
  /** 주둔군 훈련도 0~100 */
  training: number;
  /** 농성용 비축 병량. 포위 시 여기서만 소모된다. */
  stock: number;
  /** 이 거점에 배치된 인물 */
  officers: OfficerId[];
  /** 이번 턴에 포위 중인 세력 */
  besiegedBy?: FactionId | null;
  /** 연속 포위 턴 수 */
  siegeTurns?: number;
  /** 이번 턴에 성벽이 입은 피해 (전투 결과 반영) */
  wallDamage?: number;
}

export interface UnitStack {
  unitType: UnitTypeId;
  count: number;
}

export interface OfficerState {
  id: OfficerId;
  faction: FactionId | null;
  /** 소속 거점. 출진 중이면 null 이고 armyId 가 채워진다. */
  location: CastleId | null;
  armyId: ArmyId | null;
  /** 충성도 0~100 */
  loyalty: number;
  /** 이번 턴 명령 사용 여부 */
  acted: boolean;
  status: 'active' | 'free' | 'captured' | 'dead';
  /** 포로로 잡은 세력 */
  captor?: FactionId | null;
  /** 재야 인물이 아직 발견되지 않았는지 */
  hidden: boolean;
  /** 성장형 인물(화랑 등)의 능력치 보정 누적 */
  growth?: Partial<OfficerDef['stats']>;
}

export interface Army {
  id: ArmyId;
  faction: FactionId;
  commander: OfficerId;
  officers: OfficerId[];
  units: UnitStack[];
  /** 현재 위치한 거점 노드 */
  location: CastleId;
  /** 남은 이동 경로 (다음 홉부터) */
  path: CastleId[];
  /** 최종 목적지 */
  target: CastleId;
  /** 휴대 병량 */
  grain: number;
  morale: number;
  training: number;
  /** 공성 방식 */
  siegeMode: 'assault' | 'encircle';
}

export interface FactionState {
  id: FactionId;
  resources: Record<ResourceKey, number>;
  /** AI 성향. factions.json 의 기본값을 시나리오가 덮어쓸 수 있다. */
  personality: { aggression: number; expansion: number; diplomacy: number };
  /** 귀족회의 지지도 0~100 */
  councilSupport: number;
  institutions: InstitutionId[];
  /** 자주성 0~100. 조공하면 내려간다. */
  autonomy: number;
  alive: boolean;
  /** 세력 단위 플래그 (이벤트 분기 기록) */
  flags: string[];
  /** AI 여부 */
  isAI: boolean;
}

export interface Relation {
  status: DiploStatus;
  /** 우호도 -100 ~ 100 */
  trust: number;
  /** 정전 협정 잔여 턴 (있는 동안 선전포고 불가) */
  truceTurns: number;
  /** status 가 'tribute' 일 때, 조공을 받는 쪽(종주국) */
  overlord?: FactionId | null;
}

export interface LogEntry {
  turn: number;
  year: number;
  season: Season;
  /** 이 로그를 볼 수 있는 세력 (null = 전체 공개) */
  faction: FactionId | null;
  kind: 'domestic' | 'military' | 'diplomacy' | 'event' | 'system' | 'battle';
  text: string;
}

export interface ChronicleEntry {
  year: number;
  season: Season;
  text: string;
}

/** 턴 결산 리포트 (⑦ 결산 화면) */
export interface TurnReport {
  turn: number;
  year: number;
  season: Season;
  faction: FactionId;
  income: { grain: number; gold: number; iron: number };
  upkeep: { grain: number };
  net: { grain: number; gold: number; iron: number };
  battles: BattleSummary[];
  highlights: string[];
}

export interface BattleSummary {
  castle: CastleId;
  castleName: string;
  attacker: FactionId;
  defender: FactionId;
  winner: FactionId;
  attackerLoss: number;
  defenderLoss: number;
  captured: boolean;
  siege: boolean;
  /** 사로잡힌 인물 */
  capturedOfficers: OfficerId[];
}

/** 전투 대기열 항목 — 턴 엔진 ④단계에서 소비 */
export interface PendingBattle {
  id: string;
  castle: CastleId;
  attacker: FactionId;
  defender: FactionId;
  attackerArmies: ArmyId[];
  /** 방어 측이 야전으로 나온 군대 */
  defenderArmies: ArmyId[];
  /** 성을 낀 전투인가 */
  siege: boolean;
  /** 플레이어가 직접 지휘하는가 */
  manual: boolean;
}

export interface PendingEvent {
  eventId: EventId;
  faction: FactionId;
}

export type GamePhase =
  | 'command' // 플레이어 명령 입력
  | 'battles' // ④ 전투 처리 단계
  | 'events' // ⑤ 이벤트 처리 단계
  | 'report' // ⑦ 결산 화면
  | 'gameover';

export interface GameOptions {
  /** 역사 이벤트 강제(ON) / 자유 샌드박스(OFF) */
  historicalEvents: boolean;
  /** 전투를 직접 지휘할지 위임할지 기본값 */
  autoBattle: boolean;
  /** 승리 조건 */
  victory: 'unification' | 'hegemony';
  difficulty: 'easy' | 'normal' | 'hard';
}

export interface GameState {
  version: number;
  scenarioId: string;
  playerFaction: FactionId;
  options: GameOptions;

  turn: number;
  year: number;
  season: Season;
  phase: GamePhase;

  factions: Record<FactionId, FactionState>;
  castles: Record<CastleId, CastleState>;
  officers: Record<OfficerId, OfficerState>;
  armies: Record<ArmyId, Army>;
  /** 외교 관계. 키는 relationKey(a,b) */
  relations: Record<string, Relation>;

  /** 결정론적 RNG 시드 */
  rng: number;
  nextId: number;

  firedEvents: EventId[];
  pendingBattles: PendingBattle[];
  pendingEvents: PendingEvent[];
  reports: TurnReport[];

  log: LogEntry[];
  chronicle: ChronicleEntry[];

  result: null | { winner: FactionId; kind: string; year: number };
}

/* ------------------------------------------------------------------ *
 * 명령 (Command)
 * ------------------------------------------------------------------ */

export type DomesticCommandKind =
  | 'develop'
  | 'conscript'
  | 'train'
  | 'patrol'
  | 'search'
  | 'stockpile';

export interface DevelopCommand {
  kind: 'develop';
  faction: FactionId;
  officer: OfficerId;
  castle: CastleId;
  target: DevKey;
}

export interface ConscriptCommand {
  kind: 'conscript';
  faction: FactionId;
  officer: OfficerId;
  castle: CastleId;
  amount: number;
  unitType: UnitTypeId;
}

export interface TrainCommand {
  kind: 'train';
  faction: FactionId;
  officer: OfficerId;
  castle: CastleId;
}

export interface PatrolCommand {
  kind: 'patrol';
  faction: FactionId;
  officer: OfficerId;
  castle: CastleId;
}

export interface SearchCommand {
  kind: 'search';
  faction: FactionId;
  officer: OfficerId;
  castle: CastleId;
}

/** 비축 — 세력 창고의 곡물을 거점 비축 병량으로 옮긴다(농성 대비). */
export interface StockpileCommand {
  kind: 'stockpile';
  faction: FactionId;
  officer: OfficerId;
  castle: CastleId;
  grain: number;
}

export interface MarchCommand {
  kind: 'march';
  faction: FactionId;
  from: CastleId;
  target: CastleId;
  commander: OfficerId;
  officers: OfficerId[];
  units: UnitStack[];
  grain: number;
  siegeMode: 'assault' | 'encircle';
}

export interface RecruitCommand {
  kind: 'recruit';
  faction: FactionId;
  officer: OfficerId;
  castle: CastleId;
  targetOfficer: OfficerId;
}

export interface CaptiveCommand {
  kind: 'captive';
  faction: FactionId;
  targetOfficer: OfficerId;
  action: 'recruit' | 'release' | 'execute';
}

export interface DiplomacyCommand {
  kind: 'diplomacy';
  faction: FactionId;
  officer: OfficerId;
  to: FactionId;
  action: 'alliance' | 'peace' | 'break' | 'declare' | 'tribute' | 'gift' | 'demand_tribute';
  gold?: number;
}

export interface InstitutionCommand {
  kind: 'institution';
  faction: FactionId;
  institution: InstitutionId;
  /** 귀족회의 반대를 무릅쓰고 강행 */
  force?: boolean;
}

export type Command =
  | DevelopCommand
  | ConscriptCommand
  | TrainCommand
  | PatrolCommand
  | SearchCommand
  | StockpileCommand
  | MarchCommand
  | RecruitCommand
  | CaptiveCommand
  | DiplomacyCommand
  | InstitutionCommand;

export type CommandKind = Command['kind'];
