/* ============================================================
   WEND — the language that can walk back the way it came
   Core: lexer, Pratt parser, steppable generator interpreter
   with deterministic replay, write-tracking (variable history),
   pattern matching, and data-wrangling builtins.
   Works in browser (window.Wend) and Node (module.exports).
   ============================================================ */
(function (global) {
  "use strict";

  /* ---------------- errors ---------------- */
  class WendError extends Error {
    constructor(kind, message, start, end, line, col) {
      super(message);
      this.kind = kind; // 'syntax' | 'runtime'
      this.start = start; this.end = end;
      this.line = line; this.col = col;
    }
  }
  function synErr(msg, start, end, line, col) {
    return new WendError("syntax", msg, start, end, line, col);
  }
  function rtErr(msg, node) {
    return new WendError("runtime", msg, node ? node.start : 0, node ? node.end : 0,
      node ? node.line : 1, node ? node.col : 1);
  }

  /* ---------------- lexer ---------------- */
  const KEYWORDS = new Set(["let", "fn", "if", "else", "while", "for", "in",
    "return", "break", "continue", "true", "false", "nil", "and", "or", "not", "match"]);

  const isDigit = c => c >= "0" && c <= "9";
  const isIdStart = c => /[A-Za-z_]/.test(c);
  const isIdChar = c => /[A-Za-z0-9_]/.test(c);

  // token: {type, value, start, end, line, col}
  // types: NUM STR IDENT KW OP NL EOF ERROR COMMENT(tolerant only)
  function lex(src, base = 0, baseLine = 1, baseCol = 1, tolerant = false) {
    const toks = [];
    let i = 0, line = baseLine, col = baseCol;
    const n = src.length;
    const push = (type, value, start, end, l, c) =>
      toks.push({ type, value, start: base + start, end: base + end, line: l, col: c });
    const fail = (msg, start, end, l, c) => {
      if (tolerant) { push("ERROR", src.slice(start, end), start, end, l, c); return; }
      throw synErr(msg, base + start, base + end, l, c);
    };
    while (i < n) {
      const c = src[i];
      const startL = line, startC = col, start = i;
      if (c === "\n") { push("NL", "\n", i, i + 1, line, col); i++; line++; col = 1; continue; }
      if (c === " " || c === "\t" || c === "\r") { i++; col++; continue; }
      if (c === "/" && src[i + 1] === "/") {
        let j = i;
        while (j < n && src[j] !== "\n") j++;
        if (tolerant) push("COMMENT", src.slice(i, j), i, j, line, col);
        col += j - i; i = j; continue;
      }
      if (isDigit(c)) {
        let j = i, seenDot = false;
        while (j < n) {
          const d = src[j];
          if (isDigit(d)) { j++; continue; }
          if (d === "." && !seenDot && isDigit(src[j + 1])) { seenDot = true; j++; continue; }
          break;
        }
        push("NUM", parseFloat(src.slice(i, j)), i, j, startL, startC);
        col += j - i; i = j; continue;
      }
      if (isIdStart(c)) {
        let j = i;
        while (j < n && isIdChar(src[j])) j++;
        const word = src.slice(i, j);
        push(KEYWORDS.has(word) ? "KW" : "IDENT", word, i, j, startL, startC);
        col += j - i; i = j; continue;
      }
      if (c === '"') {
        // string with {expr} interpolation
        const parts = []; // {kind:'str',value} | {kind:'expr',src,offset,line,col}
        let buf = "", j = i + 1, l = line, cc = col + 1;
        let closed = false;
        while (j < n) {
          const d = src[j];
          if (d === '"') { closed = true; j++; cc++; break; }
          if (d === "\n") break;
          if (d === "\\") {
            const e = src[j + 1];
            const map = { n: "\n", t: "\t", '"': '"', "\\": "\\", "{": "{", "}": "}" };
            if (e in map) { buf += map[e]; j += 2; cc += 2; continue; }
            fail("Unknown escape \\" + (e || ""), j, j + 2, l, cc);
            j += 2; cc += 2; continue;
          }
          if (d === "{") {
            if (buf) { parts.push({ kind: "str", value: buf }); buf = ""; }
            // scan to matching } (brace-depth aware, quote aware)
            let depth = 1, k = j + 1, kl = l, kc = cc + 1;
            const exOff = k, exLine = kl, exCol = kc;
            let inner = "";
            while (k < n && depth > 0) {
              const g = src[k];
              if (g === '"') { // nested string: skip it
                inner += g; k++; kc++;
                while (k < n && src[k] !== '"' && src[k] !== "\n") {
                  if (src[k] === "\\") { inner += src[k]; k++; kc++; }
                  inner += src[k]; k++; kc++;
                }
                if (src[k] === '"') { inner += '"'; k++; kc++; }
                continue;
              }
              if (g === "{") depth++;
              if (g === "}") { depth--; if (depth === 0) break; }
              if (g === "\n") break;
              inner += g; k++; kc++;
            }
            if (src[k] !== "}") {
              fail("Unclosed { in string interpolation", j, k, l, cc);
              j = k; break;
            }
            parts.push({ kind: "expr", src: inner, offset: base + exOff, line: exLine, col: exCol });
            cc += (k + 1 - j); j = k + 1; continue;
          }
          buf += d; j++; cc++;
        }
        if (!closed) {
          fail("Unterminated string", i, j, startL, startC);
          if (buf) parts.push({ kind: "str", value: buf });
          push("STR", { parts }, i, j, startL, startC);
          col += j - i; i = j; continue;
        }
        if (buf) parts.push({ kind: "str", value: buf });
        push("STR", { parts }, i, j, startL, startC);
        col += j - i; i = j; continue;
      }
      // operators
      if (src.slice(i, i + 3) === "...") {
        push("OP", "...", i, i + 3, startL, startC); i += 3; col += 3; continue;
      }
      const two = src.slice(i, i + 2);
      const twos = ["==", "!=", "<=", ">=", "|>", "..", "+=", "-=", "->"];
      if (twos.includes(two)) {
        push("OP", two, i, i + 2, startL, startC); i += 2; col += 2; continue;
      }
      if ("+-*/%<>=(){}[],.:!".includes(c)) {
        push("OP", c, i, i + 1, startL, startC); i++; col++; continue;
      }
      fail("Unexpected character '" + c + "'", i, i + 1, startL, startC);
      i++; col++;
    }
    push("EOF", null, n, n, line, col);
    return toks;
  }

  // Filter newlines for the parser: collapse & drop where continuation is obvious.
  const PREV_DROP = new Set(["(", "[", "{", ",", "+", "-", "*", "/", "%", "==", "!=",
    "<", ">", "<=", ">=", "=", "|>", "..", "+=", "-=", ":", ".", "->", "..."]);
  const PREV_DROP_KW = new Set(["and", "or", "not", "else", "in", "return_NO"]);
  const NEXT_DROP = new Set(["|>", ".", "+", "*", "/", "%", "==", "!=", "<", ">", "<=", ">=", ".."]);
  const NEXT_DROP_KW = new Set(["and", "or", "else"]);

  function filterNewlines(toks) {
    const out = [];
    const stack = []; // innermost open bracket decides whether NLs matter
    for (let idx = 0; idx < toks.length; idx++) {
      const t = toks[idx];
      if (t.type === "OP") {
        if (t.value === "(" || t.value === "[" || t.value === "{") stack.push(t.value);
        else if (t.value === ")" || t.value === "]" || t.value === "}") stack.pop();
      }
      if (t.type !== "NL") { out.push(t); continue; }
      const top = stack[stack.length - 1];
      if (top === "(" || top === "[") continue; // inside parens/brackets: free-form
      const prev = out[out.length - 1];
      let next = null;
      for (let j = idx + 1; j < toks.length; j++) {
        if (toks[j].type !== "NL") { next = toks[j]; break; }
      }
      if (prev && ((prev.type === "OP" && PREV_DROP.has(prev.value)) ||
                   (prev.type === "KW" && PREV_DROP_KW.has(prev.value)))) continue;
      if (next && ((next.type === "OP" && NEXT_DROP.has(next.value)) ||
                   (next.type === "KW" && NEXT_DROP_KW.has(next.value)))) continue;
      if (prev && prev.type === "NL") continue;
      if (!prev || prev.type === "NL") continue;
      out.push(t);
    }
    return out;
  }

  /* ---------------- parser ---------------- */
  // Precedence
  const PREC = { PIPE: 1, OR: 2, AND: 3, EQ: 4, CMP: 5, RANGE: 6, ADD: 7, MUL: 8, UNARY: 9, POST: 10 };

  class Parser {
    constructor(toks, src) { this.toks = toks; this.i = 0; this.src = src; }
    peek(k = 0) { return this.toks[Math.min(this.i + k, this.toks.length - 1)]; }
    next() { return this.toks[this.i++]; }
    at(type, value) {
      const t = this.peek();
      return t.type === type && (value === undefined || t.value === value);
    }
    atOp(v) { return this.at("OP", v); }
    atKw(v) { return this.at("KW", v); }
    eat(type, value) { if (this.at(type, value)) return this.next(); return null; }
    expect(type, value, what) {
      const t = this.peek();
      if (this.at(type, value)) return this.next();
      throw synErr("Expected " + (what || value || type) + " but found " + describeTok(t),
        t.start, Math.max(t.end, t.start + 1), t.line, t.col);
    }
    skipNL() { while (this.at("NL")) this.next(); }

    parseProgram() {
      const body = [];
      this.skipNL();
      while (!this.at("EOF")) {
        body.push(this.parseStmt());
        this.terminator();
      }
      return { type: "Program", body, start: 0, end: this.src.length, line: 1, col: 1 };
    }

    terminator() {
      if (this.at("EOF") || this.atOp("}")) return;
      const t = this.peek();
      if (this.at("NL")) { this.skipNL(); return; }
      throw synErr("Expected end of statement but found " + describeTok(t),
        t.start, Math.max(t.end, t.start + 1), t.line, t.col);
    }

    parseStmt() {
      this.skipNL();
      const t = this.peek();
      if (t.type === "KW") {
        switch (t.value) {
          case "let": return this.parseLet();
          case "fn": {
            // fn name(...) {...} is a declaration; `fn (` is an anonymous fn expression
            const t2 = this.peek(1);
            if (t2.type === "IDENT") return this.parseFnDecl();
            break;
          }
          case "while": return this.parseWhile();
          case "for": return this.parseFor();
          case "return": return this.parseReturn();
          case "break": { const k = this.next(); return { type: "Break", ...spanOf(k) }; }
          case "continue": { const k = this.next(); return { type: "Continue", ...spanOf(k) }; }
        }
      }
      // expression / assignment
      const expr = this.parseExpr(0);
      if (this.atOp("=") || this.atOp("+=") || this.atOp("-=")) {
        const op = this.next();
        if (!["Ident", "Index", "Member"].includes(expr.type)) {
          throw synErr("Cannot assign to this expression", expr.start, expr.end, expr.line, expr.col);
        }
        const value = this.parseExpr(0);
        return { type: "Assign", target: expr, op: op.value, value,
          start: expr.start, end: value.end, line: expr.line, col: expr.col };
      }
      return { type: "ExprStmt", expr, ...spanOf(expr) };
    }

    parseLet() {
      const kw = this.next();
      if (this.atOp("[") || this.atOp("{")) {
        const pattern = this.parsePattern();
        this.expect("OP", "=", "'='");
        const value = this.parseExpr(0);
        return { type: "LetPattern", pattern, value,
          start: kw.start, end: value.end, line: kw.line, col: kw.col };
      }
      const name = this.expect("IDENT", undefined, "a variable name");
      this.expect("OP", "=", "'='");
      const value = this.parseExpr(0);
      return { type: "Let", name: name.value, nameStart: name.start, nameEnd: name.end,
        value, start: kw.start, end: value.end, line: kw.line, col: kw.col };
    }

    /* patterns: literal | _ | name | a..b | [p, ..., ...rest] | {k, k: p} */
    parsePattern() {
      const t = this.peek();
      if (t.type === "NUM") {
        this.next();
        if (this.atOp("..")) {
          this.next();
          const hi = this.expect("NUM", undefined, "a number to end the range");
          return { type: "PatRange", from: t.value, to: hi.value,
            start: t.start, end: hi.end, line: t.line, col: t.col };
        }
        return { type: "PatLit", value: t.value, ...spanOf(t) };
      }
      if (t.type === "OP" && t.value === "-" && this.peek(1).type === "NUM") {
        this.next(); const n = this.next();
        if (this.atOp("..")) {
          this.next();
          let neg = false;
          if (this.atOp("-")) { this.next(); neg = true; }
          const hi = this.expect("NUM", undefined, "a number to end the range");
          return { type: "PatRange", from: -n.value, to: neg ? -hi.value : hi.value,
            start: t.start, end: hi.end, line: t.line, col: t.col };
        }
        return { type: "PatLit", value: -n.value, start: t.start, end: n.end, line: t.line, col: t.col };
      }
      if (t.type === "STR") {
        this.next();
        const parts = t.value.parts;
        if (parts.length > 1 || (parts[0] && parts[0].kind !== "str")) {
          throw synErr("Patterns cannot use interpolated strings", t.start, t.end, t.line, t.col);
        }
        return { type: "PatLit", value: parts.length ? parts[0].value : "", ...spanOf(t) };
      }
      if (t.type === "KW" && ["true", "false", "nil"].includes(t.value)) {
        this.next();
        return { type: "PatLit", value: t.value === "nil" ? null : t.value === "true", ...spanOf(t) };
      }
      if (t.type === "IDENT") {
        this.next();
        if (t.value === "_") return { type: "PatWild", ...spanOf(t) };
        return { type: "PatBind", name: t.value, ...spanOf(t) };
      }
      if (t.type === "OP" && t.value === "[") {
        const open = this.next();
        const items = []; let rest = null;
        this.skipNL();
        while (!this.atOp("]")) {
          if (this.atOp("...")) {
            this.next();
            const name = this.expect("IDENT", undefined, "a name after '...'");
            rest = name.value;
            this.skipNL();
            break;
          }
          items.push(this.parsePattern());
          if (this.eat("OP", ",")) { this.skipNL(); continue; }
          break;
        }
        this.skipNL();
        const close = this.expect("OP", "]", "']'");
        return { type: "PatArray", items, rest,
          start: open.start, end: close.end, line: open.line, col: open.col };
      }
      if (t.type === "OP" && t.value === "{") {
        const open = this.next();
        const entries = [];
        this.skipNL();
        while (!this.atOp("}")) {
          const key = this.expect("IDENT", undefined, "a key name");
          let pat = null;
          if (this.eat("OP", ":")) pat = this.parsePattern();
          entries.push({ key: key.value, pat });
          if (this.eat("OP", ",")) { this.skipNL(); continue; }
          break;
        }
        this.skipNL();
        const close = this.expect("OP", "}", "'}'");
        return { type: "PatMap", entries,
          start: open.start, end: close.end, line: open.line, col: open.col };
      }
      throw synErr("Expected a pattern but found " + describeTok(t),
        t.start, Math.max(t.end, t.start + 1), t.line, t.col);
    }

    parseMatch() {
      const kw = this.next(); // 'match'
      const subject = this.parseExpr(0);
      this.expect("OP", "{", "'{' to open the match arms");
      const arms = [];
      this.skipNL();
      while (!this.atOp("}")) {
        if (this.at("EOF")) throw synErr("Unclosed match — missing '}'", kw.start, kw.end, kw.line, kw.col);
        const pattern = this.parsePattern();
        this.expect("OP", "->", "'->' after the pattern");
        let body;
        if (this.atOp("{")) body = this.parseBlock();
        else body = this.parseExpr(0);
        arms.push({ pattern, body });
        if (this.eat("OP", ",")) { this.skipNL(); continue; }
        this.skipNL();
      }
      const close = this.next();
      return { type: "Match", subject, arms,
        start: kw.start, end: close.end, line: kw.line, col: kw.col };
    }

    parseFnDecl() {
      const kw = this.next();
      const name = this.expect("IDENT", undefined, "a function name");
      const { params, body, end } = this.parseFnRest();
      return { type: "FnDecl", name: name.value, params, body,
        start: kw.start, end, line: kw.line, col: kw.col };
    }

    parseFnRest() {
      this.expect("OP", "(", "'('");
      const params = [];
      this.skipNL();
      if (!this.atOp(")")) {
        for (;;) {
          const p = this.expect("IDENT", undefined, "a parameter name");
          params.push(p.value);
          if (this.eat("OP", ",")) { this.skipNL(); if (this.atOp(")")) break; continue; }
          break;
        }
      }
      this.expect("OP", ")", "')'");
      const body = this.parseBlock();
      return { params, body, end: body.end };
    }

    parseBlock() {
      const open = this.expect("OP", "{", "'{'");
      const body = [];
      this.skipNL();
      while (!this.atOp("}")) {
        if (this.at("EOF")) {
          throw synErr("Unclosed block — missing '}'", open.start, open.end, open.line, open.col);
        }
        body.push(this.parseStmt());
        this.terminator();
        this.skipNL();
      }
      const close = this.next();
      return { type: "Block", body, start: open.start, end: close.end, line: open.line, col: open.col };
    }

    parseWhile() {
      const kw = this.next();
      const cond = this.parseExpr(0);
      const body = this.parseBlock();
      return { type: "While", cond, body, start: kw.start, end: body.end, line: kw.line, col: kw.col };
    }

    parseFor() {
      const kw = this.next();
      const name = this.expect("IDENT", undefined, "a loop variable");
      this.expect("KW", "in", "'in'");
      const iter = this.parseExpr(0);
      const body = this.parseBlock();
      return { type: "For", name: name.value, iter, body,
        start: kw.start, end: body.end, line: kw.line, col: kw.col };
    }

    parseReturn() {
      const kw = this.next();
      let value = null;
      if (!this.at("NL") && !this.atOp("}") && !this.at("EOF")) value = this.parseExpr(0);
      return { type: "Return", value, start: kw.start,
        end: value ? value.end : kw.end, line: kw.line, col: kw.col };
    }

    parseIfExpr() {
      const kw = this.next(); // 'if'
      const cond = this.parseExpr(0);
      const then = this.parseBlock();
      let alt = null;
      // allow `} else` on same filtered stream (NL before else was dropped)
      if (this.atKw("else")) {
        this.next();
        if (this.atKw("if")) alt = this.parseIfExpr();
        else alt = this.parseBlock();
      }
      return { type: "If", cond, then, alt,
        start: kw.start, end: (alt || then).end, line: kw.line, col: kw.col };
    }

    parseExpr(minPrec) {
      let left = this.parseUnary();
      for (;;) {
        const t = this.peek();
        let prec = null, op = null;
        if (t.type === "OP") {
          op = t.value;
          if (op === "|>") prec = PREC.PIPE;
          else if (op === "==" || op === "!=") prec = PREC.EQ;
          else if (op === "<" || op === ">" || op === "<=" || op === ">=") prec = PREC.CMP;
          else if (op === "..") prec = PREC.RANGE;
          else if (op === "+" || op === "-") prec = PREC.ADD;
          else if (op === "*" || op === "/" || op === "%") prec = PREC.MUL;
        } else if (t.type === "KW") {
          if (t.value === "or") { op = "or"; prec = PREC.OR; }
          else if (t.value === "and") { op = "and"; prec = PREC.AND; }
        }
        if (prec === null || prec < minPrec) return left;
        this.next();
        if (op === "|>") {
          const rhs = this.parseExpr(PREC.PIPE + 1);
          left = pipeToCall(left, rhs);
          continue;
        }
        const right = this.parseExpr(prec + 1);
        left = { type: op === "and" || op === "or" ? "Logical" : (op === ".." ? "Range" : "Binary"),
          op, left, right, start: left.start, end: right.end, line: left.line, col: left.col };
      }
    }

    parseUnary() {
      const t = this.peek();
      if (t.type === "OP" && t.value === "-") {
        this.next();
        const arg = this.parseUnary();
        return { type: "Unary", op: "-", arg, start: t.start, end: arg.end, line: t.line, col: t.col };
      }
      if (t.type === "KW" && t.value === "not") {
        this.next();
        const arg = this.parseUnary();
        return { type: "Unary", op: "not", arg, start: t.start, end: arg.end, line: t.line, col: t.col };
      }
      return this.parsePostfix();
    }

    parsePostfix() {
      let expr = this.parsePrimary();
      for (;;) {
        if (this.atOp("(")) {
          const open = this.next();
          const args = [];
          this.skipNL();
          if (!this.atOp(")")) {
            for (;;) {
              args.push(this.parseExpr(0));
              if (this.eat("OP", ",")) { this.skipNL(); if (this.atOp(")")) break; continue; }
              break;
            }
          }
          const close = this.expect("OP", ")", "')'");
          expr = { type: "Call", callee: expr, args,
            start: expr.start, end: close.end, line: expr.line, col: expr.col };
          continue;
        }
        if (this.atOp("[")) {
          this.next();
          const index = this.parseExpr(0);
          const close = this.expect("OP", "]", "']'");
          expr = { type: "Index", obj: expr, index,
            start: expr.start, end: close.end, line: expr.line, col: expr.col };
          continue;
        }
        if (this.atOp(".")) {
          this.next();
          const name = this.expect("IDENT", undefined, "a property name");
          expr = { type: "Member", obj: expr, name: name.value,
            start: expr.start, end: name.end, line: expr.line, col: expr.col };
          continue;
        }
        return expr;
      }
    }

    parsePrimary() {
      const t = this.peek();
      if (t.type === "NUM") { this.next(); return { type: "Num", value: t.value, ...spanOf(t) }; }
      if (t.type === "STR") {
        this.next();
        const parts = t.value.parts.map(p => {
          if (p.kind === "str") return { kind: "str", value: p.value };
          // sub-parse the interpolated expression
          const subToks = filterNewlines(lex(p.src, p.offset, p.line, p.col));
          const sub = new Parser(subToks, p.src);
          const e = sub.parseExpr(0);
          const rest = sub.peek();
          if (rest.type !== "EOF") {
            throw synErr("Unexpected " + describeTok(rest) + " in string interpolation",
              rest.start, Math.max(rest.end, rest.start + 1), rest.line, rest.col);
          }
          return { kind: "expr", expr: e };
        });
        if (parts.length === 1 && parts[0].kind === "str") {
          return { type: "Str", value: parts[0].value, ...spanOf(t) };
        }
        if (parts.length === 0) return { type: "Str", value: "", ...spanOf(t) };
        return { type: "Interp", parts, ...spanOf(t) };
      }
      if (t.type === "IDENT") { this.next(); return { type: "Ident", name: t.value, ...spanOf(t) }; }
      if (t.type === "KW") {
        if (t.value === "true" || t.value === "false") {
          this.next(); return { type: "Bool", value: t.value === "true", ...spanOf(t) };
        }
        if (t.value === "nil") { this.next(); return { type: "Nil", ...spanOf(t) }; }
        if (t.value === "fn") {
          const kw = this.next();
          const { params, body, end } = this.parseFnRest();
          return { type: "FnExpr", params, body, start: kw.start, end, line: kw.line, col: kw.col };
        }
        if (t.value === "if") return this.parseIfExpr();
        if (t.value === "match") return this.parseMatch();
      }
      if (t.type === "OP") {
        if (t.value === "(") {
          this.next();
          this.skipNL();
          const e = this.parseExpr(0);
          this.skipNL();
          this.expect("OP", ")", "')'");
          return e;
        }
        if (t.value === "[") {
          const open = this.next();
          const items = [];
          this.skipNL();
          if (!this.atOp("]")) {
            for (;;) {
              items.push(this.parseExpr(0));
              if (this.eat("OP", ",")) { this.skipNL(); if (this.atOp("]")) break; continue; }
              break;
            }
          }
          this.skipNL();
          const close = this.expect("OP", "]", "']'");
          return { type: "ArrayLit", items, start: open.start, end: close.end, line: open.line, col: open.col };
        }
        if (t.value === "{") {
          const open = this.next();
          const entries = [];
          this.skipNL();
          if (!this.atOp("}")) {
            for (;;) {
              this.skipNL();
              let key;
              if (this.at("IDENT")) key = this.next().value;
              else if (this.at("STR")) {
                const s = this.next();
                if (s.value.parts.length > 1 || (s.value.parts[0] && s.value.parts[0].kind !== "str")) {
                  throw synErr("Map keys cannot be interpolated strings", s.start, s.end, s.line, s.col);
                }
                key = s.value.parts.length ? s.value.parts[0].value : "";
              } else {
                const bad = this.peek();
                throw synErr("Expected a map key but found " + describeTok(bad),
                  bad.start, Math.max(bad.end, bad.start + 1), bad.line, bad.col);
              }
              this.expect("OP", ":", "':'");
              const value = this.parseExpr(0);
              entries.push({ key, value });
              if (this.eat("OP", ",")) { this.skipNL(); if (this.atOp("}")) break; continue; }
              break;
            }
          }
          this.skipNL();
          const close = this.expect("OP", "}", "'}'");
          return { type: "MapLit", entries, start: open.start, end: close.end, line: open.line, col: open.col };
        }
      }
      throw synErr("Expected an expression but found " + describeTok(t),
        t.start, Math.max(t.end, t.start + 1), t.line, t.col);
    }
  }

  function spanOf(t) { return { start: t.start, end: t.end, line: t.line, col: t.col }; }

  function describeTok(t) {
    if (t.type === "EOF") return "end of file";
    if (t.type === "NL") return "end of line";
    if (t.type === "STR") return "a string";
    if (t.type === "NUM") return "'" + t.value + "'";
    return "'" + t.value + "'";
  }

  function pipeToCall(lhs, rhs) {
    if (rhs.type === "Call") {
      return { ...rhs, args: [lhs, ...rhs.args], start: lhs.start, line: lhs.line, col: lhs.col };
    }
    if (rhs.type === "Ident" || rhs.type === "Member" || rhs.type === "FnExpr") {
      return { type: "Call", callee: rhs, args: [lhs],
        start: lhs.start, end: rhs.end, line: lhs.line, col: lhs.col };
    }
    throw synErr("The right side of |> must be a function or call",
      rhs.start, rhs.end, rhs.line, rhs.col);
  }

  function parse(src) {
    const toks = filterNewlines(lex(src));
    return new Parser(toks, src).parseProgram();
  }

  /* ---------------- values & runtime ---------------- */
  class Scope {
    constructor(parent, label) { this.vars = new Map(); this.parent = parent; this.label = label || null; }
    get(name, node) {
      let s = this;
      while (s) { if (s.vars.has(name)) return s.vars.get(name); s = s.parent; }
      throw rtErr("'" + name + "' is not defined" + suggest(name, this), node);
    }
    set(name, v, node) {
      let s = this;
      while (s) { if (s.vars.has(name)) { s.vars.set(name, v); return; } s = s.parent; }
      throw rtErr("Cannot assign to '" + name + "' — it was never declared (use `let " + name + " = ...`)", node);
    }
    declare(name, v) { this.vars.set(name, v); }
    has(name) { let s = this; while (s) { if (s.vars.has(name)) return true; s = s.parent; } return false; }
  }

  function suggest(name, scope) {
    const names = [];
    let s = scope;
    while (s) { for (const k of s.vars.keys()) names.push(k); s = s.parent; }
    let best = null, bestD = 3;
    for (const cand of names) {
      const d = editDist(name, cand);
      if (d < bestD) { bestD = d; best = cand; }
    }
    return best ? " — did you mean '" + best + "'?" : "";
  }
  function editDist(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 9;
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    return dp[a.length][b.length];
  }

  class FableFn {
    constructor(name, params, body, closure) {
      this.name = name; this.params = params; this.body = body; this.closure = closure;
    }
  }
  class NativeFn {
    constructor(name, fn) { this.name = name; this.fn = fn; } // fn is a generator function (interp, args, node)
  }
  class RangeVal {
    constructor(from, to) { this.from = from; this.to = to; }
    toArray() {
      const out = [];
      if (this.from <= this.to) for (let i = this.from; i <= this.to; i++) out.push(i);
      else for (let i = this.from; i >= this.to; i--) out.push(i);
      return out;
    }
    get length() { return Math.abs(this.to - this.from) + 1; }
  }

  const NIL = null;
  function truthy(v) { return v !== false && v !== NIL; }

  function typeName(v) {
    if (v === NIL) return "nil";
    if (typeof v === "number") return "number";
    if (typeof v === "string") return "string";
    if (typeof v === "boolean") return "bool";
    if (Array.isArray(v)) return "array";
    if (v instanceof Map) return "map";
    if (v instanceof RangeVal) return "range";
    if (v instanceof FableFn || v instanceof NativeFn) return "fn";
    return "unknown";
  }

  function fmtNum(x) {
    if (Number.isInteger(x)) return String(x);
    return String(Math.round(x * 1e10) / 1e10);
  }

  function repr(v, depth = 0) {
    if (v === NIL) return "nil";
    if (typeof v === "number") return fmtNum(v);
    if (typeof v === "boolean") return String(v);
    if (typeof v === "string") return depth === 0 ? v : '"' + v + '"';
    if (Array.isArray(v)) {
      if (depth > 3) return "[…]";
      return "[" + v.map(x => repr(x, depth + 1)).join(", ") + "]";
    }
    if (v instanceof Map) {
      if (depth > 3) return "{…}";
      const es = [];
      for (const [k, val] of v) es.push(k + ": " + repr(val, depth + 1));
      return "{" + es.join(", ") + "}";
    }
    if (v instanceof RangeVal) return v.from + ".." + v.to;
    if (v instanceof FableFn) return "fn " + (v.name || "(anonymous)") + "(" + v.params.join(", ") + ")";
    if (v instanceof NativeFn) return "fn " + v.name + " (built-in)";
    return String(v);
  }

  function eq(a, b) {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!eq(a[i], b[i])) return false;
      return true;
    }
    if (a instanceof RangeVal && b instanceof RangeVal) return a.from === b.from && a.to === b.to;
    return false;
  }

  /* control-flow signals */
  class ReturnSig { constructor(v) { this.value = v; } }
  class BreakSig {}
  class ContinueSig {}

  /* ---------------- pattern matching ---------------- */
  // returns null (no match) or a Map of bindings
  function matchPattern(pat, v) {
    switch (pat.type) {
      case "PatWild": return new Map();
      case "PatBind": { const m = new Map(); m.set(pat.name, v); return m; }
      case "PatLit": return eq(pat.value, v) ? new Map() : null;
      case "PatRange":
        return (typeof v === "number" && v >= Math.min(pat.from, pat.to) &&
          v <= Math.max(pat.from, pat.to)) ? new Map() : null;
      case "PatArray": {
        let arr = v;
        if (v instanceof RangeVal) arr = v.toArray();
        if (!Array.isArray(arr)) return null;
        if (pat.rest === null && arr.length !== pat.items.length) return null;
        if (pat.rest !== null && arr.length < pat.items.length) return null;
        const out = new Map();
        for (let i = 0; i < pat.items.length; i++) {
          const m = matchPattern(pat.items[i], arr[i]);
          if (!m) return null;
          for (const [k, val] of m) out.set(k, val);
        }
        if (pat.rest !== null) out.set(pat.rest, arr.slice(pat.items.length));
        return out;
      }
      case "PatMap": {
        if (!(v instanceof Map)) return null;
        const out = new Map();
        for (const e of pat.entries) {
          if (!v.has(e.key)) return null;
          const sub = v.get(e.key);
          if (e.pat) {
            const m = matchPattern(e.pat, sub);
            if (!m) return null;
            for (const [k, val] of m) out.set(k, val);
          } else {
            out.set(e.key, sub);
          }
        }
        return out;
      }
    }
    return null;
  }

  function patternDesc(pat) {
    switch (pat.type) {
      case "PatWild": return "_";
      case "PatBind": return pat.name;
      case "PatLit": return repr(pat.value, 1);
      case "PatRange": return pat.from + ".." + pat.to;
      case "PatArray": return "[" + pat.items.map(patternDesc).join(", ") +
        (pat.rest !== null ? ", ..." + pat.rest : "") + "]";
      case "PatMap": return "{" + pat.entries.map(e => e.key + (e.pat ? ": " + patternDesc(e.pat) : "")).join(", ") + "}";
    }
    return "?";
  }

  /* deterministic RNG (mulberry32) so every run can be replayed exactly */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------------- JS <-> Wend value bridge ---------------- */
  function fromJS(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
    if (Array.isArray(v)) return v.map(fromJS);
    if (typeof v === "object") {
      const m = new Map();
      for (const k of Object.keys(v)) m.set(k, fromJS(v[k]));
      return m;
    }
    return String(v);
  }
  function toJS(v) {
    if (v === null) return null;
    if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
    if (Array.isArray(v)) return v.map(toJS);
    if (v instanceof RangeVal) return v.toArray();
    if (v instanceof Map) {
      const o = {};
      for (const [k, val] of v) o[String(k)] = toJS(val);
      return o;
    }
    return repr(v);
  }

  /* ---------------- CSV ---------------- */
  function parseCSVText(text) {
    const rows = [];
    let row = [], field = "", inQ = false, i = 0;
    const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    while (i < s.length) {
      const c = s[i];
      if (inQ) {
        if (c === '"') {
          if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQ = true; i++; continue; }
      if (c === ",") { row.push(field); field = ""; i++; continue; }
      if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += c; i++;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    const clean = rows.filter(r => !(r.length === 1 && r[0].trim() === ""));
    if (!clean.length) return [];
    const headers = clean[0].map(h => h.trim());
    return clean.slice(1).map(r => {
      const m = new Map();
      for (let j = 0; j < headers.length; j++) {
        let val = r[j] === undefined ? "" : r[j];
        const num = val.trim() === "" ? NaN : Number(val);
        m.set(headers[j], Number.isNaN(num) ? val : num);
      }
      return m;
    });
  }
  function toCSVText(rows) {
    if (!rows.length) return "";
    const headers = [...(rows[0] instanceof Map ? rows[0].keys() : [])];
    const esc = x => {
      const s = x === null ? "" : String(typeof x === "number" ? fmtNum(x) : x);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [headers.map(esc).join(",")];
    for (const r of rows) {
      lines.push(headers.map(h => esc(r instanceof Map && r.has(h) ? r.get(h) : "")).join(","));
    }
    return lines.join("\n");
  }

  /* rows -> {headers, cells} of display strings (for table()) */
  function tabulate(rows) {
    const headers = [];
    for (const r of rows) {
      if (r instanceof Map) for (const k of r.keys()) if (!headers.includes(k)) headers.push(k);
    }
    const cell = v => (typeof v === "string" ? v : repr(v, 1));
    if (!headers.length) {
      return { headers: ["value"], cells: rows.map(r => [cell(r)]) };
    }
    const cells = rows.map(r => headers.map(h =>
      (r instanceof Map && r.has(h)) ? cell(r.get(h)) : ""));
    return { headers, cells };
  }

  /* ---------------- builtins ---------------- */
  function wantArray(v, node, what) {
    if (Array.isArray(v)) return v;
    if (v instanceof RangeVal) return v.toArray();
    if (typeof v === "string") return v.split("");
    throw rtErr(what + " needs an array, range, or string — got " + typeName(v), node);
  }
  function checkNum(v, node, what) {
    if (typeof v !== "number") throw rtErr(what + " needs a number — got " + typeName(v), node);
    return v;
  }
  function checkStr(v, node, what) {
    if (typeof v !== "string") throw rtErr(what + " needs a string — got " + typeName(v), node);
    return v;
  }
  function checkFn(v, node, what) {
    if (!(v instanceof FableFn) && !(v instanceof NativeFn)) {
      throw rtErr(what + " needs a function — got " + typeName(v), node);
    }
    return v;
  }

  function makeBuiltins() {
    const B = new Map();
    const def = (name, fn) => B.set(name, new NativeFn(name, fn));

    def("print", function* (I, args) {
      I.print(args.map(a => repr(a)).join(" "));
      return NIL;
    });
    def("len", function* (I, args, node) {
      const v = args[0];
      if (typeof v === "string") return v.length;
      if (Array.isArray(v)) return v.length;
      if (v instanceof Map) return v.size;
      if (v instanceof RangeVal) return v.length;
      throw rtErr("len needs a string, array, map, or range — got " + typeName(v), node);
    });
    def("push", function* (I, args, node) {
      if (!Array.isArray(args[0])) throw rtErr("push needs an array — got " + typeName(args[0]), node);
      args[0].push(args[1] === undefined ? NIL : args[1]);
      return args[0];
    });
    def("pop", function* (I, args, node) {
      if (!Array.isArray(args[0])) throw rtErr("pop needs an array — got " + typeName(args[0]), node);
      if (!args[0].length) throw rtErr("pop on an empty array", node);
      return args[0].pop();
    });
    def("keys", function* (I, args, node) {
      if (!(args[0] instanceof Map)) throw rtErr("keys needs a map — got " + typeName(args[0]), node);
      return [...args[0].keys()];
    });
    def("values", function* (I, args, node) {
      if (!(args[0] instanceof Map)) throw rtErr("values needs a map — got " + typeName(args[0]), node);
      return [...args[0].values()];
    });
    def("has", function* (I, args, node) {
      if (args[0] instanceof Map) return args[0].has(args[1]);
      if (Array.isArray(args[0])) return args[0].some(x => eq(x, args[1]));
      if (typeof args[0] === "string") return args[0].includes(String(args[1]));
      throw rtErr("has needs a map, array, or string", node);
    });
    def("map", function* (I, args, node) {
      const arr = wantArray(args[0], node, "map");
      const f = checkFn(args[1], node, "map");
      const out = [];
      for (let i = 0; i < arr.length; i++) out.push(yield* I.callFn(f, [arr[i], i], node));
      return out;
    });
    def("filter", function* (I, args, node) {
      const arr = wantArray(args[0], node, "filter");
      const f = checkFn(args[1], node, "filter");
      const out = [];
      for (let i = 0; i < arr.length; i++) {
        if (truthy(yield* I.callFn(f, [arr[i], i], node))) out.push(arr[i]);
      }
      return out;
    });
    def("reduce", function* (I, args, node) {
      const arr = wantArray(args[0], node, "reduce");
      const f = checkFn(args[1], node, "reduce");
      let acc = args.length > 2 ? args[2] : NIL;
      let start = 0;
      if (args.length <= 2) {
        if (!arr.length) throw rtErr("reduce on an empty collection needs an initial value", node);
        acc = arr[0]; start = 1;
      }
      for (let i = start; i < arr.length; i++) acc = yield* I.callFn(f, [acc, arr[i]], node);
      return acc;
    });
    def("sum", function* (I, args, node) {
      const arr = wantArray(args[0], node, "sum");
      let s = 0;
      for (const x of arr) s += checkNum(x, node, "sum");
      return s;
    });
    def("sort", function* (I, args, node) {
      const arr = wantArray(args[0], node, "sort").slice();
      if (args[1]) {
        const f = checkFn(args[1], node, "sort");
        // simple stable merge sort so we can yield through the comparator
        const merge = function* (a, b) {
          const out = [];
          let i = 0, j = 0;
          while (i < a.length && j < b.length) {
            const k = yield* I.callFn(f, [a[i], b[j]], node);
            if (checkNum(k, node, "sort comparator") <= 0) out.push(a[i++]); else out.push(b[j++]);
          }
          return out.concat(a.slice(i), b.slice(j));
        };
        const ms = function* (a) {
          if (a.length <= 1) return a;
          const mid = a.length >> 1;
          const l = yield* ms(a.slice(0, mid));
          const r = yield* ms(a.slice(mid));
          return yield* merge(l, r);
        };
        return yield* ms(arr);
      }
      return arr.sort((a, b) => {
        if (typeof a === "number" && typeof b === "number") return a - b;
        return String(repr(a)).localeCompare(String(repr(b)));
      });
    });
    def("reverse", function* (I, args, node) {
      const v = args[0];
      if (typeof v === "string") return v.split("").reverse().join("");
      return wantArray(v, node, "reverse").slice().reverse();
    });
    def("join", function* (I, args, node) {
      const arr = wantArray(args[0], node, "join");
      const sep = args.length > 1 ? checkStr(args[1], node, "join separator") : "";
      return arr.map(x => repr(x)).join(sep);
    });
    def("split", function* (I, args, node) {
      const s = checkStr(args[0], node, "split");
      const sep = args.length > 1 ? checkStr(args[1], node, "split separator") : "";
      return s.split(sep);
    });
    def("upper", function* (I, args, node) { return checkStr(args[0], node, "upper").toUpperCase(); });
    def("lower", function* (I, args, node) { return checkStr(args[0], node, "lower").toLowerCase(); });
    def("trim", function* (I, args, node) { return checkStr(args[0], node, "trim").trim(); });
    def("abs", function* (I, args, node) { return Math.abs(checkNum(args[0], node, "abs")); });
    def("floor", function* (I, args, node) { return Math.floor(checkNum(args[0], node, "floor")); });
    def("ceil", function* (I, args, node) { return Math.ceil(checkNum(args[0], node, "ceil")); });
    def("round", function* (I, args, node) { return Math.round(checkNum(args[0], node, "round")); });
    def("sqrt", function* (I, args, node) { return Math.sqrt(checkNum(args[0], node, "sqrt")); });
    def("pow", function* (I, args, node) {
      return Math.pow(checkNum(args[0], node, "pow"), checkNum(args[1], node, "pow"));
    });
    def("min", function* (I, args, node) {
      const arr = args.length === 1 ? wantArray(args[0], node, "min") : args;
      if (!arr.length) throw rtErr("min of nothing", node);
      return arr.reduce((a, b) => (checkNum(b, node, "min") < a ? b : a), checkNum(arr[0], node, "min"));
    });
    def("max", function* (I, args, node) {
      const arr = args.length === 1 ? wantArray(args[0], node, "max") : args;
      if (!arr.length) throw rtErr("max of nothing", node);
      return arr.reduce((a, b) => (checkNum(b, node, "max") > a ? b : a), checkNum(arr[0], node, "max"));
    });
    def("random", function* (I) { return I.rng(); });
    def("num", function* (I, args, node) {
      const x = parseFloat(args[0]);
      if (Number.isNaN(x)) throw rtErr("Cannot convert " + repr(args[0]) + " to a number", node);
      return x;
    });
    def("str", function* (I, args) { return repr(args[0]); });
    def("type", function* (I, args) { return typeName(args[0]); });
    def("chars", function* (I, args, node) { return checkStr(args[0], node, "chars").split(""); });

    /* ---- data wrangling ---- */
    def("parse_json", function* (I, args, node) {
      const s = checkStr(args[0], node, "parse_json");
      try { return fromJS(JSON.parse(s)); }
      catch (e) { throw rtErr("That is not valid JSON — " + e.message, node); }
    });
    def("to_json", function* (I, args, node) {
      const indent = args.length > 1 ? checkNum(args[1], node, "to_json indent") : 0;
      return JSON.stringify(toJS(args[0]), null, indent || undefined) || "null";
    });
    def("parse_csv", function* (I, args, node) {
      return parseCSVText(checkStr(args[0], node, "parse_csv"));
    });
    def("to_csv", function* (I, args, node) {
      return toCSVText(wantArray(args[0], node, "to_csv"));
    });
    def("table", function* (I, args, node) {
      const rows = wantArray(args[0], node, "table");
      const { headers, cells } = tabulate(rows);
      if (I.onTable) { I.onTable(headers, cells); return NIL; }
      // plain-text fallback
      const widths = headers.map((h, i) =>
        Math.max(h.length, ...cells.map(r => r[i].length), 1));
      const line = (cols, pad) => cols.map((c, i) => c[pad](widths[i])).join("  ");
      I.print(line(headers, "padEnd"));
      I.print(widths.map(w => "─".repeat(w)).join("  "));
      for (const r of cells) I.print(line(r, "padEnd"));
      return NIL;
    });
    def("group_by", function* (I, args, node) {
      const arr = wantArray(args[0], node, "group_by");
      const f = checkFn(args[1], node, "group_by");
      const m = new Map();
      for (let i = 0; i < arr.length; i++) {
        let k = yield* I.callFn(f, [arr[i], i], node);
        if (typeof k !== "string" && typeof k !== "number" && typeof k !== "boolean") k = repr(k, 1);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(arr[i]);
      }
      return m;
    });
    def("count_by", function* (I, args, node) {
      const arr = wantArray(args[0], node, "count_by");
      const f = checkFn(args[1], node, "count_by");
      const m = new Map();
      for (let i = 0; i < arr.length; i++) {
        let k = yield* I.callFn(f, [arr[i], i], node);
        if (typeof k !== "string" && typeof k !== "number" && typeof k !== "boolean") k = repr(k, 1);
        m.set(k, (m.get(k) || 0) + 1);
      }
      return m;
    });
    def("sort_by", function* (I, args, node) {
      const arr = wantArray(args[0], node, "sort_by").slice();
      const f = checkFn(args[1], node, "sort_by");
      const keyed = [];
      for (let i = 0; i < arr.length; i++) keyed.push([yield* I.callFn(f, [arr[i], i], node), arr[i]]);
      keyed.sort((a, b) => {
        if (typeof a[0] === "number" && typeof b[0] === "number") return a[0] - b[0];
        return String(a[0]).localeCompare(String(b[0]));
      });
      return keyed.map(k => k[1]);
    });
    def("unique", function* (I, args, node) {
      const arr = wantArray(args[0], node, "unique");
      const out = [];
      for (const x of arr) if (!out.some(y => eq(x, y))) out.push(x);
      return out;
    });
    def("flatten", function* (I, args, node) {
      const arr = wantArray(args[0], node, "flatten");
      const out = [];
      for (const x of arr) {
        if (Array.isArray(x)) out.push(...x);
        else if (x instanceof RangeVal) out.push(...x.toArray());
        else out.push(x);
      }
      return out;
    });
    def("zip", function* (I, args, node) {
      const a = wantArray(args[0], node, "zip"), b = wantArray(args[1], node, "zip");
      const out = [];
      for (let i = 0; i < Math.min(a.length, b.length); i++) out.push([a[i], b[i]]);
      return out;
    });
    def("take", function* (I, args, node) {
      return wantArray(args[0], node, "take").slice(0, checkNum(args[1], node, "take"));
    });
    def("drop", function* (I, args, node) {
      return wantArray(args[0], node, "drop").slice(checkNum(args[1], node, "drop"));
    });
    def("first", function* (I, args, node) {
      const a = wantArray(args[0], node, "first");
      return a.length ? a[0] : NIL;
    });
    def("last", function* (I, args, node) {
      const a = wantArray(args[0], node, "last");
      return a.length ? a[a.length - 1] : NIL;
    });
    def("find", function* (I, args, node) {
      const arr = wantArray(args[0], node, "find");
      const f = checkFn(args[1], node, "find");
      for (let i = 0; i < arr.length; i++) {
        if (truthy(yield* I.callFn(f, [arr[i], i], node))) return arr[i];
      }
      return NIL;
    });
    def("any", function* (I, args, node) {
      const arr = wantArray(args[0], node, "any");
      const f = checkFn(args[1], node, "any");
      for (let i = 0; i < arr.length; i++) {
        if (truthy(yield* I.callFn(f, [arr[i], i], node))) return true;
      }
      return false;
    });
    def("all", function* (I, args, node) {
      const arr = wantArray(args[0], node, "all");
      const f = checkFn(args[1], node, "all");
      for (let i = 0; i < arr.length; i++) {
        if (!truthy(yield* I.callFn(f, [arr[i], i], node))) return false;
      }
      return true;
    });
    def("avg", function* (I, args, node) {
      const arr = wantArray(args[0], node, "avg");
      if (!arr.length) throw rtErr("avg of an empty collection", node);
      let s = 0;
      for (const x of arr) s += checkNum(x, node, "avg");
      return s / arr.length;
    });
    def("slice", function* (I, args, node) {
      const v = args[0];
      const a = checkNum(args[1], node, "slice"), b = args.length > 2 ? checkNum(args[2], node, "slice") : undefined;
      if (typeof v === "string") return v.slice(a, b);
      return wantArray(v, node, "slice").slice(a, b);
    });
    def("replace", function* (I, args, node) {
      return checkStr(args[0], node, "replace")
        .split(checkStr(args[1], node, "replace")).join(checkStr(args[2], node, "replace"));
    });
    def("starts_with", function* (I, args, node) {
      return checkStr(args[0], node, "starts_with").startsWith(checkStr(args[1], node, "starts_with"));
    });
    def("ends_with", function* (I, args, node) {
      return checkStr(args[0], node, "ends_with").endsWith(checkStr(args[1], node, "ends_with"));
    });
    return B;
  }

  /* ---------------- interpreter ---------------- */
  class Interpreter {
    constructor(src, opts = {}) {
      this.src = src;
      this.maxSteps = opts.maxSteps || 2_000_000;
      this.maxDepth = opts.maxDepth || 200;
      this.onPrint = opts.onPrint || (() => {});
      this.onTable = opts.onTable || null;   // (headers, cells) for rich table output
      this.onWrite = opts.onWrite || null;   // (name, value, node) — variable history
      this.seed = (opts.seed === undefined) ? 1 : opts.seed;
      this.rng = mulberry32(this.seed);
      this.steps = 0;
      this.globals = new Scope(null, "globals");
      for (const [k, v] of makeBuiltins()) this.globals.declare(k, v);
      if (opts.inject) {
        for (const k of Object.keys(opts.inject)) this.globals.declare(k, opts.inject[k]);
      }
      this.callStack = [];
      this.ast = parse(src); // throws WendError(syntax)
      this.result = undefined;
    }

    wrote(name, value, node) {
      if (this.onWrite) this.onWrite(name, value, node);
    }

    print(line) { this.onPrint(line); }

    frame() { return this.callStack[this.callStack.length - 1]; }

    *tick(node, scope, note) {
      this.steps++;
      if (this.steps > this.maxSteps) {
        throw rtErr("The story ran too long (over " + this.maxSteps.toLocaleString() +
          " steps) — possible infinite loop?", node);
      }
      const f = this.frame();
      if (f) { f.node = node; f.scope = scope; }
      yield { node, scope, note: note || null, depth: this.callStack.length };
    }

    *run() {
      const scope = new Scope(this.globals, "program");
      this.callStack.push({ name: "story", fnName: null, scope, node: this.ast, callNode: null });
      let last = NIL;
      try {
        for (const stmt of this.ast.body) last = yield* this.exec(stmt, scope);
      } finally {
        this.callStack.pop();
      }
      this.result = last;
      return last;
    }

    /* execute a statement; returns its value (for implicit results) */
    *exec(node, scope) {
      switch (node.type) {
        case "Let": {
          yield* this.tick(node, scope, "declare " + node.name);
          const v = yield* this.eval(node.value, scope);
          scope.declare(node.name, v);
          this.wrote(node.name, v, node);
          return NIL;
        }
        case "LetPattern": {
          yield* this.tick(node, scope, "destructure");
          const v = yield* this.eval(node.value, scope);
          const bindings = matchPattern(node.pattern, v);
          if (!bindings) {
            throw rtErr("The value " + repr(v, 1) + " does not fit the pattern " +
              patternDesc(node.pattern), node);
          }
          for (const [k, val] of bindings) { scope.declare(k, val); this.wrote(k, val, node); }
          return NIL;
        }
        case "FnDecl": {
          yield* this.tick({ ...node, end: node.body.start }, scope, "define fn " + node.name);
          scope.declare(node.name, new FableFn(node.name, node.params, node.body, scope));
          return NIL;
        }
        case "Assign": {
          yield* this.tick(node, scope, "assign");
          let v = yield* this.eval(node.value, scope);
          if (node.op !== "=") {
            const cur = yield* this.readTarget(node.target, scope);
            v = this.binop(node.op === "+=" ? "+" : "-", cur, v, node);
          }
          yield* this.writeTarget(node.target, v, scope);
          // history: log the root variable's new value
          let root = node.target;
          while (root.type === "Index" || root.type === "Member") root = root.obj;
          if (root.type === "Ident") {
            this.wrote(root.name, scope.has(root.name) ? scope.get(root.name, root) : v, node);
          }
          return NIL;
        }
        case "ExprStmt":
          return yield* this.eval(node.expr, scope);
        case "While": {
          for (;;) {
            yield* this.tick(node.cond, scope, "while: check");
            const c = yield* this.eval(node.cond, scope);
            if (!truthy(c)) break;
            try {
              yield* this.execBlock(node.body, new Scope(scope, "while"));
            } catch (e) {
              if (e instanceof BreakSig) break;
              if (e instanceof ContinueSig) continue;
              throw e;
            }
          }
          return NIL;
        }
        case "For": {
          yield* this.tick(node.iter, scope, "for: source");
          const src = yield* this.eval(node.iter, scope);
          let items;
          if (Array.isArray(src)) items = src.slice();
          else if (src instanceof RangeVal) items = src.toArray();
          else if (typeof src === "string") items = src.split("");
          else if (src instanceof Map) items = [...src.keys()];
          else throw rtErr("Cannot loop over a " + typeName(src), node.iter);
          for (const item of items) {
            const inner = new Scope(scope, "for");
            inner.declare(node.name, item);
            this.wrote(node.name, item, node);
            yield* this.tick({ ...node, end: node.body.start }, inner,
              "for: " + node.name + " = " + repr(item, 1));
            try {
              yield* this.execBlock(node.body, inner);
            } catch (e) {
              if (e instanceof BreakSig) break;
              if (e instanceof ContinueSig) continue;
              throw e;
            }
          }
          return NIL;
        }
        case "Return": {
          yield* this.tick(node, scope, "return");
          const v = node.value ? yield* this.eval(node.value, scope) : NIL;
          throw new ReturnSig(v);
        }
        case "Break":
          yield* this.tick(node, scope, "break");
          throw new BreakSig();
        case "Continue":
          yield* this.tick(node, scope, "continue");
          throw new ContinueSig();
        default:
          throw rtErr("Unknown statement " + node.type, node);
      }
    }

    *execBlock(block, scope) {
      let last = NIL;
      for (const stmt of block.body) last = yield* this.exec(stmt, scope);
      return last;
    }

    *readTarget(t, scope) {
      if (t.type === "Ident") return scope.get(t.name, t);
      if (t.type === "Index") {
        const obj = yield* this.eval(t.obj, scope);
        const idx = yield* this.eval(t.index, scope);
        return this.indexGet(obj, idx, t);
      }
      if (t.type === "Member") {
        const obj = yield* this.eval(t.obj, scope);
        return this.memberGet(obj, t.name, t);
      }
      throw rtErr("Bad assignment target", t);
    }

    *writeTarget(t, v, scope) {
      if (t.type === "Ident") { scope.set(t.name, v, t); return; }
      if (t.type === "Index") {
        const obj = yield* this.eval(t.obj, scope);
        const idx = yield* this.eval(t.index, scope);
        if (Array.isArray(obj)) {
          const i = this.arrIndex(obj, idx, t);
          obj[i] = v; return;
        }
        if (obj instanceof Map) { obj.set(idx, v); return; }
        throw rtErr("Cannot index-assign into a " + typeName(obj), t);
      }
      if (t.type === "Member") {
        const obj = yield* this.eval(t.obj, scope);
        if (obj instanceof Map) { obj.set(t.name, v); return; }
        throw rtErr("Cannot set ." + t.name + " on a " + typeName(obj), t);
      }
      throw rtErr("Bad assignment target", t);
    }

    arrIndex(arr, idx, node) {
      if (typeof idx !== "number" || !Number.isInteger(idx)) {
        throw rtErr("Array index must be a whole number — got " + repr(idx), node);
      }
      let i = idx;
      if (i < 0) i += arr.length;
      if (i < 0 || i >= arr.length) {
        throw rtErr("Index " + idx + " is out of range (length " + arr.length + ")", node);
      }
      return i;
    }

    indexGet(obj, idx, node) {
      if (Array.isArray(obj)) return obj[this.arrIndex(obj, idx, node)];
      if (typeof obj === "string") {
        const i = this.arrIndex(obj.split(""), idx, node);
        return obj[i];
      }
      if (obj instanceof Map) return obj.has(idx) ? obj.get(idx) : NIL;
      if (obj instanceof RangeVal) return this.indexGet(obj.toArray(), idx, node);
      throw rtErr("Cannot index into a " + typeName(obj), node);
    }

    memberGet(obj, name, node) {
      if (obj instanceof Map) return obj.has(name) ? obj.get(name) : NIL;
      throw rtErr("Cannot read ." + name + " of a " + typeName(obj), node);
    }

    binop(op, a, b, node) {
      switch (op) {
        case "+":
          if (typeof a === "number" && typeof b === "number") return a + b;
          if (typeof a === "string" || typeof b === "string") return repr(a) + repr(b);
          if (Array.isArray(a) && Array.isArray(b)) return a.concat(b);
          throw rtErr("Cannot add " + typeName(a) + " and " + typeName(b), node);
        case "-": case "*": case "/": case "%": {
          if (typeof a !== "number" || typeof b !== "number") {
            throw rtErr("Cannot " + ({ "-": "subtract", "*": "multiply", "/": "divide", "%": "take remainder of" })[op] +
              " " + typeName(a) + " and " + typeName(b), node);
          }
          if (op === "-") return a - b;
          if (op === "*") return a * b;
          if (op === "/") {
            if (b === 0) throw rtErr("Division by zero", node);
            return a / b;
          }
          if (b === 0) throw rtErr("Remainder by zero", node);
          return ((a % b) + b) % b;
        }
        case "<": case ">": case "<=": case ">=": {
          if (typeof a === "number" && typeof b === "number") { /* ok */ }
          else if (typeof a === "string" && typeof b === "string") { /* ok */ }
          else throw rtErr("Cannot compare " + typeName(a) + " with " + typeName(b), node);
          if (op === "<") return a < b;
          if (op === ">") return a > b;
          if (op === "<=") return a <= b;
          return a >= b;
        }
        case "==": return eq(a, b);
        case "!=": return !eq(a, b);
      }
      throw rtErr("Unknown operator " + op, node);
    }

    *eval(node, scope) {
      switch (node.type) {
        case "Num": return node.value;
        case "Str": return node.value;
        case "Bool": return node.value;
        case "Nil": return NIL;
        case "Ident":
          yield* this.tick(node, scope);
          return scope.get(node.name, node);
        case "Interp": {
          yield* this.tick(node, scope, "build string");
          let out = "";
          for (const p of node.parts) {
            if (p.kind === "str") out += p.value;
            else out += repr(yield* this.eval(p.expr, scope));
          }
          return out;
        }
        case "ArrayLit": {
          yield* this.tick(node, scope);
          const out = [];
          for (const it of node.items) out.push(yield* this.eval(it, scope));
          return out;
        }
        case "MapLit": {
          yield* this.tick(node, scope);
          const m = new Map();
          for (const e of node.entries) m.set(e.key, yield* this.eval(e.value, scope));
          return m;
        }
        case "FnExpr":
          return new FableFn(null, node.params, node.body, scope);
        case "Range": {
          const a = yield* this.eval(node.left, scope);
          const b = yield* this.eval(node.right, scope);
          yield* this.tick(node, scope);
          if (typeof a !== "number" || typeof b !== "number" ||
              !Number.isInteger(a) || !Number.isInteger(b)) {
            throw rtErr("Ranges need whole numbers on both sides", node);
          }
          if (Math.abs(b - a) > 5_000_000) throw rtErr("That range is too large", node);
          return new RangeVal(a, b);
        }
        case "Unary": {
          const v = yield* this.eval(node.arg, scope);
          yield* this.tick(node, scope);
          if (node.op === "-") {
            if (typeof v !== "number") throw rtErr("Cannot negate a " + typeName(v), node);
            return -v;
          }
          return !truthy(v);
        }
        case "Logical": {
          const l = yield* this.eval(node.left, scope);
          yield* this.tick(node, scope, node.op);
          if (node.op === "and") return truthy(l) ? yield* this.eval(node.right, scope) : l;
          return truthy(l) ? l : yield* this.eval(node.right, scope);
        }
        case "Binary": {
          const a = yield* this.eval(node.left, scope);
          const b = yield* this.eval(node.right, scope);
          yield* this.tick(node, scope, node.op);
          return this.binop(node.op, a, b, node);
        }
        case "If": {
          yield* this.tick(node.cond, scope, "if: check");
          const c = yield* this.eval(node.cond, scope);
          if (truthy(c)) return yield* this.execBlock(node.then, new Scope(scope, "if"));
          if (node.alt) {
            if (node.alt.type === "If") return yield* this.eval(node.alt, scope);
            return yield* this.execBlock(node.alt, new Scope(scope, "else"));
          }
          return NIL;
        }
        case "Index": {
          const obj = yield* this.eval(node.obj, scope);
          const idx = yield* this.eval(node.index, scope);
          yield* this.tick(node, scope);
          return this.indexGet(obj, idx, node);
        }
        case "Member": {
          const obj = yield* this.eval(node.obj, scope);
          yield* this.tick(node, scope);
          return this.memberGet(obj, node.name, node);
        }
        case "Match": {
          yield* this.tick({ ...node, end: node.subject.end }, scope, "match");
          const v = yield* this.eval(node.subject, scope);
          for (const arm of node.arms) {
            const bindings = matchPattern(arm.pattern, v);
            if (bindings) {
              yield* this.tick(arm.pattern, scope, "matched " + patternDesc(arm.pattern));
              const inner = new Scope(scope, "match");
              for (const [k, val] of bindings) { inner.declare(k, val); this.wrote(k, val, arm.pattern); }
              if (arm.body.type === "Block") return yield* this.execBlock(arm.body, inner);
              return yield* this.eval(arm.body, inner);
            }
          }
          throw rtErr("No pattern matched " + repr(v, 1) +
            " — add a '_' arm to catch everything else", node);
        }
        case "Call": {
          const callee = yield* this.eval(node.callee, scope);
          const args = [];
          for (const a of node.args) args.push(yield* this.eval(a, scope));
          yield* this.tick(node, scope, "call " + calleeName(node, callee));
          return yield* this.callFn(callee, args, node);
        }
        default:
          throw rtErr("Unknown expression " + node.type, node);
      }
    }

    *callFn(callee, args, node) {
      if (callee instanceof NativeFn) {
        return yield* callee.fn(this, args, node);
      }
      if (!(callee instanceof FableFn)) {
        throw rtErr("This is a " + typeName(callee) + ", not a function — it cannot be called", node);
      }
      if (this.callStack.length >= this.maxDepth) {
        throw rtErr("The call stack grew too deep (" + this.maxDepth + " frames) — runaway recursion?", node);
      }
      const scope = new Scope(callee.closure, "fn " + (callee.name || "anonymous"));
      for (let i = 0; i < callee.params.length; i++) {
        scope.declare(callee.params[i], i < args.length ? args[i] : NIL);
      }
      this.callStack.push({
        name: callee.name || "fn(" + callee.params.join(", ") + ")",
        fnName: callee.name, scope, node: callee.body, callNode: node,
      });
      try {
        const v = yield* this.execBlock(callee.body, scope);
        return v; // implicit: value of last statement
      } catch (e) {
        if (e instanceof ReturnSig) return e.value;
        throw e;
      } finally {
        this.callStack.pop();
      }
    }
  }

  function calleeName(node, callee) {
    if (node.callee.type === "Ident") return node.callee.name;
    if (callee instanceof FableFn && callee.name) return callee.name;
    if (callee instanceof NativeFn) return callee.name;
    return "fn";
  }

  /* ---------------- highlighting support ---------------- */
  // Tolerant token stream for the editor: covers the whole source.
  function highlightTokens(src) {
    let toks;
    toks = lex(src, 0, 1, 1, true);
    const out = [];
    for (const t of toks) {
      if (t.type === "EOF") continue;
      let cls = null;
      if (t.type === "NUM") cls = "num";
      else if (t.type === "STR") cls = "str";
      else if (t.type === "COMMENT") cls = "com";
      else if (t.type === "KW") {
        cls = ["true", "false", "nil"].includes(t.value) ? "lit" : "kw";
      } else if (t.type === "IDENT") cls = "id";
      else if (t.type === "OP") cls = "op";
      else if (t.type === "ERROR") cls = "bad";
      if (cls) out.push({ start: t.start, end: t.end, cls, value: t.value });
    }
    return out;
  }

  const Wend = {
    lex, parse, Interpreter, WendError, repr, typeName, highlightTokens,
    RangeVal, FableFn, NativeFn, fromJS, toJS, parseCSVText, toCSVText, tabulate,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = Wend;
  else global.Wend = Wend;
})(typeof window !== "undefined" ? window : globalThis);

