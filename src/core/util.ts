/** 잡다한 순수 유틸. 게임 규칙을 담지 않는다. */

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function sum(nums: readonly number[]): number {
  let t = 0;
  for (const n of nums) t += n;
  return t;
}

export function deepClone<T>(v: T): T {
  return structuredClone(v);
}

/** 외교 관계 키 — 순서 무관하게 동일 키를 만든다. */
export function relationKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** 숫자를 1,234 형태로 */
export function fmt(n: number): string {
  return Math.round(n).toLocaleString('ko-KR');
}

/** 큰 병력 수를 "1.2만" 형태로 */
export function fmtTroops(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}만`;
  return fmt(n);
}

export function groupBy<T, K extends string>(items: readonly T[], key: (t: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const it of items) {
    const k = key(it);
    (out[k] ||= []).push(it);
  }
  return out;
}

export function unique<T>(items: readonly T[]): T[] {
  return Array.from(new Set(items));
}

/**
 * 거점 그래프 최단 경로 (BFS).
 * @param neighbors 노드 → 인접 노드 목록
 * @returns from 제외, to 포함 경로. 도달 불가면 null.
 */
export function findPath(
  from: string,
  to: string,
  neighbors: (id: string) => readonly string[],
  passable?: (id: string) => boolean
): string[] | null {
  if (from === to) return [];
  const prev = new Map<string, string>();
  const seen = new Set<string>([from]);
  const queue: string[] = [from];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    for (const nb of neighbors(cur)) {
      if (seen.has(nb)) continue;
      seen.add(nb);
      prev.set(nb, cur);
      if (nb === to) {
        const path: string[] = [];
        let node = to;
        while (node !== from) {
          path.unshift(node);
          node = prev.get(node) as string;
        }
        return path;
      }
      // 목적지가 아닌 중간 노드는 통행 가능해야 계속 확장한다.
      if (!passable || passable(nb)) queue.push(nb);
    }
  }
  return null;
}
