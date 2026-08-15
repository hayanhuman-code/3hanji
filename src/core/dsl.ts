/**
 * dsl.ts — 이벤트·제도 조건식용 미니 DSL (시스템 상세계획 §3.6)
 *
 * 지원 문법:
 *   비교      year >= 642,  castles(silla) > 6,  trust(silla, baekje) <= -50
 *   논리      A AND B,  A OR B,  NOT A,  &&  ||  !
 *   괄호      (A OR B) AND C
 *   술어      owns(silla, daeya),  alliance(silla, baekje),  flag(silla, alt_history)
 *
 * 식별자는 따옴표 없이 쓴다(세력·거점·인물 ID). 술어 단독은 불리언으로 평가된다.
 *
 * 이 파서는 게임 상태를 직접 읽지 않는다. 술어 구현은 Ctx 로 주입한다 —
 * 덕분에 테스트에서 가짜 컨텍스트로 조건식만 따로 검증할 수 있다.
 */

export type DslValue = number | boolean | string;

export interface DslContext {
  /** 변수 조회 (year, season, turn 등) */
  variable(name: string): DslValue | undefined;
  /** 술어/함수 호출 */
  call(name: string, args: string[]): DslValue;
}

/* ------------------------------- 토크나이저 ------------------------------- */

type Token =
  | { t: 'num'; v: number }
  | { t: 'ident'; v: string }
  | { t: 'op'; v: string }
  | { t: 'lparen' }
  | { t: 'rparen' }
  | { t: 'comma' }
  | { t: 'eof' };

