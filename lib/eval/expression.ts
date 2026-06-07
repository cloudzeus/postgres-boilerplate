/**
 * Tiny safe arithmetic expression evaluator (NO eval/Function).
 * Supports: numbers, named variables, + - * / , parentheses, unary minus,
 * and functions MAX, MIN, SUM, AVG, ABS, ROUND.
 *
 * Used by the evaluation engine for DERIVED variables, e.g.
 *   "ebit / interest", "MAX(ke1, ke2, ke3)", "budget / maxKe".
 */

export type Scope = Record<string, number | null | undefined>;

const FUNCS: Record<string, (args: number[]) => number> = {
  MAX: (a) => Math.max(...a),
  MIN: (a) => Math.min(...a),
  SUM: (a) => a.reduce((s, x) => s + x, 0),
  AVG: (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0),
  ABS: (a) => Math.abs(a[0]),
  ROUND: (a) => (a.length > 1 ? Math.round(a[0] * 10 ** a[1]) / 10 ** a[1] : Math.round(a[0])),
};

type Token = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c >= '0' && c <= '9') {
      let j = i + 1;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      tokens.push({ t: 'num', v: Number(src.slice(i, j)) });
      i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      tokens.push({ t: 'id', v: src.slice(i, j) });
      i = j; continue;
    }
    if ('+-*/(),'.includes(c)) { tokens.push({ t: 'op', v: c }); i++; continue; }
    throw new Error(`Άγνωστος χαρακτήρας στη formula: "${c}"`);
  }
  return tokens;
}

/** Parses + evaluates `src` against `scope`. Throws on invalid syntax/unknown variable. */
export function evaluateExpression(src: string, scope: Scope): number {
  const tokens = tokenize(src);
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (v?: string) => {
    const tk = tokens[pos];
    if (!tk) throw new Error('Απρόσμενο τέλος formula');
    if (v && !(tk.t === 'op' && tk.v === v)) throw new Error(`Αναμενόταν "${v}"`);
    pos++; return tk;
  };

  function parseExpr(): number {
    let left = parseTerm();
    for (;;) {
      const tk = peek();
      if (tk && tk.t === 'op' && (tk.v === '+' || tk.v === '-')) {
        eat(); const right = parseTerm();
        left = tk.v === '+' ? left + right : left - right;
      } else break;
    }
    return left;
  }
  function parseTerm(): number {
    let left = parseFactor();
    for (;;) {
      const tk = peek();
      if (tk && tk.t === 'op' && (tk.v === '*' || tk.v === '/')) {
        eat(); const right = parseFactor();
        if (tk.v === '/') { if (right === 0) throw new Error('Διαίρεση με το μηδέν'); left = left / right; }
        else left = left * right;
      } else break;
    }
    return left;
  }
  function parseFactor(): number {
    const tk = peek();
    if (!tk) throw new Error('Απρόσμενο τέλος formula');
    if (tk.t === 'op' && tk.v === '-') { eat(); return -parseFactor(); }
    if (tk.t === 'op' && tk.v === '+') { eat(); return parseFactor(); }
    if (tk.t === 'op' && tk.v === '(') { eat('('); const v = parseExpr(); eat(')'); return v; }
    if (tk.t === 'num') { eat(); return tk.v; }
    if (tk.t === 'id') {
      eat();
      const next = peek();
      if (next && next.t === 'op' && next.v === '(') {
        // function call
        const fn = FUNCS[tk.v.toUpperCase()];
        if (!fn) throw new Error(`Άγνωστη συνάρτηση: ${tk.v}`);
        eat('('); const args: number[] = [];
        if (!(peek() && peek().t === 'op' && (peek() as Token).v === ')')) {
          args.push(parseExpr());
          while (peek() && peek().t === 'op' && (peek() as Token).v === ',') { eat(','); args.push(parseExpr()); }
        }
        eat(')'); return fn(args);
      }
      // variable
      const val = scope[tk.v];
      if (val == null || !Number.isFinite(val)) throw new Error(`Λείπει/μη έγκυρη τιμή μεταβλητής: ${tk.v}`);
      return val;
    }
    throw new Error('Μη έγκυρη formula');
  }

  const result = parseExpr();
  if (pos !== tokens.length) throw new Error('Περίσσευμα στη formula');
  if (!Number.isFinite(result)) throw new Error('Μη έγκυρο αποτέλεσμα formula');
  return result;
}

/** Variable identifiers referenced by an expression (for validation/UI). */
export function expressionVariables(src: string): string[] {
  const out = new Set<string>();
  const tokens = tokenize(src);
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.t === 'id') {
      const next = tokens[i + 1];
      const isFunc = next && next.t === 'op' && next.v === '(';
      if (!isFunc) out.add(tk.v);
    }
  }
  return [...out];
}
