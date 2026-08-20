// Auto-extracted from studentnote.html — shared HWPX parsing/rendering
// core used by both studentnote.html (오답노트 생성) and problembank.html
// (업로드 사전검증). Keep in sync by re-running
// scratchpad/extract_lib.js after any change to the corresponding
// function in studentnote.html — do not let the two drift.

function findTopLevelBlocks(xml, tagName) {
  const blocks = [];
  let depth = 0, start = -1;
  const tokenRe = new RegExp(`<${tagName}\\b[^>]*?/>|<${tagName}\\b[^>]*?>|</${tagName}>`, 'g');
  let m;
  const closeTag = `</${tagName}>`;
  while ((m = tokenRe.exec(xml)) !== null) {
    const tok = m[0];
    if (tok.endsWith('/>')) continue;
    if (tok === closeTag) {
      if (depth > 0) {
        depth--;
        if (depth === 0) blocks.push({ start, end: m.index + tok.length, text: xml.slice(start, m.index + tok.length) });
      }
    } else {
      if (depth === 0) start = m.index;
      depth++;
    }
  }
  return blocks;
}

function stripTags(s) { return s.replace(/<[^>]+>/g, ''); }

// The endnote's own auto-numbering marker (its "1)" reference label) is a
// <hp:ctrl><hp:autoNum .../></hp:ctrl> tied to that ORIGINAL location —
// copying it onto the quick-answer page (which already has its own "N번"
// label) would duplicate/misplace that marker, so strip just that ctrl and
// keep everything else (the actual answer text/equation) intact.
function stripAutoNumCtrls(runXml) {
  const ctrls = findTopLevelBlocks(runXml, 'hp:ctrl');
  let out = runXml;
  for (const c of ctrls) {
    if (c.text.includes('<hp:autoNum')) out = out.replace(c.text, '');
  }
  return out;
}

// A run's own <hp:ctrl> can wrap an entire <hp:endNote> (or footnote/header/
// footer) subtree, which itself contains ordinary <hp:t>/<hp:equation> —
// e.g. the endnote's "[정답] ② ... [풀이] ..." answer text. Since
// extractOrderedChildren just scans the WHOLE run string for those tags
// regardless of nesting depth, an unstripped ctrl leaks the endnote's
// answer/explanation text into the visible question body, ahead of the
// question's own real text. Ctrl-wrapped content is never part of a
// question's visible body, so it's dropped wholesale before extraction
// (the endnote's own content is separately pulled via
// extractQuickAnswerXml/extractEndnoteFullBodyXml for the answer/
// explanation sections).
function stripCtrlBlocks(runXml) {
  const ctrls = findTopLevelBlocks(runXml, 'hp:ctrl');
  let out = runXml;
  for (const c of ctrls) out = out.replace(c.text, '');
  return out;
}

// "그냥 복붙" — copy the endnote's own first NON-BLANK line (a paragraph
// inside its <hp:subList>) verbatim, AS REAL CONTENT — including any
// <hp:equation> objects, not just their stripped text, so a rendered
// fraction/coordinate pair shows as an actual equation instead of raw
// script syntax. Returns the paragraph's inner <hp:run> XML (unwrapped —
// caller embeds it directly into its own paragraph).
function extractQuickAnswerXml(blockXml) {
  // NOT indexOf('<hp:endNote') — that also matches the unrelated
  // document-wide <hp:endNotePr> (endnote FORMATTING definition, appears
  // once per document) whenever it precedes the real instance in this
  // block. Only broke question 1 (the only block starting from the very
  // top of the section, where that boilerplate lives).
  const enMatch = blockXml.match(/<hp:endNote\s+number=/);
  if (!enMatch) return '';
  const subListIdx = blockXml.indexOf('<hp:subList', enMatch.index);
  if (subListIdx === -1) return '';
  const closeRe = /<hp:subList\b[^>]*?\/>|<hp:subList\b[^>]*?>|<\/hp:subList>/g;
  closeRe.lastIndex = subListIdx;
  let depth = 0, m, subListEnd = -1;
  while ((m = closeRe.exec(blockXml)) !== null) {
    const tok = m[0];
    if (tok.endsWith('/>')) continue;
    if (tok === '</hp:subList>') { depth--; if (depth === 0) { subListEnd = m.index + tok.length; break; } }
    else depth++;
  }
  if (subListEnd === -1) return '';
  const subListXml = blockXml.slice(subListIdx, subListEnd);
  const paras = findTopLevelBlocks(subListXml, 'hp:p');
  for (const p of paras) {
    // "수식입니다." is just an equation's generic alt-text label ("this is
    // an equation"), not part of the actual content — pure noise here for
    // deciding whether this paragraph counts as blank.
    const stripped = stripTags(p.text).replace(/수식입니다\./g, '').replace(/\s+/g, ' ').trim();
    if (!stripped) continue;
    const runs = findTopLevelBlocks(p.text, 'hp:run');
    return runs.map(r => stripAutoNumCtrls(r.text)).join('');
  }
  return '';
}

// Like extractQuickAnswerXml, but returns the endnote's ENTIRE subList
// content (every paragraph, not just the first non-blank one) — used for
// the HTML export's 해설(explanation) section, since HTML has no
// equivalent to HWP's own "auto-collect every endnote at the document
// end" feature; that page is built explicitly from this instead.
function extractEndnoteFullBodyXml(blockXml) {
  const enMatch = blockXml.match(/<hp:endNote\s+number=/);
  if (!enMatch) return '';
  const subListIdx = blockXml.indexOf('<hp:subList', enMatch.index);
  if (subListIdx === -1) return '';
  const closeRe = /<hp:subList\b[^>]*?\/>|<hp:subList\b[^>]*?>|<\/hp:subList>/g;
  closeRe.lastIndex = subListIdx;
  let depth = 0, m, subListEnd = -1;
  while ((m = closeRe.exec(blockXml)) !== null) {
    const tok = m[0];
    if (tok.endsWith('/>')) continue;
    if (tok === '</hp:subList>') { depth--; if (depth === 0) { subListEnd = m.index + tok.length; break; } }
    else depth++;
  }
  if (subListEnd === -1) return '';
  const subListXml = blockXml.slice(subListIdx, subListEnd);
  const paras = findTopLevelBlocks(subListXml, 'hp:p');
  return paras.map(p => stripAutoNumCtrls(p.text)).join('');
}

// ---------- HWP 콘텐츠 → HTML 변환 (오답노트 HTML 내보내기용) ----------
// HWP 수식 편집기 스크립트는 troff/eqn 계열 문법을 쓴다 — LEFT(/RIGHT),
// over(분수), sqrt/bar/hat/vec(단항 함수, 다음 원자에 적용), rm/it(글꼴
// 모드 전환, 렌더링에는 큰 영향 없어 생략), 그리스 문자·부등호 등은
// 영문 키워드. 실제 파일 1500개 수식 스크립트로 검증한 변환기.
function findAtomBefore(str, pos) {
  let i = pos;
  while (i > 0 && /\s/.test(str[i - 1])) i--;
  const end = i;
  if (i > 0 && str[i - 1] === '}') {
    let depth = 1, j = i - 2;
    while (j >= 0 && depth > 0) {
      if (str[j] === '}') depth++;
      else if (str[j] === '{') depth--;
      j--;
    }
    i = j + 1;
    // A trailing {...} is often just a sub/superscript group tacked onto
    // a preceding identifier ("y_{1}"), OR the argument of an already-
    // converted \command{...} ("\boxed{(나)}") — absorb the identifier/
    // _/^ chars (and a leading backslash, for the command case) directly
    // before it too, so the WHOLE thing becomes the operand instead of
    // just the bare "{1}"/"{(나)}".
    while (i > 0 && /[A-Za-z0-9_^]/.test(str[i - 1])) i--;
    if (i > 0 && str[i - 1] === '\\') i--;
    return [i, str.slice(i, end)];
  }
  if (i > 0 && str[i - 1] === ')') {
    let depth = 1, j = i - 2;
    while (j >= 0 && depth > 0) {
      if (str[j] === ')') depth++;
      else if (str[j] === '(') depth--;
      j--;
    }
    return [j + 1, str.slice(j + 1, end)];
  }
  let j = i;
  while (j > 0 && !/\s/.test(str[j - 1]) && !'{}()'.includes(str[j - 1])) j--;
  return [j, str.slice(j, end)];
}

// Consumes one atom starting at str[i] (no leading whitespace) — a {...}
// group, a (...) group, or an already-converted \command optionally
// followed directly by one or more {...} argument groups — and returns
// the position right after it.
function consumeAtomForward(str, i) {
  if (str[i] === '\\') {
    let j = i + 1;
    while (j < str.length && /[A-Za-z]/.test(str[j])) j++;
    while (str[j] === '{') j = consumeAtomForward(str, j);
    return j;
  }
  if (str[i] === '{' || str[i] === '(') {
    const open = str[i], close = open === '{' ? '}' : ')';
    let depth = 1, j = i + 1;
    while (j < str.length && depth > 0) {
      if (str[j] === open) depth++;
      else if (str[j] === close) depth--;
      j++;
    }
    return j;
  }
  return i + 1;
}

