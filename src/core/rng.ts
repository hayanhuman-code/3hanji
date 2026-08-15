/**
 * 결정론적 난수 생성기 (mulberry32).
 *
 * 게임 상태에 시드를 담아 직렬화하므로
 *  - 세이브/로드 후에도 같은 결과가 재현되고
 *  - 헤드리스 시뮬레이션(밸런싱)에서 동일 시드로 반복 검증이 가능하다.
 *
 * 사용 패턴: `const [v, next] = rand(state.rng)` 형태로 시드를 반드시 전파한다.
 * 편의를 위해 가변 커서 객체(RngCursor)도 제공한다.
 */

export function nextSeed(seed: number): number {
  return (seed + 0x6d2b79f5) | 0;
}

/** 시드 하나로부터 0~1 난수를 뽑는다. */
export function randomFrom(seed: number): number {
  let t = seed + 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export class RngCursor {
  constructor(public seed: number) {}

  /** 0 <= x < 1 */
  next(): number {
    this.seed = nextSeed(this.seed);
    return randomFrom(this.seed);
  }

  /** min <= x <= max (정수) */
  int(min: number, max: number): number {
    if (max < min) return min;
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** min <= x < max (실수) */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** 확률 p 로 true */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T | undefined {
    if (items.length === 0) return undefined;
    return items[Math.floor(this.next() * items.length)];
  }

  /** 가중치 기반 선택 */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T | undefined {
    const total = items.reduce((s, it) => s + Math.max(0, weight(it)), 0);
    if (total <= 0) return this.pick(items);
    let r = this.next() * total;
    for (const it of items) {
      r -= Math.max(0, weight(it));
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }

  shuffle<T>(items: T[]): T[] {
    const arr = items.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /** ±spread 범위의 변동 계수 (1을 중심으로) */
  jitter(spread: number): number {
    return 1 + this.float(-spread, spread);
  }
}

/** 문자열 → 시드 (시나리오 ID 등으로 초기 시드 생성) */
export function seedFromString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}