const OPERATORS = ['>=', '<=', '==', '!=', '&&', '||', '>', '<', '!', '='];

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === '(') {
      out.push({ t: 'lparen' });
      i++;
      continue;
    }
    if (ch === ')') {
      out.push({ t: 'rparen' });
      i++;
      continue;
    }
    if (ch === ',') {
      out.push({ t: 'comma' });
      i++;
      continue;
    }
    if (ch >= '0' && ch <= '9') {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      out.push({ t: 'num', v: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      out.push({ t: 'ident', v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (ch === '-' && /[0-9]/.test(src[i + 1] ?? '')) {
      let j = i + 1;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      out.push({ t: 'num', v: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (op) {
      out.push({ t: 'op', v: op === '=' ? '==' : op });
      i += op.length;
      continue;
    }
    throw new Error(`조건식 파싱 실패: 알 수 없는 문자 '${ch}' (위치 ${i}) — "${src}"`);
  }
  out.push({ t: 'eof' });
  return out;
}

/* -------------------------------- 파서 -------------------------------- */

type Node =
  | { k: 'num'; v: number }
  | { k: 'var'; name: string }
  | { k: 'call'; name: string; args: string[] }
  | { k: 'not'; e: Node }
  | { k: 'bin'; op: string; l: Node; r: Node };

class Parser {
  private pos = 0;
  constructor(private tokens: Token[], private src: string) {}

  private peek(): Token {
    return this.tokens[this.pos];
  }
  private take(): Token {
    return this.tokens[this.pos++];
  }
  private fail(msg: string): never {
    throw new Error(`조건식 파싱 실패: ${msg} — "${this.src}"`);
  }

  parse(): Node {
    const n = this.parseOr();
    if (this.peek().t !== 'eof') this.fail('식의 끝에 남은 토큰이 있습니다');
    return n;
  }

  private isKeyword(tk: Token, kw: string): boolean {
    return tk.t === 'ident' && tk.v.toUpperCase() === kw;
  }

  private parseOr(): Node {
    let left = this.parseAnd();
    for (;;) {
      const tk = this.peek();
      if ((tk.t === 'op' && tk.v === '||') || this.isKeyword(tk, 'OR')) {
        this.take();
        left = { k: 'bin', op: '||', l: left, r: this.parseAnd() };
      } else return left;
    }
  }

  private parseAnd(): Node {
    let left = this.parseCompare();
    for (;;) {
      const tk = this.peek();
      if ((tk.t === 'op' && tk.v === '&&') || this.isKeyword(tk, 'AND')) {
        this.take();
        left = { k: 'bin', op: '&&', l: left, r: this.parseCompare() };
      } else return left;
    }
  }

  private parseCompare(): Node {
    const left = this.parseUnary();
    const tk = this.peek();
    if (tk.t === 'op' && ['>=', '<=', '==', '!=', '>', '<'].includes(tk.v)) {
      this.take();
      return { k: 'bin', op: tk.v, l: left, r: this.parseUnary() };
    }
    return left;
  }

  private parseUnary(): Node {
    const tk = this.peek();
    if ((tk.t === 'op' && tk.v === '!') || this.isKeyword(tk, 'NOT')) {
      this.take();
      return { k: 'not', e: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Node {
    const tk = this.take();
    if (tk.t === 'num') return { k: 'num', v: tk.v };
    if (tk.t === 'lparen') {
      const e = this.parseOr();
      if (this.take().t !== 'rparen') this.fail("')' 가 필요합니다");
      return e;
    }
    if (tk.t === 'ident') {
      if (this.peek().t === 'lparen') {
        this.take();
        const args: string[] = [];
        if (this.peek().t !== 'rparen') {
          for (;;) {
            const a = this.take();
            if (a.t === 'ident') args.push(a.v);
            else if (a.t === 'num') args.push(String(a.v));
            else this.fail('인자는 식별자나 숫자여야 합니다');
            const nx = this.take();
            if (nx.t === 'rparen') break;
            if (nx.t !== 'comma') this.fail("',' 또는 ')' 가 필요합니다");
          }
        } else {
          this.take();
        }
        return { k: 'call', name: tk.v, args };
      }
      return { k: 'var', name: tk.v };
    }
    this.fail('예상치 못한 토큰');
  }
}

/* ------------------------------- 평가기 ------------------------------- */

function truthy(v: DslValue | undefined): boolean {
  if (v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return v.length > 0;
}

function evalNode(n: Node, ctx: DslContext): DslValue {
  switch (n.k) {
    case 'num':
      return n.v;
    case 'var': {
      const upper = n.name.toUpperCase();
      if (upper === 'TRUE') return true;
      if (upper === 'FALSE') return false;
      const v = ctx.variable(n.name);
      if (v === undefined) {
        // 인자 없는 술어로도 시도해 본다.
        return ctx.call(n.name, []);
      }
      return v;
    }
    case 'call':
      return ctx.call(n.name, n.args);
    case 'not':
      return !truthy(evalNode(n.e, ctx));
    case 'bin': {
      if (n.op === '&&') return truthy(evalNode(n.l, ctx)) && truthy(evalNode(n.r, ctx));
      if (n.op === '||') return truthy(evalNode(n.l, ctx)) || truthy(evalNode(n.r, ctx));
      const l = evalNode(n.l, ctx);
      const r = evalNode(n.r, ctx);
      switch (n.op) {
        case '==':
          return l === r;
        case '!=':
          return l !== r;
        case '>':
          return Number(l) > Number(r);
        case '<':
          return Number(l) < Number(r);
        case '>=':
          return Number(l) >= Number(r);
        case '<=':
          return Number(l) <= Number(r);
        default:
          throw new Error(`알 수 없는 연산자 ${n.op}`);
      }
    }
  }
}

/** 파싱 결과 캐시 — 매 턴 전체 이벤트를 평가하므로 캐시가 유효하다. */
const cache = new Map<string, Node>();

export function parseCondition(src: string): Node {
  const hit = cache.get(src);
  if (hit) return hit;
  const node = new Parser(tokenize(src), src).parse();
  cache.set(src, node);
  return node;
}

/** 조건식을 평가한다. 파싱 오류는 그대로 던진다(데이터 검증기가 잡는다). */
export function evaluate(src: string, ctx: DslContext): boolean {
  if (!src || !src.trim()) return true;
  return truthy(evalNode(parseCondition(src), ctx));
}

/** 검증 전용 — 문법만 확인한다. */
export function validateCondition(src: string): string | null {
  try {
    parseCondition(src);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