function findAtomAfter(str, pos) {
  let i = pos;
  while (i < str.length && /\s/.test(str[i])) i++;
  // {...}/(...) groups and \command{...} are each a single atom on their
  // own (confirmed bug otherwise: a bare-run scan doesn't stop at "(" or
  // ")", so "box(나)cdoty_" got swept up as box's WHOLE argument instead
  // of just "(나)").
  if (str[i] === '{' || str[i] === '(' || str[i] === '\\') {
    const end = consumeAtomForward(str, i);
    return [end, str.slice(i, end)];
  }
  // Bare run (no enclosing group) — e.g. the "2+\boxed{(나)}" in
  // "over 2+box (나)" once box has already become \boxed{(나)}. Runs
  // until whitespace or a bare brace/paren, but a \command encountered
  // MID-RUN is consumed as one step (command name + its own {...} args)
  // rather than stopping at its opening "{", so the run keeps going
  // past it instead of leaving the command's argument stranded outside.
  let j = i;
  while (j < str.length && !/\s/.test(str[j]) && str[j] !== '{' && str[j] !== '}' && str[j] !== '(' && str[j] !== ')') {
    j = str[j] === '\\' ? consumeAtomForward(str, j) : j + 1;
  }
  return [j, str.slice(i, j)];
}

function stripOuterBraces(s) {
  s = s.trim();
  if (s.startsWith('{') && s.endsWith('}')) return s.slice(1, -1);
  return s;
}

// "A over B" -> "\dfrac{A}{B}" — operand boundaries are brace-group-aware
// (so nested fractions inside a numerator/denominator resolve correctly)
// via findAtomBefore/After, not naive whitespace splitting. \dfrac (not
// \frac) specifically — inline math defaults to "textstyle", which KaTeX
// (matching real LaTeX) shrinks \frac's numerator/denominator down a
// size; \dfrac forces the same full-size rendering a displayed equation
// would get, while leaving exponents/subscripts (a separate, always-small
// "script style") untouched.
function resolveOverFractions(script) {
  let s = script;
  let guard = 0;
  while (guard++ < 300) {
    const m = s.match(/(?<![A-Za-z])over(?![A-Za-z])/);
    if (!m) break;
    const idx = m.index;
    const [leftStart] = findAtomBefore(s, idx);
    const leftRaw = s.slice(leftStart, idx);
    const afterOver = idx + 4;
    const [rightEnd, rightRaw] = findAtomAfter(s, afterOver);
    const left = stripOuterBraces(leftRaw);
    const right = stripOuterBraces(rightRaw);
    s = s.slice(0, leftStart) + `{\\dfrac{${left}}{${right}}}` + s.slice(rightEnd);
  }
  return s;
}

// Unary keyword (sqrt/bar/hat/...) applies to the NEXT atom only. The
// "(?<!\\)" guard is essential — without it, the regex would keep
// re-matching the "sqrt"/"bar" substring inside the \sqrt{...}/\bar{...}
// text this function just inserted, growing backslashes forever.
function applyUnary(s, keyword, latexCmd, caseInsensitive, loose) {
  // Both \b's matter for MOST of these — "dot" without the leading one
  // would also match inside "cdot" (HWP's \cdot keyword), corrupting it
  // into "c" + a dot-accent. sqrt/bar/root are safe to drop BOTH for (no
  // other keyword contains them as a substring) and confirmed NEED to —
  // HWP glues a coefficient directly onto them on one side ("3barBC",
  // "7root3") AND glues the following argument directly onto them with
  // no space on the other ("barBC" itself has no boundary between "bar"
  // and "BC" either, both being letters) — \b can't fire between two
  // \w characters (digit-letter OR letter-letter) on either side, so
  // \bbar\b / \broot\b never matched glued cases like this at all.
  const lead = loose ? '' : '\\b';
  const trail = loose ? '' : '\\b';
  const re = new RegExp('(?<!\\\\)' + lead + keyword + trail, caseInsensitive ? 'i' : '');
  let guard = 0;
  while (guard++ < 300) {
    const m = s.match(re);
    if (!m) break;
    const idx = m.index;
    const after = idx + keyword.length;
    const [end, argRaw] = findAtomAfter(s, after);
    const arg = stripOuterBraces(argRaw);
    s = s.slice(0, idx) + `${latexCmd}{${arg}}` + s.slice(end);
  }
  return s;
}

// Brace-depth-aware split on a top-level separator char (ignores the char
// when it's inside a nested {...} group — e.g. an eqalign block's own '#').
function splitTopLevel(s, sepChar) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === sepChar && depth === 0) { parts.push(s.slice(start, i)); start = i + 1; }
  }
  parts.push(s.slice(start));
  return parts;
}

// eqalign{...} groups a run of '#'-separated sub-rows for vertical
// alignment; nested inside a cases row it just marks "these lines belong
// together", so it's flattened into however many rows its own '#'-split
// produces rather than kept as its own LaTeX construct — any text before/
// after the eqalign{} within the same row is spliced onto the first/last
// sub-row respectively.
function flattenEqalignRows(rowStr) {
  const m = rowStr.match(/\beqalign\s*\{/);
  if (!m) return [rowStr];
  const braceStart = rowStr.indexOf('{', m.index);
  const [end, inner] = findAtomAfter(rowStr, braceStart);
  const innerContent = stripOuterBraces(inner);
  const subRows = splitTopLevel(innerContent, '#').map(s => s.trim()).filter(Boolean);
  const before = rowStr.slice(0, m.index);
  const after = rowStr.slice(end);
  if (subRows.length === 0) return [(before + after).trim()].filter(Boolean);
  return subRows.map((r, i) => {
    let piece = r;
    if (i === 0) piece = before + piece;
    if (i === subRows.length - 1) piece = piece + after;
    return piece.trim();
  });
}

// HWP's "cases{ row1 # row2 # ... }" (연립방정식/구간별 정의 등) — '#'
// separates rows, '&' separates columns within a row (both already match
// LaTeX's own cases/array row & column separators once rows are joined
// with '\\', so no further translation of '&' itself is needed).
function resolveCases(script) {
  let s = script;
  let guard = 0;
  while (guard++ < 50) {
    const m = s.match(/\bcases\s*\{/);
    if (!m) break;
    const braceStart = s.indexOf('{', m.index);
    const [end, inner] = findAtomAfter(s, braceStart);
    const innerContent = stripOuterBraces(inner);
    let rows = splitTopLevel(innerContent, '#').map(r => r.trim()).filter(Boolean);
    rows = rows.flatMap(flattenEqalignRows).map(r => r.trim()).filter(Boolean);
    const rowsLatex = rows.map(r => splitTopLevel(r, '&').map(c => c.trim()).join(' & '));
    const replacement = `\\begin{cases}${rowsLatex.join(' \\\\ ')}\\end{cases}`;
    s = s.slice(0, m.index) + replacement + s.slice(end);
  }
  return s;
}

const HWP_EQ_SYMBOLS = {
  LEQ: '\\leq', GEQ: '\\geq', NEQ: '\\neq', THEREFORE: '\\therefore',
  ANGLE: '\\angle', CDOTS: '\\cdots', TRIANGLE: '\\triangle',
  // 수직 기호(⊥) — HWP 수식편집기의 "bot" 키워드. 지금까지 이 표에 없어서
  // "AC bot BD"(AC⊥BD) 같은 식이 그냥 글자 "bot"으로 남아 보이던 문제
  // (실제 파일에서 확인됨: [S+반] 2회차 과제미션 n.hwpx 30번).
  bot: '\\bot',
  // 집합 연산 기호 — 지금까지 이 표에 하나도 없어서 "A CUP B"(합집합),
  // "A CAP B"/"A SMALLINTER B"(교집합, HWP가 둘 다 씀), "A SUBSET B"
  // (부분집합), "EMPTYSET"(공집합)이 전부 글자 그대로 남아있던 문제
  // (실제 파일에서 확인됨: TAT6회 대치수학 2기 — 집합 단원 111개 수식
  // 중 49개가 이 문제였음). "smallinter"는 10글자로 "int"(적분,3글자)
  // 보다 길어서 먼저 매칭되므로, 이미 있던 "int" 키워드와 부분 겹침으로
  // "SMALL∫ER"(적분 기호가 중간에 끼어드는)처럼 깨지던 것도 같이 해결됨.
  cup: '\\cup', cap: '\\cap', smallinter: '\\cap', subset: '\\subset',
  emptyset: '\\emptyset',
  // 조건제시법 안의 "such that" 세로선("{x vert x<7}" = {x | x<7}) — HWP가
  // 이 자리에서 LEFT|/RIGHT| 대신 그냥 "vert"라는 글자 키워드를 쓰는 경우가
  // 있음 (실제 파일에서 확인됨: [대수연마1000제] 04. 로그함수 11~13번,
  // "\left\{ x vert x<7 \right\}"처럼 글자 그대로 남아있었음).
  vert: '\\vert',
  PLUSMINUS: '\\pm', TIMES: '\\times', DIV: '\\div', DEG: '^\\circ',
  // "∠B = 90^{CIRC}"처럼 각도 표시가 지수(^{...}) 안에 CIRC 키워드로 그대로
  // 들어오는 경우가 있는데, 여태 DEG만 등록돼 있어서 CIRC는 치환 안 되고
  // 글자 그대로 남아 있었다(실제 파일로 재현 확인). 이땐 바깥 ^{}가 이미
  // 있으니 여기선 캐럿 없이 원(\circ)만 매핑.
  CIRC: '\\circ',
  cdot: '\\cdot', INFTY: '\\infty', infty: '\\infty',
  alpha: '\\alpha', beta: '\\beta', gamma: '\\gamma', delta: '\\delta',
  epsilon: '\\epsilon', zeta: '\\zeta', eta: '\\eta', theta: '\\theta',
  iota: '\\iota', kappa: '\\kappa', lambda: '\\lambda', mu: '\\mu', nu: '\\nu',
  xi: '\\xi', pi: '\\pi', rho: '\\rho', sigma: '\\sigma', tau: '\\tau',
  upsilon: '\\upsilon', phi: '\\phi', chi: '\\chi', psi: '\\psi', omega: '\\omega',
  SUM: '\\sum', sum: '\\sum', PROD: '\\prod', prod: '\\prod', INT: '\\int', int: '\\int',
  LIM: '\\lim', lim: '\\lim', LDOTS: '\\ldots', ldots: '\\ldots',
  amp: '&', QED: '\\blacksquare',
  // short-form inequality keywords ("-3lele1/2" = -3 \leq l \leq 1/2, i.e.
  // "le"/"ge" used in place of LEQ/GEQ) — confirmed from real broken output.
  le: '\\leq', ge: '\\geq',
  // 화살표/프라임 — 실제 파일에서 "rarrow"가 그대로 글자로 남는 것 확인
  // ("(x,y)rarrow(x-4,y+6)"). prime은 접미사라 글자 바로 뒤에 붙여서
  // 나오므로("Pprime" = P′), 다른 붙어있는 키워드와 같은 방식으로 그
  // 자리에서 바로 치환하면 위치가 맞는다.
  prime: "'",
  // 실제 파일 재확인 결과 "rarrow"가 아니라 접두사 없는 그냥 "arrow"였음
  // ("(x,y)arrow(x-4,y+6)") — 기본값은 오른쪽 화살표로 처리. 길이순
  // 정렬(긴 것부터 매칭)이라 rarrow/larrow 등 다른 키워드보다 먼저
  // 걸릴 걱정은 없음(그것들이 더 길어서 항상 먼저 검사됨).
  arrow: '\\rightarrow',
  rarrow: '\\rightarrow', larrow: '\\leftarrow', lrarrow: '\\leftrightarrow',
  rrarrow: '\\Rightarrow', llarrow: '\\Leftarrow', lrrarrow: '\\Leftrightarrow',
};

// Case-insensitive, longest-match-first keyword table — HWP's equation
// editor is inconsistent about keyword casing (LEFT vs left, rm vs RM),
// and a keyword can sit glued directly against ANOTHER keyword with zero
// separating whitespace (e.g. "2cdotbox(가)" = "2" + cdot + box, no
// spaces at all) — plain \bWORD\b matching misses both, since \b can't
// fire between two letters and doesn't know about casing. Scanning each
// letter-run character by character for the longest known keyword
// starting at that position (case-folded) catches both.
const HWP_EQ_KEYWORDS_CI = (() => {
  const map = {};
  for (const k of Object.keys(HWP_EQ_SYMBOLS)) {
    const lk = k.toLowerCase();
    if (!(lk in map)) map[lk] = HWP_EQ_SYMBOLS[k];
  }
  return { map, keys: Object.keys(map).sort((a, b) => b.length - a.length) };
})();

function substituteSymbolsInRun(run) {
  const lower = run.toLowerCase();
  let out = '', i = 0;
  while (i < run.length) {
    let hit = null;
    for (const kw of HWP_EQ_KEYWORDS_CI.keys) {
      if (lower.startsWith(kw, i)) { hit = kw; break; }
    }
    if (hit) {
      let repl = HWP_EQ_KEYWORDS_CI.map[hit];
      i += hit.length;
      // A LaTeX control WORD (\leq, \cdot, ...) consumes every letter
      // right after it as part of the command name — "\leq" immediately
      // followed by "m" with no separator parses as the single (bogus)
      // command "\leqm", not "\leq" then "m". A space breaks that only
      // when the next source character is itself a letter.
      if (/^\\[A-Za-z]+$/.test(repl) && /[A-Za-z]/.test(run[i] || '')) repl += ' ';
      out += repl;
    } else { out += run[i]; i++; }
  }
  return out;
}

// A blank-fill label inside box{...} (e.g. "빈칸의 (가)에 알맞은 식은?")
// is sometimes written as ONE precomposed Unicode "parenthesized Hangul"
// character (U+320E–U+3210 = ㈎㈏㈐, "PARENTHESIZED HANGUL KIYEOK/NIEUN/
// TIKEUT A" etc.) instead of three separate characters — confirmed against
// a real file where box{~㈎~} rendered as an oversized/overflowing box
// because KaTeX has NO font metrics at all for that codepoint (it isn't a
// missing-style issue \text{} can fix; the glyph itself isn't in KaTeX's
// fonts). Expand it to the plain 3-character "(가)" wrapped in \text{}
// before anything else touches the script, since normal Hangul syllables
// render fine with the page's own Korean web font.
const HWP_ENCLOSED_HANGUL = { '㈎': '(가)', '㈏': '(나)', '㈐': '(다)', '㈑': '(라)', '㈒': '(마)' };

function convertHwpEquationToLatex(script) {
  if (!script) return '';
  let s = script;
  s = s.replace(/[㈎㈏㈐㈑㈒]/g, (ch) => `\\text{${HWP_ENCLOSED_HANGUL[ch]}}`);
  s = s.replace(/`/g, ' ');
  // Quoted labels ("⑦", "또는", ...) are literal text, not math — \text{}
  // keeps them upright instead of math-italicizing each character.
  s = s.replace(/"([^"]*)"/g, '\\text{$1}');
  // HWP's own "NEQ" keyword (letters, caught by the symbol table further
  // below) isn't the only way "≠" shows up in real scripts — "!=" (bare
  // punctuation, e.g. "a != 0") is common too. Left as literal characters
  // it's invisible to the letter-only keyword scanner ([A-Za-z]+ doesn't
  // match "!"/"="), so it rendered as a factorial mark "!" sitting next to
  // a plain "=" instead of one proper "≠" symbol (confirmed against a real
  // file). Convert it here, before anything else gets a chance to touch
  // the "!" or "=" characters individually.
  s = s.replace(/!=/g, '\\neq ');
  s = resolveCases(s);
  // No leading \b and case-insensitive — LEFT/RIGHT show up as "left"
  // lowercase in some files, and can sit glued directly against the
  // preceding variable ("Aleft(x1,y1right)") with no boundary for \b to
  // catch; the following bracket char is specific enough on its own.
  s = s.replace(/LEFT\s*\(/gi, '\\left(');
  s = s.replace(/RIGHT\s*\)/gi, '\\right)');
  s = s.replace(/LEFT\s*\[/gi, '\\left[');
  s = s.replace(/RIGHT\s*\]/gi, '\\right]');
  s = s.replace(/LEFT\s*\{/gi, '\\left\\{');
  s = s.replace(/RIGHT\s*\}/gi, '\\right\\}');
  s = s.replace(/LEFT\s*\|/gi, '\\left|');
  s = s.replace(/RIGHT\s*\|/gi, '\\right|');
  // 집합 조건제시법("{x|x는...}")에서 오른쪽에 보이는 짝이 없는 여는
  // 괄호("LEFT{", "LEFT|")를 크기만 맞추고 닫는 표시는 안 보이게 하려고
  // HWP가 쓰는 투명 닫음 표시 — 실제 파일에서 "RIGHT ."이 그대로 글자로
  // 남는 것 확인됨. LEFT도 대칭으로 같이 처리(아직 실제로는 못 봤지만
  // 같은 이유로 나올 수 있음).
  s = s.replace(/LEFT\s*\./gi, '\\left.');
  s = s.replace(/RIGHT\s*\./gi, '\\right.');
  // 수식이 여러 <hp:equation> 조각으로 쪼개지면, 여는/닫는 괄호 문자
  // 자체가 이 조각이 아닌 "다른" 조각에 있어서 LEFT/RIGHT 뒤에 짝지을
  // 괄호 문자가 이 조각 안엔 아예 없는 경우도 있다(실제 파일 확인:
  // "A={x|x는...} , B={x|x는 6의 양의 배수 " 뒤에 이어지는 조각이
  // 괄호 하나 없이 그냥 "right"만 담고 있었음 — 위의 5가지 괄호별
  // 규칙이 전부 괄호 문자를 요구해서 이 경우를 못 잡았음). 위에서 이미
  // 처리된 것들은 전부 "\left"/"\right"로 백슬래시가 붙어 있어 이
  // 마지막 처리 대상에서 제외되므로, 끝까지 안 걸리고 남은 LEFT/RIGHT는
  // 안 보이는 닫음 표시로 처리한다.
  s = s.replace(/(?<!\\)\bLEFT\b/gi, '\\left.');
  s = s.replace(/(?<!\\)\bRIGHT\b/gi, '\\right.');
  // A single equation script can be missing a { with no matching } at all,
  // or have a stray EXTRA } with no { of its own — both confirmed against
  // real files, both traced to the same root cause (HWP splitting one
  // equation across separate <hp:equation> objects, so a brace pair's two
  // halves can end up in different sibling scripts and only one half ever
  // reaches this particular script). Cleaning this up before
  // resolveOverFractions/applyUnary ever see the string is essential —
  // those functions' own brace scanners assume well-formed input, and a
  // stray brace reaching them gets baked into whatever structure they
  // build (confirmed: a stray "}" survived resolveOverFractions and ended
  // up INSIDE a freshly-built "\dfrac{...}" wrapper as an extra "}}",
  // which is a KaTeX hard error no end-of-string padding could ever fix
  // after the fact — it has to be cleaned before that wrapping happens).
  // This MUST run after the LEFT/RIGHT conversions above, not before: an
  // equation fragment like "it right}" — the tail half of a set-builder
  // notation split across sibling <hp:equation> objects — has its raw "}"
  // turned into the escaped, non-grouping "\right\}" token by those
  // conversions. Running this scan earlier (confirmed against a real
  // file) sees that same "}" while it's still a bare, unmatched character,
  // decides it's a stray extra close, and deletes it — which then makes
  // "RIGHT\s*\}" stop matching entirely, leaving literal unconverted
  // "right" text behind. So \{ / \} (now escaped, literal brace glyphs,
  // not grouping delimiters) must be skipped here rather than counted.
  let depth0 = 0, balanced0 = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const escaped = s[i - 1] === '\\';
    if (c === '{' && !escaped) { depth0++; balanced0 += c; }
    else if (c === '}' && !escaped) { if (depth0 === 0) continue; depth0--; balanced0 += c; }
    else balanced0 += c;
  }
  s = balanced0 + '}'.repeat(depth0);
  s = applyUnary(s, 'sqrt', '\\sqrt', false, true);
  // "root" is an alternate keyword HWP uses for square roots too (e.g.
  // "7root3" = 7√3), separate from "sqrt" — both need to be recognized.
  s = applyUnary(s, 'root', '\\sqrt', false, true);
  // \overline (not \bar) — \bar only draws a short accent over a single
  // character; segment notation like AB needs a full-width bar over the
  // whole label, which is what \overline does.
  s = applyUnary(s, 'bar', '\\overline', false, true);
  s = applyUnary(s, 'hat', '\\hat');
  s = applyUnary(s, 'vec', '\\vec');
  s = applyUnary(s, 'tilde', '\\tilde');
  s = applyUnary(s, 'ddot', '\\ddot');
  s = applyUnary(s, 'dot', '\\dot');
  // Fill-in-the-blank placeholder (서술형 빈칸), e.g. "box (가)" — \boxed
  // draws a bordered box AROUND its argument, so the label ends up
  // written inside the box rather than as plain text floating next to
  // an empty square. Case-insensitive: both "box" and "BOX" show up.
  // loose(=no \b boundary) too — "box" itself can be glued directly onto
  // a PRECEDING keyword with no space ("2 cdotbox(나)" = cdot + box, both
  // letters on both sides of the join), same glued-keyword problem sqrt/
  // root/bar already guard against; \b can't fire between two letters, so
  // without loose this glued "box" was silently left as literal text
  // (confirmed against a real file: TAT3회 20번's "y= {2 cdotbox{(가)}...").
  s = applyUnary(s, 'box', '\\boxed', true, true);
  // Empty/placeholder \boxed{} content (bare "~", "~~", or whitespace
  // only — HWP's own filler for "leave this blank, draw your own mark
  // here", e.g. "IN/notin" fill-in boxes) renders too cramped for a
  // student to actually write a symbol into by hand — \boxed sizes
  // itself tightly to its content, and "~" is just a thin space. Swap
  // the filler for a couple of \phantom{X}'s instead: same invisible-
  // content trick, but each one reserves a full character's worth of
  // width/height, giving a legibly sized blank box to write into.
  s = s.replace(/\\boxed\{[~\s]*\}/g, '\\boxed{\\phantom{X}\\phantom{X}}');
  // "over" (fractions) runs AFTER the unary conversions above, not
  // before — a numerator/denominator like "box (나)" needs "box" already
  // turned into the clean, self-contained "\boxed{(나)}" token BEFORE the
  // over-scanner looks for atom boundaries; scanning the raw, still-space-
  // separated "box (나)" as a fraction operand stops at the first space
  // and only grabs "box", leaving "(나)" stranded outside the fraction.
  s = resolveOverFractions(s);
  // rm/it (font-mode toggles) are usually glued directly to the single
  // letter they style with no space (e.g. "rmA", generated by HWP's
  // equation editor for an upright point label) rather than "rm A" — \b
  // on BOTH sides would miss that, since there's no boundary between "m"
  // and "A". Strip the glued form first, then any remaining spaced form.
  s = s.replace(/\brm(?=[A-Za-z])/g, '').replace(/\brm\b/g, '');
  s = s.replace(/\bit(?=[A-Za-z])/g, '').replace(/\bit\b/g, '');
  // No \b here either — digits are \w characters too, so "3lemle1" has no
  // word boundary between "3" and "l" for \b to find, same root cause as
  // the LEFT/RIGHT and applyUnary fixes above. [A-Za-z]+ already delimits
  // on its own (digits/symbols simply aren't in the class), so dropping
  // \b only lets through matches it was wrongly blocking, not new ones.
  s = s.replace(/(?<!\\)([A-Za-z]+)/g, (m, w) => substituteSymbolsInRun(w));
  // Safety net: a coordinate/pair like "A(1,5), B(3,a)" can be split by HWP
  // across separate <hp:equation> objects (e.g. the trailing "a" written as
  // its own equation for italic styling), so a single equation's script can
  // legitimately open a \left( with the matching \right) living in a
  // DIFFERENT equation object entirely. Rather than crash KaTeX on the
  // resulting lone \left/\right, fall back to plain (unsized) brackets —
  // always valid on their own, and the adjacent \(...\) spans still read
  // correctly once placed next to each other in the page.
  // \b after left/right is essential — "\rightarrow" and "\leftrightarrow"
  // (both produced by the arrow keyword table above) contain "\right"/
  // "\left" as their own PREFIX substring, so a bare (non-\b) count/strip
  // here mistook every arrow symbol for a stray unmatched delimiter and
  // silently chopped it back down to "arrow"/"rightarrow" (confirmed via a
  // real file — this is the actual root cause of "arrow" never converting
  // despite the keyword mapping itself being correct the whole time). \b
  // still correctly fires for genuine "\left(" / "\right)" etc. (the next
  // character there is a bracket, not a letter) so real cross-equation-
  // object mismatches are still caught exactly as before.
  // 개수만 비교해서 안 맞으면 \left/\right를 전부 지우던 예전 방식은,
  // 한 조각 안에 이미 제대로 짝지어진 쌍이 진짜 orphan과 같이 섞여 있는
  // 경우(예: "\left\{ x \left| x \right." — 바깥 \left\{ 는 다른
  // 조각에 있는 "}"가 짝이지만, \left| ...\right.는 이 조각 안에서
  // 이미 완결된 정상 쌍)에 그 정상 쌍까지 같이 지워서 엉뚱한 "."만
  // 남기는 문제가 있었다(실제 파일 확인: 집합 조건제시법
  // "{x|x는...}"에서 발생). 순서대로 스택으로 짝을 맞춰서, 진짜 상대가
  // 없는 것들만 지운다 — \left는 나오는 순서대로 쌓아두고 \right를
  // 만나면 하나 꺼내 짝짓는(둘 다 유지) 식으로, 끝까지 스택에 남은
  // \left와 애초에 짝지을 상대가 없던 \right만 제거 대상.
  const tokenRe = /\\(left|right)\b/g;
  const tokens = [];
  let tm;
  while ((tm = tokenRe.exec(s))) tokens.push({ kind: tm[1], index: tm.index });
  const removeIdx = new Set();
  const stack = [];
  for (const t of tokens) {
    if (t.kind === 'left') stack.push(t.index);
    else if (stack.length) stack.pop();
    else removeIdx.add(t.index);
  }
  for (const idx of stack) removeIdx.add(idx);
  if (removeIdx.size) {
    let out = '', last = 0;
    for (const t of tokens) {
      if (!removeIdx.has(t.index)) continue;
      out += s.slice(last, t.index);
      last = t.index + 1 /* '\\' */ + t.kind.length;
    }
    out += s.slice(last);
    s = out;
  }
  // 이 조각 전체가 "안 보이는 닫음 표시(RIGHT ., 위 참고)" 하나뿐이었고
  // 그 짝(LEFT)이 다른 조각에 있어서 여기서 \right만 벗겨져 마침표
  // 하나만 남는 경우가 있다(실제 파일 확인) — 그렇다고 빈 문자열을
  // 돌려주면 안 된다: 호출하는 쪽(hwpBodyXmlToHtml)이 "빈 결과=변환
  // 실패"로 보고 원본 글자를 그대로 노출하는 폴백으로 넘어가 버려서,
  // 오히려 더 나쁜 "RIGHT" 글자 노출로 되돌아간다(실제로 겪은 회귀).
  // 마침표 하나 정도의 자국은 남기고 마는 게 안전하다.
  return s.trim();
}

function decodeXmlEntities(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// A run's children (text/equation/picture/table) are siblings, not nested
// in each other — collect each recognized tag type separately then merge
// back into document order by start offset, rather than assume any single
// regex can walk mixed sibling tags correctly.
function extractOrderedChildren(xml, tagNames) {
  const all = [];
  for (const tag of tagNames) {
    for (const b of findTopLevelBlocks(xml, tag)) all.push({ tag, ...b });
  }
  // A container tag (hp:rect or hp:tbl can each hold their own
  // <hp:t>/<hp:equation>/<hp:pic> deep inside their own subList/cells) gets
  // its inner content matched a SECOND time by that inner tag's own
  // independent scan above — findTopLevelBlocks only tracks nesting
  // relative to its OWN tag name, so it has no idea those matches sit
  // inside a container. Without this filter they'd render twice: once via
  // the container's own recursive rendering (hwpRectToHtml / hwpTblToHtml),
  // once again here as if they were direct run-level siblings — confirmed
  // against a real file where a table's per-cell "①" choice letters leaked
  // out and got double-processed by the OUTER choice-row detection too,
  // producing malformed mismatched HTML.
  const containers = all.filter(b => b.tag === 'hp:rect' || b.tag === 'hp:tbl');
  const filtered = all.filter(b => b.tag === 'hp:rect' || b.tag === 'hp:tbl' || !containers.some(c => b.start > c.start && b.start < c.end));
  filtered.sort((a, b) => a.start - b.start);
  return filtered;
}

async function hwpPicToHtml(picXml, entry) {
  const refM = picXml.match(/binaryItemIDRef="([^"]+)"/);
  if (!refM || !entry) return '';
  const href = entry.manifestItems[refM[1]];
  if (!href) return '';
  const file = entry.zipData.file(href);
  if (!file) return '';
  try {
    const base64 = await file.async('base64');
    const ext = href.split('.').pop().toLowerCase();
    const mime = mediaTypeForExt(ext);
    // data-bin-id ties the rendered <img> back to its manifest entry
    // (binaryItemIDRef) and zip path — needed by problembank.html's
    // pre-upload image editor to know which BinData/ file to overwrite
    // when the user recolors an image's background.
    return `<img class="hwpImg" src="data:${mime};base64,${base64}" alt="" data-bin-id="${escapeHtml(refM[1])}" data-bin-href="${escapeHtml(href)}">`;
  } catch (e) { return ''; }
}

async function hwpTblToHtml(tblXml, entry) {
  const trs = findTopLevelBlocks(tblXml, 'hp:tr');
  let rowsHtml = '';
  for (const tr of trs) {
    const tcs = findTopLevelBlocks(tr.text, 'hp:tc');
    let rowHtml = '';
    for (const tc of tcs) {
      const spanM = tc.text.match(/<hp:cellSpan\s+colSpan="(\d+)"\s+rowSpan="(\d+)"/);
      const colSpan = spanM ? spanM[1] : '1';
      const rowSpan = spanM ? spanM[2] : '1';
      const subList = findTopLevelBlocks(tc.text, 'hp:subList')[0];
      const cellInner = subList ? await hwpBodyXmlToHtml(subList.text, entry) : '';
      rowHtml += `<td colspan="${colSpan}" rowspan="${rowSpan}">${cellInner}</td>`;
    }
    rowsHtml += `<tr>${rowHtml}</tr>`;
  }
  return `<table class="hwpTbl">${rowsHtml}</table>`;
}

// A "다음은 ~ 과정이다. (가), (나)에 알맞은 것은?"-style proof-completion
// question draws its blank(s) as an <hp:rect> SHAPE, not text — confirmed
// against a real file: a small rect (curSz ~11mm×5mm) with an EMPTY draw
// run is the literal empty box the student would fill in. HWP shape sizes
// here use HWPUNIT (1/7200 inch, confirmed by cross-checking this file's
// own <hp:pagePr> width/height against its real A4-ish page size), NOT the
// 1/100mm convention used elsewhere in this codebase for paragraph/table
// coordinates — the two must not be confused.
function hwpUnitToMm(u) { return u / 7200 * 25.4; }

function rectSizeMm(rectXml) {
  const m = rectXml.match(/<hp:curSz width="(\d+)" height="(\d+)"/);
  return m ? { w: hwpUnitToMm(Number(m[1])), h: hwpUnitToMm(Number(m[2])) } : null;
}

async function hwpRectToHtml(rectXml, entry) {
  const sub = findTopLevelBlocks(rectXml, 'hp:subList')[0];
  const inner = sub ? await hwpBodyXmlToHtml(sub.text, entry) : '';
  const hasContent = stripTags(inner).trim() !== '' || /<img/.test(inner);
  const sz = rectSizeMm(rectXml);
  if (!hasContent) {
    // A large EMPTY rect (real file: ~83mm×37mm, carrying nothing but a
    // stray colPr layout-switch control) is a structural/anchor artifact,
    // not a visible blank box — only small empty rects are genuine
    // fill-in-the-blank boxes.
    if (!sz || sz.w > 40 || sz.h > 20) return '';
    return `<span class="hwpBlankBox" style="width:${sz.w.toFixed(1)}mm;height:${sz.h.toFixed(1)}mm"></span>`;
  }
  // hwpBodyXmlToHtml's output is block-level (<p>, <div>...) — a <span> is
  // inline and CANNOT legally contain block children; the browser's own
  // error-recovery silently closes the span early and re-parents those
  // <p>s as SIBLINGS right after it, so the text visually lands outside
  // the box instead of inside it (confirmed by rendering a real question:
  // an empty bordered box appeared, with all its text below/outside it).
  // A <div> has no such restriction.
  //
  // NOT sizing this to the original rect's own w/h: those dimensions were
  // calibrated for THAT document's own page/column width, not whatever
  // container this ends up rendered into here — forcing them via
  // min-width regularly made the box wider than its own column and stick
  // out past the edge (confirmed against a real file). Let it size
  // naturally to its content instead, up to the container's own width.
  //
  // A <보기> ㄱ/ㄴ/ㄷ list (or a 조건박스) that hwpBodyXmlToHtml already
  // detected and boxed on its own doesn't need THIS rect's own border
  // drawn around it too — the source document's rect shape and our
  // automatic 보기/조건 detection can both fire for the very same content,
  // nesting two borders around one thing (confirmed against a real file:
  // one particular 보기 question came out with a visibly doubled/thicker
  // border than every other 보기 question in the same file, which only
  // ever gets the single automatic box). If the rect's ENTIRE content is
  // already exactly one such self-bordered box, skip the redundant one.
  const trimmedInner = inner.trim();
  const innerTopBlocks = findTopLevelBlocks(trimmedInner, 'div');
  const isSingleStyledBox = innerTopBlocks.length === 1 && innerTopBlocks[0].start === 0 &&
    innerTopBlocks[0].end === trimmedInner.length && /^<div class="hwp(Bogi|CondBox)"/.test(trimmedInner);
  if (isSingleStyledBox) return trimmedInner;
  return `<div class="hwpRectBox">${inner}</div>`;
}

// stripTags has no concept of nesting — for a paragraph that CONTAINS an
// <hp:rect> or <hp:tbl> (each can hold their own nested paragraphs/
// markers), it exposes their deeply-nested text as if it belonged
// directly to the outer paragraph. That fooled hwpBodyXmlToHtml's
// choice/보기 detection into treating an already-rendered, already-boxed
// rect (e.g. a <보기> ㄱㄴㄷ list drawn inside a real hp:rect box) as raw
// unprocessed text and wrapping it in a SECOND, redundant box around the
// first, and separately treating a table's own per-cell "①②③④⑤" choice
// letters as if they belonged to the OUTER paragraph (both confirmed
// against real files). Strip rect/table blocks out before computing
// `.raw` so detection only ever sees a paragraph's own direct text.
function stripRectBlocksForRaw(xml) {
  const blocks = [...findTopLevelBlocks(xml, 'hp:rect'), ...findTopLevelBlocks(xml, 'hp:tbl')].sort((a, b) => a.start - b.start);
  let out = '';
  let pos = 0;
  for (const b of blocks) { out += xml.slice(pos, b.start); pos = b.end; }
  out += xml.slice(pos);
  return out;
}

// A fill-in-the-blank walkthrough ("①~⑤에 들어갈 알맞은 식은?") types the
// blank labels ①②③④⑤ AS LITERAL CHARACTERS INSIDE an equation's own
// <hp:script> (e.g. "{BOX{~~①~~}}"), not as separate visible text next to
// real choice content — confirmed against a real file. Without this
// exclusion, `.raw`'s choice-marker detection (which only checks for the
// BARE ①-⑤ characters anywhere in the paragraph) mistook that for an
// actual multiple-choice answer list and ran formatChoiceRow's HTML split
// right through the middle of the equation's own already-rendered "\(...\)"
// KaTeX span (split boundaries come from `.raw` character positions but are
// applied to `.inner`'s HTML string) — cutting one equation into two
// fragments and leaving the delimiter unmatched, so KaTeX gave up and the
// raw "\boxed{" source text showed through literally instead of rendering.
function stripEquationBlocksForRaw(xml) {
  const blocks = findTopLevelBlocks(xml, 'hp:equation');
  let out = '';
  let pos = 0;
  for (const b of blocks) { out += xml.slice(pos, b.start); pos = b.end; }
  out += xml.slice(pos);
  return out;
}

// hp:tab/hp:lineBreak/hp:fwSpace are inline formatting controls that can
// sit NESTED INSIDE <hp:t>...</hp:t> itself (verified against real files —
// not just as sibling elements), so they have to be swapped for their
// HTML equivalent BEFORE the surrounding text gets escaped, or they leak
// through as literal "&lt;hp:tab .../&gt;" text.
function hwpInlineControlsToHtml(raw) {
  return raw
    .replace(/<hp:lineBreak\b[^>]*\/>/g, '\n')
    .replace(/<hp:tab\b[^>]*\/>/g, '    ')
    .replace(/<hp:fwSpace\b[^>]*\/>/g, ' ')
    .replace(/<hp:[a-zA-Z]+\b[^>]*\/>/g, '')
    .replace(/<hp:[a-zA-Z]+\b[^>]*>[\s\S]*?<\/hp:[a-zA-Z]+>/g, '');
}

async function hwpRunInnerToHtml(runXml, entry) {
  runXml = stripCtrlBlocks(runXml);
  const children = extractOrderedChildren(runXml, ['hp:t', 'hp:equation', 'hp:pic', 'hp:tbl', 'hp:rect']);
  let out = '';
  for (const c of children) {
    if (c.tag === 'hp:t') {
      const textM = c.text.match(/<hp:t\b[^>]*>([\s\S]*?)<\/hp:t>/);
      const raw = textM ? textM[1] : '';
      const cleaned = hwpInlineControlsToHtml(raw);
      out += escapeHtml(decodeXmlEntities(cleaned)).replace(/\n/g, '<br>');
    } else if (c.tag === 'hp:equation') {
      // HWP adds xml:space="preserve" to <hp:script> whenever the script
      // text has meaningful leading/trailing whitespace (confirmed against
      // a real file: choice-list equations like " 3 sqrt6 " get this
      // attribute, plain ones don't) — an exact "<hp:script>" match missed
      // that variant entirely and silently dropped the whole equation with
      // no fallback either, since the empty rawScript short-circuits both
      // branches below.
      const sm = c.text.match(/<hp:script\b[^>]*>([\s\S]*?)<\/hp:script>/);
      const rawScript = sm ? decodeXmlEntities(sm[1]) : '';
      let latex = '';
      try { latex = rawScript ? convertHwpEquationToLatex(rawScript) : ''; } catch (e) { latex = ''; }
      if (latex) {
        // escapeHtml is essential here, not cosmetic — an unescaped bare "<"
        // immediately followed by a letter (e.g. "-6<k<2", very common in
        // inequality choices) gets tag-sniffed by the browser's own HTML
        // parser when this string is later assigned via innerHTML: it reads
        // "<k" as the start of an unknown tag and swallows everything up to
        // the next literal ">" it can find ANYWHERE later in the page as
        // that tag's content, silently eating other choices/questions along
        // the way (confirmed against a real file — "-6<k<2"/"-4<k<4"/
        // "-2<k<6" each vanished this way while "k<-2"/"k>6", whose "<"/">"
        // aren't followed by a letter, survived untouched). KaTeX's own
        // auto-render delimiter scan reads back the DECODED text content
        // (real "<"/">" chars), so escaping here doesn't change what KaTeX
        // sees at all — it only stops the HTML parser from misreading it.
        out += ` <span class="eq">\\(${escapeHtml(latex)}\\)</span> `;
      } else if (rawScript) {
        // Conversion failed outright — show the script text instead of
        // silently dropping the equation (a visible, ugly fallback beats a
        // missing chunk of the question a student can't even tell is gone).
        out += ` <span class="eqFallback">${escapeHtml(rawScript)}</span> `;
      }
    } else if (c.tag === 'hp:pic') {
      out += await hwpPicToHtml(c.text, entry);
    } else if (c.tag === 'hp:tbl') {
      out += await hwpTblToHtml(c.text, entry);
    } else if (c.tag === 'hp:rect') {
      out += await hwpRectToHtml(c.text, entry);
    }
  }
  return out;
}

// Converts a fragment containing one or more sibling <hp:run> elements
// (not necessarily wrapped in a <hp:p>) — used for the quick-answer runs
// extractQuickAnswerXml already hands back.
async function hwpFragmentRunsToHtml(xml, entry) {
  const runs = findTopLevelBlocks(xml, 'hp:run');
  let out = '';
  for (const r of runs) out += await hwpRunInnerToHtml(r.text, entry);
  return out;
}

// A "①...⑤" choice list is normally one paragraph with tab characters
// between choices — converted to a handful of literal spaces, those read
// as cramped/lopsided rather than evenly laid out. When 2+ circled-number
// markers show up in the same paragraph, split on them and lay the
// choices out as a wrapping flex row instead. The question STEM is
// routinely glued into the SAME paragraph right before the first marker
// ("...범위는?①-3≤m≤...") — confirmed against a real file — so anything
// before that first marker has to be split off as its own line, or it
// silently becomes a fake "choice item" with no marker of its own.
// paraInners: one inner-HTML string per SOURCE paragraph that carries
// choice markers (the caller passes each original <hp:p>'s own inner HTML
// separately, not pre-joined) — a real file lays choices out as 2/2/1 per
// line rather than a uniform grid (long fraction-heavy choices don't fit
// 3-per-row), so each source paragraph becomes its own row with exactly
// as many columns as it originally held, instead of every choice getting
// reflowed into a fixed 3-column grid regardless of the source layout.
function formatChoiceRow(paraInners) {
  const rows = [];
  let prefixHtml = '';
  paraInners.forEach((inner, idx) => {
    const markerIdx = inner.search(/[①②③④⑤]/);
    if (markerIdx === -1) return;
    // The question STEM is routinely glued into the SAME paragraph right
    // before the first marker ("...범위는?①-3≤m≤...") — confirmed against
    // a real file — so anything before that first marker has to be split
    // off as its own line, or it silently becomes a fake "choice item"
    // with no marker of its own. Only the first paragraph can have this.
    if (idx === 0 && markerIdx > 0) prefixHtml = inner.slice(0, markerIdx).trim();
    const parts = inner.slice(markerIdx).split(/(?=[①②③④⑤])/).map(s => s.trim()).filter(Boolean);
    if (parts.length) rows.push(parts);
  });
  const totalItems = rows.reduce((n, r) => n + r.length, 0);
  if (totalItems < 2) return null;
  // Use the LARGEST row's item count as a single SHARED column count for
  // every row, instead of each row getting its own column count. The
  // common "3 then 2" layout (5 short choices) needs ④ sitting directly
  // under ①, ⑤ under ② — two independently-sized grids (3 columns, then
  // 2 columns) can't align like that since their column widths differ.
  // A shared template fixes that (a short row just leaves trailing
  // columns empty) while still keeping a real 2/2/1 layout (long
  // fraction-heavy choices that don't fit 3-per-row) visually distinct
  // from a plain 3/2 — both confirmed against real files.
  const cols = Math.max(...rows.map(r => r.length));
  const rowsHtml = rows.map(parts =>
    `<div class="choiceRow" style="grid-template-columns:repeat(${cols},1fr)">${parts.map(p => `<span class="choiceItem">${p}</span>`).join('')}</div>`
  ).join('');
  return (prefixHtml ? `<p>${prefixHtml}</p>` : '') + rowsHtml;
}

// Multi-part "다음 조건을 만족시킬 때..." problems label each condition
// (가)/(나)/(다)... — normally boxed off in the source, same idea as a
// <보기> list but for whole condition clauses instead of ㄱ/ㄴ/ㄷ items.
// These markers usually sit mid-paragraph with no line break between them
// ("...16이다.(나) 0≤x≤8에서...") rather than each getting its own
// paragraph, so — unlike the ㄱ/ㄴ/ㄷ/ㄹ case — this has to split within
// a single paragraph's own HTML rather than group separate paragraphs.
const CONDITION_MARKERS = ['(가)', '(나)', '(다)', '(라)', '(마)'];

function formatConditionBox(inner, rawText) {
  const foundCount = CONDITION_MARKERS.filter(mk => rawText.includes(mk)).length;
  if (foundCount < 2) return null;
  // "(가)~(라)에 알맞은 것을 써넣으시오" — a RANGE reference ("from (가)
  // through (라)"), not a real list of separate conditions. Confirmed
  // against a real file: this sentence has 2+ markers and enough
  // substantive text around them to slip past the enumeration check below
  // (the closing "(라)에 알맞은 것을 써넣으시오." clause reads as
  // "substantive"), wrongly wrapping the question's own instruction
  // sentence in a condition box instead of leaving it as plain text.
  if (/\([가나다라마]\)\s*~/.test(rawText)) return null;
  // "위의 과정에서 (가), (마)에 알맞은 것을 잘못 짝지은 것은?" / "위의
  // 과정에서 (가),(나)에 알맞은 식을 f(m), g(m)이라 할 때 ...의 값은?" —
  // "위의 과정에서 (가),(마)에..." / "다음은 ... 간단히 하는 과정이다.
  // (가),(나)에 사용된 집합의 연산 법칙을 구하시오." — both are QUESTIONS
  // that introduce or refer back to a derivation (always shown separately
  // in its own hwpRectBox/table just above or below), not a real multi-
  // clause condition list — the "clauses" here are just a trailing marker
  // + comma, e.g. "(가),", with no substantive content of their own. Both
  // slipped past the substantive-count check below because the
  // surrounding sentence fragments are long enough to count as
  // substantive on their own. Confirmed against real files: this produced
  // an orphaned extra box right next to the derivation's own box/table,
  // reading as "box next to box" when the user just wants it read as
  // plain connected prose. "과정이다"/"과정에서" appearing anywhere in the
  // sentence is the reliable, common signal for this whole family —
  // excluded the same way as the range reference above, rather than
  // boxed.
  if (/과정이다|과정에서|짝지은\s*것/.test(rawText)) return null;
  const parts = inner.split(/(?=\([가나다라마]\))/).map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  // A plain enumeration of blank labels ("빈칸의 (가), (나), (다), (라)에
  // 알맞은 식은?") matches the same "(가)(나)..." pattern but ISN'T a real
  // multi-clause condition list — each "part" is just the marker plus a
  // trailing comma, nothing else. Boxing that produced a box the source
  // document never had (confirmed against a real file). Require most
  // parts to carry real content beyond the marker itself before boxing.
  const substantiveCount = parts.filter(p => {
    const stripped = stripTags(p).replace(/^\([가나다라마]\)/, '').replace(/[,.\s]/g, '');
    return stripped.length >= 2;
  }).length;
  if (substantiveCount < parts.length - 1) return null;
  return `<div class="hwpCondBox">${parts.map(p => `<p>${p}</p>`).join('')}</div>`;
}

// Converts a body of one or more <hp:p> paragraphs (a question's
// blockXml, an endnote's full subList, or a table cell's subList) to HTML.
async function hwpBodyXmlToHtml(xml, entry) {
  const paras = findTopLevelBlocks(xml, 'hp:p');
  const items = [];
  for (const p of paras) {
    const inner = await hwpFragmentRunsToHtml(p.text, entry);
    if (!inner.trim()) continue;
    // `.raw` has to reflect the SAME content `.inner` actually renders, or
    // detection gets fooled by text that's invisible/already-handled
    // elsewhere. Two real cases found: (1) a run's own <hp:ctrl> can wrap
    // an entire hidden <hp:endNote> ("[정답] ③ ...") that hwpRunInnerToHtml
    // already excludes from `.inner` via stripCtrlBlocks — without the
    // same exclusion here, a stray circled-number answer letter buried in
    // that hidden endnote reference falsely looked like a REAL choice
    // marker, pulling the whole stem paragraph into the choice-merge run
    // and then silently dropping it (its clean `.inner` has no markers of
    // its own to find). (2) an <hp:rect> shape's nested content, already
    // independently rendered as its own box — see stripRectBlocksForRaw.
    // (3) an <hp:equation>'s own script text can itself contain a bare
    // ①-⑤ as a decorative fill-in-blank label ("box{~~①~~}") — see
    // stripEquationBlocksForRaw.
    items.push({ raw: decodeXmlEntities(stripTags(stripEquationBlocksForRaw(stripRectBlocksForRaw(stripCtrlBlocks(p.text))))).trim(), inner });
  }

  // A "①...⑤" choice list is normally one paragraph with tab characters
  // between choices, but a real file showed it can also be split across
  // SEPARATE paragraphs (line-wrap in the source document — e.g. "①②" in
  // one paragraph, "③④" in the next, and a lone "⑤" in a third). Treating
  // each paragraph in isolation left that lone "⑤" outside the choice box
  // entirely, since a single marker never meets the "2+ per paragraph"
  // threshold. Merge a RUN of consecutive marker-bearing paragraphs first
  // and count markers across the whole run, before resolving anything else.
  //
  // A <보기> ㄱ/ㄴ/ㄷ/ㄹ list has the OPPOSITE problem in a different real
  // file: all 4 items sat glued into ONE single paragraph ("ㄱ. ...ㄴ.
  // ...ㄷ. ...ㄹ. ...") instead of one-per-paragraph, so the cross-paragraph
  // grouping below (which counts consecutive ㄱ-prefixed PARAGRAPHS) never
  // fires — it only ever sees that one paragraph, never reaching its "2+"
  // threshold. formatBogiBox handles that single-paragraph case directly,
  // the same way formatConditionBox already does for (가)(나)(다).
  function formatBogiBox(inner, rawText) {
    const count = (rawText.match(/[ㄱ-ㅎ]\s*[.)]/g) || []).length;
    if (count < 2) return null;
    const markerIdx = inner.search(/[ㄱ-ㅎ]\s*[.)]/);
    if (markerIdx === -1) return null;
    const prefix = inner.slice(0, markerIdx).trim();
    const parts = inner.slice(markerIdx).split(/(?=[ㄱ-ㅎ]\s*[.)])/).map(s => s.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    const box = `<div class="hwpBogi">${parts.map(p => `<p>${p}</p>`).join('')}</div>`;
    return prefix ? `<p>${prefix}</p>${box}` : box;
  }
  function resolveSingle(it) {
    const condBox = formatConditionBox(it.inner, it.raw);
    if (condBox) return condBox;
    // it.inner can itself contain block-level content (a hwpRectBox <div>,
    // from an <hp:rect> that held real paragraphs, OR a <table> from an
    // <hp:tbl>) — a <p> cannot legally contain a <div> or a <table>, and
    // wrapping either in one anyway just repeats the same "browser
    // silently un-nests it" bug one level up: the browser auto-closes the
    // <p> right before the block element starts, so the block ends up as
    // a sibling instead of a child, and the source's own closing </p>
    // becomes an orphaned tag the browser just drops — the resulting box/
    // table position on screen no longer matches what the HTML source
    // actually says (confirmed against a real file: 15번's derivation
    // table ended up in the wrong spot for exactly this reason). Use a
    // <div> wrapper instead whenever that's the case; plain <p> still
    // handles everything else exactly as before.
    return /<div\b|<table\b/.test(it.inner) ? `<div>${it.inner}</div>` : `<p>${it.inner}</p>`;
  }
  const resolved = [];
  let i = 0;
  while (i < items.length) {
    if (/[①②③④⑤]/.test(items[i].raw)) {
      const start = i;
      while (i < items.length && /[①②③④⑤]/.test(items[i].raw)) i++;
      const run = items.slice(start, i);
      const combinedRaw = run.map(it => it.raw).join('');
      const markerCount = (combinedRaw.match(/[①②③④⑤]/g) || []).length;
      const row = markerCount >= 2 ? formatChoiceRow(run.map(it => it.inner)) : null;
      if (row) { resolved.push({ raw: '', html: row }); continue; }
      for (const it of run) resolved.push({ raw: it.raw, html: resolveSingle(it) });
      continue;
    }
    const bogiBox = formatBogiBox(items[i].inner, items[i].raw);
    if (bogiBox) { resolved.push({ raw: '', html: bogiBox }); i++; continue; }
    resolved.push({ raw: items[i].raw, html: resolveSingle(items[i]) });
    i++;
  }

  // A <보기> list can ALSO be split across separate paragraphs where each
  // half, on its OWN, already has 2+ markers ("ㄱ./ㄴ." in one paragraph,
  // "ㄷ./ㄹ." in the next) — confirmed against a real file. formatBogiBox
  // above already boxes EACH of those paragraphs individually (its own
  // count check only sees one paragraph at a time), producing two separate
  // side-by-side hwpBogi boxes instead of the one unified box the source
  // document actually shows. The cross-paragraph merge further below can't
  // catch this either — it keys off `.raw`, which formatBogiBox already
  // blanked out (`raw: ''`) once it successfully boxed a paragraph. Glue
  // any run of ADJACENT already-boxed hwpBogi divs back into one here,
  // before that raw-text-based pass runs.
  for (let m = 0; m < resolved.length; m++) {
    if (!/^<div class="hwpBogi">/.test(resolved[m].html)) continue;
    let n = m + 1;
    while (n < resolved.length && /^<div class="hwpBogi">/.test(resolved[n].html)) n++;
    if (n - m > 1) {
      const inner = resolved.slice(m, n).map(it => it.html.replace(/^<div class="hwpBogi">|<\/div>$/g, '')).join('');
      resolved.splice(m, n - m, { raw: '', html: `<div class="hwpBogi">${inner}</div>` });
    }
  }

  // "<보기>" reference-statement lists (ㄱ./ㄴ./ㄷ./ㄹ...) are normally
  // shown inside a bordered box in the source — group them into one boxed
  // div, since we don't otherwise carry over the original paragraph
  // border. The "<보기>" label itself isn't reliably its own paragraph —
  // it's often embedded mid-sentence in the question text right before
  // the list ("...다음 <보기>에서 고른 것은?") — so detection can't
  // require a standalone marker paragraph; it just looks for a run of
  // 2+ consecutive ㄱ/ㄴ/ㄷ/ㄹ-prefixed lines, optionally preceded by one.
  const htmlParas = [];
  let j = 0;
  while (j < resolved.length) {
    const isMarker = /^<\s*보\s*기\s*>/.test(resolved[j].raw);
    const isBogiLine = /^[ㄱ-ㅎ]\s*[.)]/.test(resolved[j].raw);
    if (isMarker || isBogiLine) {
      const start = j;
      let k = isMarker ? j + 1 : j;
      let count = 0;
      while (k < resolved.length && /^[ㄱ-ㅎ]\s*[.)]/.test(resolved[k].raw)) { k++; count++; }
      if (count >= 2) {
        htmlParas.push(`<div class="hwpBogi">${resolved.slice(start, k).map(it => it.html).join('')}</div>`);
        j = k;
        continue;
      }
    }
    htmlParas.push(resolved[j].html);
    j++;
  }
  return htmlParas.join('\n');
}

function mediaTypeForExt(ext) {
  const e = ext.toLowerCase();
  if (e === 'jpg') return 'image/jpg';
  if (e === 'jpeg') return 'image/jpeg';
  if (e === 'bmp') return 'image/bmp';
  return 'image/png';
}

function detectExplicitMarkers(xml) {
  const paras = findTopLevelBlocks(xml, 'hp:p');
  const markerIdx = [];
  for (let i = 0; i < paras.length; i++) {
    const t = stripTags(paras[i].text).trim();
    const m = t.match(/^\[\[(\d+|END)\]\]$/);
    if (m) markerIdx.push({ i, key: m[1] });
  }
  const result = new Map();
  for (let k = 0; k < markerIdx.length - 1; k++) {
    const { i: startI, key } = markerIdx[k];
    if (key === 'END') continue;
    const endI = markerIdx[k + 1].i;
    const blockXml = paras.slice(startI + 1, endI).map(p => p.text).join('');
    if (blockXml.trim()) result.set(key, blockXml);
  }
  return result;
}

// A question's endnote paragraph contains BOTH its solution text and,
// concatenated in the very same run right after, the visible stem of that
// SAME question — followed a paragraph or two later by that question's
// own answer choices. (Verified against a real exam file: e.g. endnote 1's
// paragraph is literally "[정답] ⑤ ...개수는 5" immediately followed by
// "두 점 A(2,a), B(a,6) 사이의 거리가 4 이하가 되도록 하는 정수 a의
// 개수는?" — solution then stem, same problem, same paragraph.) Extend
// forward from each endnote through an optional blank gap, then through
// the following non-blank "choices" run — capped at the next endnote's
// own paragraph so a question with no gap before it never gets swallowed.
// Everything between one question's own end and the next endnote (an
// optional topic-label line, plus the next question's diagram image)
// belongs to the NEXT question, not this one.
function isBlankPara(p) {
  return stripTags(p.text).trim() === '';
}

// A blank paragraph with no picture in it is pure page-layout filler
// (these documents commonly reserve a run of empty paragraphs before a
// question so the next one starts at a nice position on the page) — safe
// to drop. A blank paragraph that DOES contain a picture is a real
// diagram belonging to the question and must be kept.
function isEmptySpacerPara(p) {
  return isBlankPara(p) && !p.text.includes('<hp:pic');
}

// A short-answer ("구하시오") question has no choices at all, so the
// paragraph right after its stem can be the NEXT question's own topic
// label or bracketed source citation with no blank line in between.
// Without this guard, "consume the next non-blank run as choices" would
// swallow that label — and everything up to the next blank — straight
// into the wrong question.
function looksLikeNextQuestionMarker(p) {
  const t = stripTags(p.text).trim();
  return /^유형\s*\d+\s*[:：]/.test(t) || /^\[[^\]]*\]$/.test(t);
}

// Orphaned-content absorption (below) must only grab things we can
// positively identify as belonging to SOME question — a picture, a real
// HWP table, or a choice list starting with ①/㉠/ㄱ — never "any non-blank
// paragraph". Some documents carry a repeating watermark/copyright notice
// ("이 자료를 무단으로 복제...") in the gap between questions; treating
// that as orphaned content silently corrupted unrelated questions with
// the watermark text instead of their real answer.
//
// A tabular multiple-choice grid (columns (가)(나)(다)(라), rows ①-⑤ —
// common for "빈칸 채우기" proof-completion questions) is a real <hp:tbl>,
// not a picture and not text starting with a circled number — without
// this it fell into the gap between two questions' own endnote boundaries
// and got silently dropped by BOTH (confirmed against a real file: the
// question's entire answer-choice table vanished, showing no choices at
// all even though the source definitely had them).
//
// A <보기> reference-statement line ("ㄱ. 점 A는...", "ㄴ. ...") is a real
// isolated jamo marker (never how an ordinary Korean sentence — built from
// full syllable blocks like "가"/"나" — begins), so it's just as safely
// identifiable as a picture or a circled-number choice. Without this, a
// 보기 list separated from the question's own diagram by an extra blank
// paragraph (confirmed in a real file: image, blank, then the ㄱ/ㄴ/ㄷ
// list, then another blank, then the ①-⑤ choices referencing it) never
// got absorbed at all — it silently fell outside every question's block.
//
// A sub-part label like "(1) 원소나열법"/"(2) 조건제시법"/"(3) 벤다이어그램"
// — parenthesized Arabic numeral, HWP's other common numbering style for
// multi-part stems alongside ①②③/ㄱㄴㄷ — is just as unambiguous a marker
// as those (confirmed against a real file: "(1)" absorbed fine as the
// initial non-blank run right after the endnote, but "(2)"/"(3)" each sat
// past their OWN blank gap and were silently dropped entirely, since
// nothing recognized them as belonging to this question). "(숫자)" doesn't
// collide with the watermark/citation text this function is deliberately
// narrow to avoid — that repeating notice never starts with a parenthesized
// number.
function looksLikeOrphanedFragment(p) {
  if (p.text.includes('<hp:pic') || p.text.includes('<hp:tbl')) return true;
  const t = stripTags(p.text).trim();
  return /^[①②③④⑤㉠㉡㉢㉣]/.test(t) || /^[ㄱ-ㅎ]\s*[.)]/.test(t) || /^\([1-9]\d?\)/.test(t);
}

function detectEndnoteMarkers(xml) {
  const paras = findTopLevelBlocks(xml, 'hp:p');
  const boundaries = [];
  for (let i = 0; i < paras.length; i++) {
    const m = paras[i].text.match(/<hp:endNote\b[^>]*\bnumber="(\d+)"/);
    if (m) boundaries.push({ i, key: m[1] });
  }
  const choicesEnd = boundaries.map(({ i }, idx) => {
    const nextI = idx + 1 < boundaries.length ? boundaries[idx + 1].i : paras.length;
    let j = i + 1;
    while (j < nextI && isBlankPara(paras[j])) j++;
    while (j < nextI && !isBlankPara(paras[j]) && !looksLikeNextQuestionMarker(paras[j])) j++;

    // Orphaned content — a stray choice list (e.g. a "<보기>"-style
    // question whose "①ㄱ,ㄴ ②ㄱ,ㄷ..." line ended up separated from its
    // own stem/topic-label by a blank gap) or an illustrating diagram —
    // sometimes sits in the gap between this question's own end and the
    // next question's topic label, instead of directly following either
    // one with no gap at all. Whichever side it's structurally closer to
    // is almost always where it actually belongs, so measure both
    // distances and only absorb it into THIS block if it's closer here.
    // A single question can leave MULTIPLE orphaned fragments in the gap
    // (e.g. an illustrating image, then another blank run, then its own
    // answer-choice table) — absorbing only the first and stopping there
    // silently dropped every fragment after it (confirmed against a real
    // file: an image absorbed fine, but the table right after it — the
    // question's actual choices — was left behind and vanished). Keep
    // re-attempting absorption from wherever the previous one left off
    // until a gap doesn't lead to another orphaned fragment, or that
    // fragment turns out to be structurally closer to the NEXT question.
    for (;;) {
      let k = j, gap = 0;
      while (k < nextI && isBlankPara(paras[k]) && gap < 3) { k++; gap++; }
      if (!(k < nextI && looksLikeOrphanedFragment(paras[k]))) break;
      const distHere = gap;
      let m = k;
      while (m < nextI && !isBlankPara(paras[m]) && !looksLikeNextQuestionMarker(paras[m])) m++;
      const distNext = nextI - m;
      // A tabular answer-choice grid ("(가)(나)(다)(라)" columns × "①-⑤"
      // rows, common for 빈칸채우기 proof-completion questions) is a real
      // <hp:tbl> — it's ALWAYS the immediately-preceding question's own
      // choices, never a preview of the next one, but the distance
      // measure alone got this backwards: with nothing else between the
      // table and the NEXT question's own endnote paragraph, distNext
      // came out as 0 and "closer" always won — even though the table is
      // unambiguously this question's, not a leftover near the next one
      // (confirmed against a real file: the table fell in this exact gap
      // and vanished from BOTH questions). Tables always absorb here.
      const isTable = paras[k].text.includes('<hp:tbl');
      if (!(isTable || distHere <= distNext)) break;
      // A paragraph carrying an <hp:pic>/<hp:tbl> ANYWHERE in its markup
      // trips looksLikeOrphanedFragment regardless of what its stripped
      // text starts with — so a captioned image whose visible text also
      // happens to read like a topic label ("[유형 5] ...") can satisfy
      // looksLikeOrphanedFragment AND looksLikeNextQuestionMarker at the
      // same time. That makes the inner scan's while-loop above execute
      // zero times, leaving m === k — no forward progress at all. Without
      // this guard the outer for(;;) would recompute the exact same
      // k/m/j on every pass and spin forever (confirmed: hung a real
      // regression file indefinitely). Bail out rather than loop in place.
      if (m <= k) break;
      j = m;
    }
    return j;
  });
  const result = new Map();
  for (let k = 0; k < boundaries.length; k++) {
    let start = k > 0 ? choicesEnd[k - 1] : 0;
    const end = choicesEnd[k];
    // Trim leading spacer-only blanks — this is what created the big gap
    // between the generated citation line and the actual problem text.
    while (start < end - 1 && isEmptySpacerPara(paras[start])) start++;
    // Anything still left before the endnote's OWN paragraph (e.g. a
    // leftover topic-label line like "[유형 5]" that stopped the PREVIOUS
    // question's consumption) duplicates our own generated citation box —
    // the block should start right at the endnote paragraph itself, not
    // the line before it.
    if (start < boundaries[k].i) start = boundaries[k].i;
    const blockXml = paras.slice(start, end).map(p => p.text).join('');
    if (blockXml.trim()) result.set(boundaries[k].key, blockXml);
  }
  return result;
}

function detectNumberedParagraphs(xml) {
  const paras = findTopLevelBlocks(xml, 'hp:p');
  const candidates = [];
  for (let i = 0; i < paras.length; i++) {
    const t = stripTags(paras[i].text).trim();
    const m = t.match(/^(\d+)\.\s/);
    if (m) candidates.push({ i, key: m[1], num: Number(m[1]) });
  }
  const kept = [];
  let last = -Infinity;
  for (const c of candidates) { if (c.num > last) { kept.push(c); last = c.num; } }
  const result = new Map();
  for (let k = 0; k < kept.length; k++) {
    const startI = kept[k].i;
    const endI = k + 1 < kept.length ? kept[k + 1].i : paras.length;
    const blockXml = paras.slice(startI, endI).map(p => p.text).join('');
    if (blockXml.trim()) result.set(kept[k].key, blockXml);
  }
  return result;
}

function detectMarkers(sectionsXml) {
  const result = new Map();
  for (const { name, xml } of sectionsXml) {
    const byMethod = [
      ['미주 번호', detectEndnoteMarkers(xml)],
      ['자동 번호 인식(N.)', detectNumberedParagraphs(xml)],
      ['수동 표시([[N]])', detectExplicitMarkers(xml)],
    ];
    for (const [method, found] of byMethod) {
      for (const [key, blockXml] of found) result.set(key, { sectionName: name, blockXml, method });
    }
  }
  return result;
}

async function parseHwpx(zipData) {
  const hpf = await zipData.file('Contents/content.hpf').async('string');
  const spineMatches = [...hpf.matchAll(/<opf:itemref idref="([^"]+)"/g)].map(m => m[1]);
  const manifestItems = {};
  for (const m of hpf.matchAll(/<opf:item id="([^"]+)" href="([^"]+)"/g)) manifestItems[m[1]] = m[2];
  const sectionOrder = spineMatches.filter(id => manifestItems[id] && manifestItems[id].includes('section')).map(id => manifestItems[id]);
  const sectionsXml = [];
  for (const path of sectionOrder) sectionsXml.push({ name: path, xml: await zipData.file(path).async('string') });
  const markers = detectMarkers(sectionsXml);
  return { zipData, sectionOrder, manifestItems, markers };
}
