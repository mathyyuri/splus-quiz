// clinicmaker.html 전용 스크립트 — 다른 도구들(studentnote.html/problembank.html/
// problemsearch.html)이 공유하는 hwpx-lib.js에 의존하지 않는, 완전히 독립된 사본.
// 클리닉 교재 생성기가 오답노트 시스템과 다르게(별도로) 동작하도록 하기 위해
// 의도적으로 분리됨 — hwpx-lib.js가 나중에 수정되어도 이 파일은 자동으로 따라가지
// 않으니, 이 파일에만 있는 버그를 고치거나 hwpx-lib.js의 개선을 반영하려면 수동으로
// 옮겨야 한다.

// ==================== HWPX 파싱/렌더링 코어 (hwpx-lib.js에서 복사) ====================

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

function stripAutoNumCtrls(runXml) {
  const ctrls = findTopLevelBlocks(runXml, 'hp:ctrl');
  let out = runXml;
  for (const c of ctrls) {
    if (c.text.includes('<hp:autoNum')) out = out.replace(c.text, '');
  }
  return out;
}

function stripCtrlBlocks(runXml) {
  const ctrls = findTopLevelBlocks(runXml, 'hp:ctrl');
  let out = runXml;
  for (const c of ctrls) out = out.replace(c.text, '');
  return out;
}

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
  if (str[i] === '{' || str[i] === '(' || str[i] === '\\') {
    const end = consumeAtomForward(str, i);
    return [end, str.slice(i, end)];
  }
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

function applyUnary(s, keyword, latexCmd, caseInsensitive, loose) {
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

const MATRIX_ENV_NAMES = ['pmatrix', 'bmatrix', 'vmatrix', 'Vmatrix', 'Bmatrix', 'matrix'];
function resolveMatrices(script) {
  let s = script;
  let guard = 0;
  while (guard++ < 50) {
    const m = s.match(new RegExp('\\b(' + MATRIX_ENV_NAMES.join('|') + ')\\s*\\{'));
    if (!m) break;
    const env = m[1];
    const braceStart = s.indexOf('{', m.index);
    const [end, inner] = findAtomAfter(s, braceStart);
    const innerContent = stripOuterBraces(inner);
    let rows = splitTopLevel(innerContent, '#').map(r => r.trim()).filter(Boolean);
    rows = rows.flatMap(flattenEqalignRows).map(r => r.trim()).filter(Boolean);
    const rowsLatex = rows.map(r => splitTopLevel(r, '&').map(c => c.trim()).join(' & '));
    const replacement = `\\begin{${env}}${rowsLatex.join(' \\\\ ')}\\end{${env}}`;
    s = s.slice(0, m.index) + replacement + s.slice(end);
  }
  return s;
}

const HWP_EQ_SYMBOLS = {
  LEQ: '\\leq', GEQ: '\\geq', NEQ: '\\neq', THEREFORE: '\\therefore',
  ANGLE: '\\angle', CDOTS: '\\cdots', TRIANGLE: '\\triangle',
  PLUSMINUS: '\\pm', TIMES: '\\times', DIV: '\\div', DEG: '^\\circ',
  cdot: '\\cdot', INFTY: '\\infty', infty: '\\infty',
  alpha: '\\alpha', beta: '\\beta', gamma: '\\gamma', delta: '\\delta',
  epsilon: '\\epsilon', zeta: '\\zeta', eta: '\\eta', theta: '\\theta',
  iota: '\\iota', kappa: '\\kappa', lambda: '\\lambda', mu: '\\mu', nu: '\\nu',
  xi: '\\xi', pi: '\\pi', rho: '\\rho', sigma: '\\sigma', tau: '\\tau',
  upsilon: '\\upsilon', phi: '\\phi', chi: '\\chi', psi: '\\psi', omega: '\\omega',
  SUM: '\\sum', sum: '\\sum', PROD: '\\prod', prod: '\\prod', INT: '\\int', int: '\\int',
  LIM: '\\lim', lim: '\\lim', LDOTS: '\\ldots', ldots: '\\ldots',
  // "같은 방법으로 β,γ도...VDOTS이다"처럼 단계별 풀이 생략을 나타내는 세로
  // 점(⋮) — 실제 파일에서 변환 없이 "VDOTS" 글자 그대로 남는 것 확인.
  VDOTS: '\\vdots', vdots: '\\vdots',
  amp: '&', QED: '\\blacksquare',
  le: '\\leq', ge: '\\geq',
  prime: "'",
  arrow: '\\rightarrow',
  rarrow: '\\rightarrow', larrow: '\\leftarrow', lrarrow: '\\leftrightarrow',
  rrarrow: '\\Rightarrow', llarrow: '\\Leftarrow', lrrarrow: '\\Leftrightarrow',
  CAP: '\\cap', SMALLINTER: '\\cap', CUP: '\\cup', cup: '\\cup',
  SUBSET: '\\subset', SUPSET: '\\supset',
  EMPTYSET: '\\emptyset', emptyset: '\\emptyset',
};

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
      if (/^\\[A-Za-z]+$/.test(repl) && /[A-Za-z]/.test(run[i] || '')) repl += ' ';
      out += repl;
    } else { out += run[i]; i++; }
  }
  return out;
}

const HWP_ENCLOSED_HANGUL = { '㈎': '(가)', '㈏': '(나)', '㈐': '(다)', '㈑': '(라)', '㈒': '(마)' };

function convertHwpEquationToLatex(script) {
  if (!script) return '';
  let s = script;
  s = s.replace(/[㈎㈏㈐㈑㈒]/g, (ch) => `\\text{${HWP_ENCLOSED_HANGUL[ch]}}`);
  s = s.replace(/`/g, ' ');
  s = s.replace(/"([^"]*)"/g, '\\text{$1}');
  s = s.replace(/!=/g, '\\neq ');
  s = resolveCases(s);
  s = resolveMatrices(s);
  s = s.replace(/LEFT\s*\(/gi, '\\left(');
  s = s.replace(/RIGHT\s*\)/gi, '\\right)');
  s = s.replace(/LEFT\s*\[/gi, '\\left[');
  s = s.replace(/RIGHT\s*\]/gi, '\\right]');
  s = s.replace(/LEFT\s*\{/gi, '\\left\\{');
  s = s.replace(/RIGHT\s*\}/gi, '\\right\\}');
  s = s.replace(/LEFT\s*\|/gi, '\\left|');
  s = s.replace(/RIGHT\s*\|/gi, '\\right|');
  s = s.replace(/LEFT\s*\./gi, '\\left.');
  s = s.replace(/RIGHT\s*\./gi, '\\right.');
  s = s.replace(/(?<!\\)\bLEFT\b/gi, '\\left\\{');
  s = s.replace(/(?<!\\)\bRIGHT\b/gi, '\\right\\}');
  s = s.replace(/\bNOTIN\b/gi, '\\notin');
  s = s.replace(/\bIN\b/gi, '\\in');
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
  s = applyUnary(s, 'root', '\\sqrt', false, true);
  s = applyUnary(s, 'bar', '\\overline', false, true);
  s = applyUnary(s, 'hat', '\\hat');
  s = applyUnary(s, 'vec', '\\vec');
  s = applyUnary(s, 'tilde', '\\tilde');
  s = applyUnary(s, 'ddot', '\\ddot');
  s = applyUnary(s, 'dot', '\\dot');
  s = applyUnary(s, 'box', '\\boxed', true, true);
  s = s.replace(/\\boxed\{[~\s]*\}/g, '\\boxed{\\phantom{X}\\phantom{X}}');
  s = resolveOverFractions(s);
  s = s.replace(/\brm(?=[A-Za-z])/g, '').replace(/\brm\b/g, '');
  s = s.replace(/\bit(?=[A-Za-z])/g, '').replace(/\bit\b/g, '');
  s = s.replace(/(?<!\\)([A-Za-z]+)/g, (m, w) => substituteSymbolsInRun(w));
  const leftCount = (s.match(/\\left\b/g) || []).length;
  const rightCount = (s.match(/\\right\b/g) || []).length;
  if (leftCount !== rightCount) {
    s = s.replace(/\\left\./g, '').replace(/\\right\./g, '');
    s = s.replace(/\\left\b/g, '').replace(/\\right\b/g, '');
  }
  return s.trim();
}

function decodeXmlEntities(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function extractOrderedChildren(xml, tagNames) {
  const all = [];
  for (const tag of tagNames) {
    for (const b of findTopLevelBlocks(xml, tag)) all.push({ tag, ...b });
  }
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
    let sz = rectSizeMm(picXml);
    if (!sz || (sz.w === 0 && sz.h === 0)) {
      const orgM = picXml.match(/<hp:orgSz width="(\d+)" height="(\d+)"/);
      sz = orgM ? { w: hwpUnitToMm(Number(orgM[1])), h: hwpUnitToMm(Number(orgM[2])) } : null;
    }
    const sizeAttr = sz ? ` style="max-width:max(${sz.w.toFixed(1)}mm, 1.8em);height:auto"` : '';
    return `<img class="hwpImg" src="data:${mime};base64,${base64}" alt=""${sizeAttr} data-bin-id="${escapeHtml(refM[1])}" data-bin-href="${escapeHtml(href)}">`;
  } catch (e) { return ''; }
}

function borderFillAllNone(entry, id) {
  return !!(entry && entry.borderFills && entry.borderFills.get(id));
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
      const fillM = tc.text.match(/<hp:tc\b[^>]*\bborderFillIDRef="(\d+)"/);
      const noBorderAttr = fillM && borderFillAllNone(entry, fillM[1]) ? ' style="border:none"' : '';
      rowHtml += `<td colspan="${colSpan}" rowspan="${rowSpan}"${noBorderAttr}>${cellInner}</td>`;
    }
    rowsHtml += `<tr>${rowHtml}</tr>`;
  }
  return `<table class="hwpTbl">${rowsHtml}</table>`;
}

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
    if (!sz || sz.w > 40 || sz.h > 20) return '';
    return `<span class="hwpBlankBox" style="width:${sz.w.toFixed(1)}mm;height:${sz.h.toFixed(1)}mm"></span>`;
  }
  const trimmedInner = inner.trim();
  const innerTopBlocks = findTopLevelBlocks(trimmedInner, 'div');
  const isSingleStyledBox = innerTopBlocks.length === 1 && innerTopBlocks[0].start === 0 &&
    innerTopBlocks[0].end === trimmedInner.length && /^<div class="hwp(Bogi|CondBox)"/.test(trimmedInner);
  if (isSingleStyledBox) return trimmedInner;
  return `<div class="hwpRectBox">${inner}</div>`;
}

function stripRectBlocksForRaw(xml) {
  const blocks = [...findTopLevelBlocks(xml, 'hp:rect'), ...findTopLevelBlocks(xml, 'hp:tbl')].sort((a, b) => a.start - b.start);
  let out = '';
  let pos = 0;
  for (const b of blocks) { out += xml.slice(pos, b.start); pos = b.end; }
  out += xml.slice(pos);
  return out;
}

function stripEquationBlocksForRaw(xml) {
  const blocks = findTopLevelBlocks(xml, 'hp:equation');
  let out = '';
  let pos = 0;
  for (const b of blocks) { out += xml.slice(pos, b.start); pos = b.end; }
  out += xml.slice(pos);
  return out;
}

function hwpInlineControlsToHtml(raw) {
  return raw
    .replace(/<hp:lineBreak\b[^>]*\/>/g, '\n')
    .replace(/<hp:tab\b[^>]*\/>/g, '    ')
    .replace(/<hp:fwSpace\b[^>]*\/>/g, ' ')
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
      const sm = c.text.match(/<hp:script\b[^>]*>([\s\S]*?)<\/hp:script>/);
      const rawScript = sm ? decodeXmlEntities(sm[1]) : '';
      let latex = '';
      try { latex = rawScript ? convertHwpEquationToLatex(rawScript) : ''; } catch (e) { latex = ''; }
      if (latex) {
        out += ` <span class="eq">\\(${escapeHtml(latex)}\\)</span> `;
      } else if (rawScript) {
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

async function hwpFragmentRunsToHtml(xml, entry) {
  const runs = findTopLevelBlocks(xml, 'hp:run');
  let out = '';
  for (const r of runs) out += await hwpRunInnerToHtml(r.text, entry);
  return out;
}

function formatChoiceRow(paraInners) {
  const rows = [];
  let prefixHtml = '';
  paraInners.forEach((inner, idx) => {
    const markerIdx = inner.search(/[①②③④⑤]/);
    if (markerIdx === -1) return;
    if (idx === 0 && markerIdx > 0) prefixHtml = inner.slice(0, markerIdx).trim();
    const parts = inner.slice(markerIdx).split(/(?=[①②③④⑤])/).map(s => s.trim()).filter(Boolean);
    if (parts.length) rows.push(parts);
  });
  const totalItems = rows.reduce((n, r) => n + r.length, 0);
  if (totalItems < 2) return null;
  const cols = Math.max(...rows.map(r => r.length));
  const rowsHtml = rows.map(parts =>
    `<div class="choiceRow" style="grid-template-columns:repeat(${cols},1fr)">${parts.map(p => `<span class="choiceItem">${p}</span>`).join('')}</div>`
  ).join('');
  return (prefixHtml ? `<p>${prefixHtml}</p>` : '') + rowsHtml;
}

const CONDITION_MARKERS = ['(가)', '(나)', '(다)', '(라)', '(마)'];

function formatConditionBox(inner, rawText) {
  const foundCount = CONDITION_MARKERS.filter(mk => rawText.includes(mk)).length;
  if (foundCount < 2) return null;
  if (/\([가나다라마]\)\s*~/.test(rawText)) return null;
  // "이 9개의 숫자 중 다음 조건을 만족시키도록..." 처럼 첫 (가)/(나) 앞에
  // 붙어 있는 도입부 문장은 조건 목록 자체가 아니라 박스 바깥에 있어야 할
  // 일반 문장이다 — 마커 앞부분을 split에 포함시키면 그 도입부까지 통째로
  // 박스 안에 들어가 버려서(실제 파일로 확인) 박스가 이상하게 커 보였다.
  // formatBogiBox의 prefix 처리와 동일한 방식으로 분리.
  const markerIdx = inner.search(/\([가나다라마]\)/);
  if (markerIdx === -1) return null;
  const prefix = inner.slice(0, markerIdx).trim();
  const parts = inner.slice(markerIdx).split(/(?=\([가나다라마]\))/).map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const substantiveCount = parts.filter(p => {
    const stripped = stripTags(p).replace(/^\([가나다라마]\)/, '').replace(/[,.\s]/g, '');
    return stripped.length >= 2;
  }).length;
  if (substantiveCount < parts.length - 1) return null;
  const box = `<div class="hwpCondBox">${parts.map(p => `<p>${p}</p>`).join('')}</div>`;
  return prefix ? `<p>${prefix}</p>${box}` : box;
}

async function hwpBodyXmlToHtml(xml, entry) {
  const paras = findTopLevelBlocks(xml, 'hp:p');
  const items = [];
  for (const p of paras) {
    const inner = await hwpFragmentRunsToHtml(p.text, entry);
    if (!inner.trim()) continue;
    items.push({ raw: decodeXmlEntities(stripTags(stripEquationBlocksForRaw(stripRectBlocksForRaw(stripCtrlBlocks(p.text))))).trim(), inner });
  }

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
    return /<div\b/.test(it.inner) ? `<div>${it.inner}</div>` : `<p>${it.inner}</p>`;
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

  for (let m = 0; m < resolved.length; m++) {
    if (!/^<div class="hwpBogi">/.test(resolved[m].html)) continue;
    let n = m + 1;
    while (n < resolved.length && /^<div class="hwpBogi">/.test(resolved[n].html)) n++;
    if (n - m > 1) {
      const inner = resolved.slice(m, n).map(it => it.html.replace(/^<div class="hwpBogi">|<\/div>$/g, '')).join('');
      resolved.splice(m, n - m, { raw: '', html: `<div class="hwpBogi">${inner}</div>` });
    }
  }

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

function isBlankPara(p) {
  return stripTags(p.text).trim() === '';
}

function isEmptySpacerPara(p) {
  return isBlankPara(p) && !p.text.includes('<hp:pic');
}

function looksLikeNextQuestionMarker(p) {
  const t = stripTags(p.text).trim();
  return /^유형\s*\d+\s*[:：]/.test(t) || /^\[[^\]]*\]$/.test(t);
}

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

    for (;;) {
      let k = j, gap = 0;
      while (k < nextI && isBlankPara(paras[k]) && gap < 3) { k++; gap++; }
      if (!(k < nextI && looksLikeOrphanedFragment(paras[k]))) break;
      const distHere = gap;
      let m = k;
      while (m < nextI && !isBlankPara(paras[m]) && !looksLikeNextQuestionMarker(paras[m])) m++;
      const distNext = nextI - m;
      const isTable = paras[k].text.includes('<hp:tbl');
      if (!(isTable || distHere <= distNext)) break;
      if (m <= k) break;
      j = m;
    }
    return j;
  });
  const result = new Map();
  for (let k = 0; k < boundaries.length; k++) {
    let start = k > 0 ? choicesEnd[k - 1] : 0;
    const end = choicesEnd[k];
    while (start < end - 1 && isEmptySpacerPara(paras[start])) start++;
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

async function parseBorderFillMap(zipData) {
  const map = new Map();
  const file = zipData.file('Contents/header.xml');
  if (!file) return map;
  const xml = await file.async('string');
  for (const b of findTopLevelBlocks(xml, 'hh:borderFill')) {
    const idM = b.text.match(/<hh:borderFill\b[^>]*\bid="(\d+)"/);
    if (!idM) continue;
    const sides = ['leftBorder', 'rightBorder', 'topBorder', 'bottomBorder'];
    const allNone = sides.every(side => {
      const sideM = b.text.match(new RegExp(`<hh:${side}\\b[^>]*\\btype="([A-Z]+)"`));
      return sideM && sideM[1] === 'NONE';
    });
    map.set(idM[1], allNone);
  }
  return map;
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
  const borderFills = await parseBorderFillMap(zipData);
  return { zipData, sectionOrder, manifestItems, markers, borderFills };
}

// ==================== 클리닉 교재 생성기 앱 로직 ====================

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbynxupIBGMhIb6knPPTzCgQ3No_nId6YdjoKsvoFGZAEk4HkVztI0a6Wto5UfUww8e1/exec';
const TEACHER_KEY = 'mathyyuri2026';

let jsonpCounter = 0;
function callGet(params) {
  return new Promise((resolve, reject) => {
    const cbName = 'jsonp_cb_' + (jsonpCounter++) + '_' + Date.now();
    const timer = setTimeout(() => { cleanup(); reject(new Error('요청 시간 초과 (30초)')); }, 30000);
    const script = document.createElement('script');
    function cleanup() { clearTimeout(timer); delete window[cbName]; script.remove(); }
    window[cbName] = (data) => { cleanup(); if (!data.ok) reject(new Error(data.error || '서버 오류')); else resolve(data); };
    script.src = APPS_SCRIPT_URL + '?' + new URLSearchParams({ ...params, callback: cbName }).toString();
    script.onerror = () => { cleanup(); reject(new Error('스크립트 로드 실패')); };
    document.body.appendChild(script);
  });
}
async function callPost(body) {
  await fetch(APPS_SCRIPT_URL, {
    method: 'POST', mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  });
}

// ---------- 1. 업로드/파싱 ----------
let parsedEntry = null;
let questionNums = []; // ["1","2",...] parsed order
let rawFilename = '';

document.getElementById('fileInput').addEventListener('change', () => {
  document.getElementById('parseBtn').disabled = !document.getElementById('fileInput').files.length;
});

document.getElementById('parseBtn').addEventListener('click', async () => {
  const hint = document.getElementById('parseHint');
  const file = document.getElementById('fileInput').files[0];
  if (!file) return;
  rawFilename = file.name;
  hint.textContent = '분석 중...';
  hint.className = 'hint';
  try {
    const buf = await file.arrayBuffer();
    const zipData = await JSZip.loadAsync(buf);
    parsedEntry = await parseHwpx(zipData);
    parsedEntry.filename = file.name;
    questionNums = [...parsedEntry.markers.keys()].sort((a, b) => Number(a) - Number(b));
    if (!questionNums.length) throw new Error('문제 번호를 하나도 인식하지 못했습니다.');
    hint.textContent = `${questionNums.length}문제 인식됨`;
    hint.className = 'hint ok';
    await renderQuestionList();
    document.getElementById('qBox').style.display = '';
    document.getElementById('titleBox').style.display = '';
    document.getElementById('gradeBox').style.display = '';
    if (!document.getElementById('issueDate').value) {
      document.getElementById('issueDate').value = new Date().toISOString().slice(0, 10);
    }
    const savedVol = Number(localStorage.getItem('clinicmaker_lastVol') || '0');
    document.getElementById('volNum').value = savedVol + 1;
    updateTitlePreview();
  } catch (e) {
    hint.textContent = '실패: ' + e.message;
    hint.className = 'hint err';
  }
});

async function renderQuestionList() {
  const el = document.getElementById('qList');
  let html = '';
  for (const num of questionNums) {
    const marker = parsedEntry.markers.get(num);
    const noComments = stripCtrlBlocks(marker.blockXml).replace(/<hp:shapeComment>[\s\S]*?<\/hp:shapeComment>/g, '');
    const raw = decodeXmlEntities(stripTags(stripRectBlocksForRaw(noComments))).replace(/\s+/g, ' ').trim();
    const preview = raw.length > 140 ? raw.slice(0, 140) + '…' : raw;
    html += `<label class="qRow"><input type="checkbox" class="qChk" value="${escapeHtml(num)}" checked><span class="qNum">${num}.</span><span class="qPreview">${escapeHtml(preview)}</span></label>`;
  }
  el.innerHTML = html;
  el.querySelectorAll('.qChk').forEach(chk => chk.addEventListener('change', updateQCount));
  updateQCount();
}
function updateQCount() {
  const n = document.querySelectorAll('.qChk:checked').length;
  document.getElementById('qCountHint').textContent = `${n}문제 선택됨`;
}
document.getElementById('selAllBtn').addEventListener('click', () => {
  const boxes = [...document.querySelectorAll('.qChk')];
  const allChecked = boxes.every(b => b.checked);
  boxes.forEach(b => { b.checked = !allChecked; });
  updateQCount();
});

// ---------- 2. 제목 ----------
function formattedDate() {
  const v = document.getElementById('issueDate').value;
  if (!v) return '';
  const [y, m, d] = v.split('-').map(Number);
  return `${y}. ${m}. ${d}.`;
}
function composedTitle() {
  const vol = document.getElementById('volNum').value || '1';
  return `${formattedDate()} MATHY YURI'S CLINIC Vol.${vol}`;
}
function currentTitle() {
  const override = document.getElementById('titleOverrideChk').checked;
  return override ? (document.getElementById('titleOverrideInput').value.trim() || composedTitle()) : composedTitle();
}
function updateTitlePreview() {
  document.getElementById('titlePreview').textContent = currentTitle();
  if (!document.getElementById('gradeMission').value.trim() ||
      document.getElementById('gradeMission').dataset.auto !== 'false') {
    document.getElementById('gradeMission').value = currentTitle();
    document.getElementById('gradeMission').dataset.auto = 'true';
  }
}
['issueDate', 'volNum', 'titleOverrideInput'].forEach(id =>
  document.getElementById(id).addEventListener('input', updateTitlePreview));
document.getElementById('titleOverrideChk').addEventListener('change', (e) => {
  document.getElementById('titleOverrideInput').style.display = e.target.checked ? '' : 'none';
  updateTitlePreview();
});
document.getElementById('gradeMission').addEventListener('input', () => {
  document.getElementById('gradeMission').dataset.auto = 'false';
});

// ---------- 3. A4 2단 페이지 생성 (한 다단에 문제 1개씩만) ----------
const MB_PAGE_W_MM = 210, MB_PAGE_H_MM = 297;
const MB_CONTENT_TOP_MM = 26, MB_CONTENT_BOTTOM_MM = 18, MB_CONTENT_SIDE_MM = 16;
const MB_COL_GAP_MM = 10;
// .clQBlock 아래 여백 — 한 다단에 문제가 1개뿐이라 다른 문제와 부딪힐 일은
// 없지만, 박스형 문제(조건박스/보기박스)와 페이지 하단 사이 여백으로 쓰임.
const MB_Q_GAP_MM = 10;

// 한 다단에 문제를 딱 1개씩만 배치 — 문제 길이에 따라 2개까지 채우던 이전
// 방식(높이 실측 기반)을 버리고, 페이지당 2단(=2문제)으로 단순 고정.
function paginateQuestions(blocksHtml) {
  const columns = blocksHtml.map(html => [html]);
  const pages = [];
  for (let c = 0; c < columns.length; c += 2) pages.push([columns[c], columns[c + 1] || []]);
  return pages;
}

async function buildQuestionBlocks() {
  const selected = [...document.querySelectorAll('.qChk:checked')].map(chk => chk.value);
  const blocks = [];
  for (const num of selected) {
    const marker = parsedEntry.markers.get(num);
    const bodyHtml = await hwpBodyXmlToHtml(marker.blockXml, parsedEntry);
    blocks.push(`<div class="clQBlock"><div class="clQNum">${num}</div><div class="clQBody">${bodyHtml}</div></div>`);
  }
  return blocks;
}

document.getElementById('generateBtn').addEventListener('click', async () => {
  const btn = document.getElementById('generateBtn');
  const hint = document.getElementById('genHint');
  btn.disabled = true;
  const origText = btn.textContent;
  try {
    btn.textContent = '생성 중...';
    const title = currentTitle();
    const blocks = await buildQuestionBlocks();
    if (!blocks.length) throw new Error('선택된 문제가 없습니다.');
    const colWidthMm = (MB_PAGE_W_MM - MB_CONTENT_SIDE_MM * 2 - MB_COL_GAP_MM) / 2;
    const colHeightMm = MB_PAGE_H_MM - MB_CONTENT_TOP_MM - MB_CONTENT_BOTTOM_MM;
    const pages = paginateQuestions(blocks);
    const vol = document.getElementById('volNum').value || '1';
    downloadClinicHtml(title, pages, colWidthMm, colHeightMm, formattedDate(), vol);
    localStorage.setItem('clinicmaker_lastVol', document.getElementById('volNum').value || '1');
    hint.textContent = `완료 — ${blocks.length}문제, 문제 ${pages.length}페이지 (+앞표지/메모란/뒤표지 각 1페이지)`;
    hint.className = 'hint ok';
  } catch (e) {
    hint.textContent = '실패: ' + e.message;
    hint.className = 'hint err';
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
});

function downloadClinicHtml(title, pages, colWidthMm, colHeightMm, dateText, volText) {
  const questionPagesHtml = pages.map((page, pi) => `
    <section class="clSheet">
      <div class="clHead">${escapeHtml(title)}</div>
      <div class="clBody">
        ${page.map(col => `<div class="clCol">${col.join('')}</div>`).join('')}
      </div>
      <div class="clFoot">${pi + 1} / ${pages.length}</div>
    </section>`).join('\n');

  // 앞표지 — 제목/회차/출제일을 크게 보여주고, 이름/반을 직접 적을 수 있게
  // 빈 칸을 남겨둔다(다른 도구들처럼 학생 이름을 코드에 미리 채워넣지 않음).
  const frontCoverHtml = `
    <section class="clSheet clCover">
      <div class="ccFrame"></div>
      <div class="ccFrameSide ccFrameL"></div>
      <div class="ccFrameSide ccFrameR"></div>
      <div class="ccNameRow">
        <span class="ccFieldLabelH">반</span>
        <span class="ccFieldLabelH">이름</span>
      </div>
      <div class="ccKicker">MATH CLINIC WORKBOOK</div>
      <h1 class="ccTitle">MATHY<br>YURI'S<br>CLINIC</h1>
      <div class="ccRule"></div>
      <div class="ccVol">Vol. ${escapeHtml(volText)}</div>
      <div class="ccDate">${escapeHtml(dateText)}</div>
    </section>`;

  // 뒤표지 — 앞표지와 짝을 이루는 클로징 페이지(이름란 없이 같은 프레임만).
  const backCoverHtml = `
    <section class="clSheet clCover clCoverBack">
      <div class="ccFrame"></div>
      <div class="ccFrameSide ccFrameL"></div>
      <div class="ccFrameSide ccFrameR"></div>
      <div class="ccBackMark">MATHY YURI'S<br>CLINIC</div>
      <div class="ccBackSub">Vol. ${escapeHtml(volText)} · ${escapeHtml(dateText)}</div>
      <div class="ccBackNote">오늘도 수고했어요.</div>
    </section>`;

  // 여유분 메모란 — 문제 풀며 쓸 계산/오답 정리용 여백 페이지.
  const memoLines = Array.from({ length: 24 }).map(() => '<div class="clMemoLine"></div>').join('');
  const memoPageHtml = `
    <section class="clSheet">
      <div class="clHead">${escapeHtml(title)} — MEMO</div>
      <div class="clMemoBody">${memoLines}</div>
    </section>`;

  const html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,700;0,900&family=Noto+Serif+KR:wght@400;700;900&family=Noto+Sans+KR:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"><\/script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"><\/script>
<script defer src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"><\/script>
<script defer src="https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js"><\/script>
<style>
:root{--ink:#1A1A1A;--gold:#A8853F;--gold-line:#E6DCC6;--cream:#D9F0E6;--mint-deep:#3E8F79;--border-deep:#141414;}
*{box-sizing:border-box}
body{font-family:'Noto Sans KR',sans-serif;background:#ddd6c8;margin:0;padding:12mm 0 30mm}
.clSheet{position:relative;width:${MB_PAGE_W_MM}mm;min-height:${MB_PAGE_H_MM}mm;margin:0 auto 10mm;background:var(--cream);box-shadow:0 2px 14px rgba(0,0,0,.2);padding:${MB_CONTENT_TOP_MM}mm ${MB_CONTENT_SIDE_MM}mm ${MB_CONTENT_BOTTOM_MM}mm}
.clHead{position:absolute;top:10mm;left:${MB_CONTENT_SIDE_MM}mm;right:${MB_CONTENT_SIDE_MM}mm;font-family:'Playfair Display','Noto Serif KR',serif;font-weight:900;font-size:14px;color:var(--ink);border-bottom:2px solid var(--ink);padding-bottom:2mm}
.clBody{display:grid;grid-template-columns:1fr 1fr;column-gap:${MB_COL_GAP_MM}mm;min-height:${colHeightMm}mm}
.clCol{border-left:1px solid var(--gold-line);padding-left:${MB_COL_GAP_MM / 2}mm;min-width:0}
.clCol:first-child{border-left:none;padding-left:0}
.clQBlock{break-inside:avoid;margin-bottom:${MB_Q_GAP_MM}mm;font-size:12.5px;line-height:1.6}
.clQNum{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:var(--ink);color:var(--cream);font-weight:800;font-size:16px;margin-bottom:2.5mm}
.clQBody p{margin:0 0 2mm}
.clQBody img{max-width:100%;height:auto;display:block;margin:2mm auto}
.clQBody table{border-collapse:collapse;margin:2mm 0}
.clQBody td{border:1px solid var(--gold-line);padding:2px 6px;font-size:11px}
.choiceRow{display:grid;grid-template-columns:repeat(2,1fr);row-gap:2mm;column-gap:4mm;margin:2mm 0}
.choiceItem{font-size:12px}
.hwpBogi,.hwpCondBox{border:1.1px solid var(--ink);border-radius:2px;padding:2mm 3mm;margin:2mm 0;font-size:11.5px}
.hwpRectBox{border:1px solid var(--gold-line);padding:1.5mm 2.5mm;margin:1.5mm 0}
.clFoot{position:absolute;bottom:8mm;left:0;right:0;text-align:center;font-size:10px;color:rgba(26,26,26,.5)}

/* ---- 표지 ---- */
.clCover{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;overflow:hidden}
/* 표지 프레임 — CSS border(두꺼운 폭에서 모서리가 대각선으로 miter 처리되며
   PDF 캡처(html2canvas) 시 그 대각선 이음매에 지저분한 톱니 아티팩트가 생기는
   문제가 있어, 대신 상하좌우 4개의 단색 사각형을 각 변에 꽉 채워 겹치는
   방식으로 그린다(대각선 이음매 자체가 없어 캡처가 항상 깨끗함). 이번에는
   프레임에 "구멍"을 내지 않고 그대로 유지 — 이름란은 프레임 안쪽 여백에
   따로 배치한다(.ccNameRow).*/
.ccFrame{position:absolute;inset:0;pointer-events:none}
.ccFrame::before,.ccFrame::after{content:'';position:absolute;background:var(--border-deep)}
.ccFrame::before{top:0;left:0;right:0;height:10mm}
.ccFrame::after{bottom:0;left:0;right:0;height:10mm}
.ccFrameSide{position:absolute;top:0;bottom:0;width:10mm;background:var(--border-deep)}
.ccFrameSide.ccFrameL{left:0}
.ccFrameSide.ccFrameR{right:0}
/* 좌상단 이름/반 기입란 — 테두리 안쪽(테두리를 침범하지 않는 위치)에 반/
   이름을 한 줄로 나란히 적을 수 있는 칸을 만든다. */
.ccNameRow{position:absolute;top:16mm;left:16mm;display:flex;flex-direction:column;align-items:flex-start;gap:6mm}
.ccFieldLabelH{font-family:'Noto Sans KR',sans-serif;font-size:11px;font-weight:700;letter-spacing:.1em;color:rgba(26,26,26,.6)}
.ccKicker{font-family:'Noto Sans KR',sans-serif;font-weight:700;font-size:11px;letter-spacing:.28em;color:var(--border-deep)}
.ccTitle{font-family:'Playfair Display','Noto Serif KR',serif;font-weight:900;font-size:64px;line-height:1.12;color:var(--ink);margin:9mm 0}
.ccRule{width:26mm;height:2px;background:var(--border-deep);margin:2mm 0 6mm}
.ccVol{font-family:'Noto Serif KR',serif;font-weight:700;font-size:15px;color:var(--ink)}
.ccDate{font-size:11px;color:rgba(26,26,26,.6);margin-top:2mm}
.ccBackMark{font-family:'Playfair Display','Noto Serif KR',serif;font-weight:900;font-size:24px;line-height:1.3;color:var(--ink)}
.ccBackSub{font-size:11px;color:rgba(26,26,26,.55);margin-top:4mm;letter-spacing:.04em}
.ccBackNote{font-family:'Noto Serif KR',serif;font-size:13px;color:var(--border-deep);margin-top:14mm}

/* ---- 메모란 ---- */
.clMemoBody{display:flex;flex-direction:column;gap:9mm;padding-top:4mm}
.clMemoLine{border-bottom:1px solid var(--gold-line);height:1px}

.exportBar{position:fixed;top:16px;right:16px;z-index:999;display:flex;gap:8px}
.exportBar button{background:var(--ink);color:var(--cream);border:none;padding:10px 18px;border-radius:6px;font-family:'Noto Sans KR',sans-serif;font-weight:700;font-size:13px;cursor:pointer;box-shadow:0 3px 12px rgba(0,0,0,.28)}
.exportBar button:hover:not(:disabled){background:var(--mint-deep)}
.exportBar button:disabled{opacity:.6;cursor:default}
@media print{.exportBar{display:none}body{background:#fff;padding:0}.clSheet{box-shadow:none;margin:0;page-break-after:always}}
@page{size:A4;margin:0}
</style></head><body>
<div class="exportBar">
  <button type="button" id="saveImgBtn">지금 화면 이미지로 저장</button>
  <button type="button" id="savePdfBtn">여백없는 PDF로 저장</button>
</div>
${frontCoverHtml}
${questionPagesHtml}
${memoPageHtml}
${backCoverHtml}
<script>
document.addEventListener('DOMContentLoaded', function () {
  function tryRender() {
    if (window.renderMathInElement) {
      renderMathInElement(document.body, { delimiters: [{ left: '\\\\(', right: '\\\\)', display: false }, { left: '\\\\[', right: '\\\\]', display: true }], throwOnError: false });
    } else {
      setTimeout(tryRender, 100);
    }
  }
  tryRender();

  // 브라우저 인쇄(Ctrl+P)는 배경 그래픽을 켜지 않으면 색이 다 날아가는
  // 문제가 있어서, html2canvas로 각 페이지를 실제 픽셀 이미지로 찍은 뒤
  // 그 이미지를 그대로 PDF에 붙이는 방식으로 저장한다 — 인쇄 대화상자를
  // 거치지 않으니 배경색/여백이 항상 그대로 남는다(studentnote.html 오답
  // 노트 내보내기와 동일한 방식).
  var clSheets = [...document.querySelectorAll('.clSheet')];
  async function captureSheet(el) {
    return await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
  }
  var exportFileBase = ${JSON.stringify(title.replace(/[\\\/:*?"<>|]/g, '_'))};
  var saveImgBtn = document.getElementById('saveImgBtn');
  var savePdfBtn = document.getElementById('savePdfBtn');
  if (saveImgBtn) saveImgBtn.addEventListener('click', async function () {
    saveImgBtn.disabled = true;
    var orig = saveImgBtn.textContent;
    saveImgBtn.textContent = '캡처 중...';
    try {
      var canvas = await captureSheet(clSheets[0]);
      var a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = exportFileBase + '.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      alert('이미지 저장 실패: ' + e.message);
    } finally {
      saveImgBtn.disabled = false;
      saveImgBtn.textContent = orig;
    }
  });
  if (savePdfBtn) savePdfBtn.addEventListener('click', async function () {
    savePdfBtn.disabled = true;
    var orig = savePdfBtn.textContent;
    try {
      var jsPDFCtor = (window.jspdf && window.jspdf.jsPDF);
      if (!jsPDFCtor) throw new Error('PDF 라이브러리를 불러오지 못했습니다');
      var pageW = 210;
      var pdf = null;
      for (var i = 0; i < clSheets.length; i++) {
        savePdfBtn.textContent = '캡처 중... (' + (i + 1) + '/' + clSheets.length + ')';
        var canvas = await captureSheet(clSheets[i]);
        var imgData = canvas.toDataURL('image/jpeg', 0.95);
        var pageH = pageW * (canvas.height / canvas.width);
        if (!pdf) {
          pdf = new jsPDFCtor({ orientation: 'portrait', unit: 'mm', format: [pageW, pageH] });
        } else {
          pdf.addPage([pageW, pageH], 'portrait');
        }
        pdf.addImage(imgData, 'JPEG', 0, 0, pageW, pageH, undefined, 'FAST');
      }
      pdf.save(exportFileBase + '.pdf');
    } catch (e) {
      alert('PDF 저장 실패: ' + e.message);
    } finally {
      savePdfBtn.disabled = false;
      savePdfBtn.textContent = orig;
    }
  });
});
<\/script>
</body></html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------- 4. 문제은행에 저장 ----------
document.getElementById('saveToBankBtn').addEventListener('click', async () => {
  const btn = document.getElementById('saveToBankBtn');
  const hint = document.getElementById('genHint');
  if (!document.getElementById('fileInput').files.length) { hint.textContent = '파일을 먼저 불러오세요.'; hint.className = 'hint err'; return; }
  btn.disabled = true;
  try {
    const file = document.getElementById('fileInput').files[0];
    const buf = await file.arrayBuffer();
    const base64 = btoa(new Uint8Array(buf).reduce((s, b) => s + String.fromCharCode(b), ''));
    const questionData = questionNums.map(num => ({ num, choiceCount: null, hasBogi: null, hasCondition: null, warnings: [], unit: '', type: '' }));
    await callPost({ action: 'upload', filename: rawFilename, data: base64, memo: currentTitle(), questionData: JSON.stringify(questionData) });
    hint.textContent = '문제은행에 저장 요청을 보냈습니다 (problembank.html에서 확인하고 태그를 채워주세요).';
    hint.className = 'hint ok';
  } catch (e) {
    hint.textContent = '저장 실패: ' + e.message;
    hint.className = 'hint err';
  } finally {
    btn.disabled = false;
  }
});

// ---------- 5. 채점 ----------
let gradeStudents = []; // [{name,class,cohort}]
let gradeItems = {}; // name -> {num: 1|2}

document.getElementById('loadRosterBtn').addEventListener('click', async () => {
  const hint = document.getElementById('gradeHint');
  const cohort = document.getElementById('gradeCohort').value;
  const className = document.getElementById('gradeClass').value.trim();
  const category = document.getElementById('gradeCategory').value.trim();
  const mission = document.getElementById('gradeMission').value.trim();
  if (!className || !category || !mission) { hint.textContent = '반/카테고리/미션명을 모두 입력하세요.'; hint.className = 'hint err'; return; }
  hint.textContent = '불러오는 중...';
  hint.className = 'hint';
  try {
    const data = await callGet({ action: 'examroster', key: TEACHER_KEY, cohort, class: className, category, mission });
    gradeStudents = data.students;
    gradeItems = {};
    for (const s of gradeStudents) {
      gradeItems[s.name] = {};
      (s.items || []).forEach((v, i) => { if (v === 1 || v === 2) gradeItems[s.name][i + 1] = v; });
    }
    renderGradeGrid();
    hint.textContent = `${gradeStudents.length}명 불러옴`;
    hint.className = 'hint ok';
    document.getElementById('saveScoresBtn').style.display = gradeStudents.length ? '' : 'none';
  } catch (e) {
    hint.textContent = '실패: ' + e.message;
    hint.className = 'hint err';
    document.getElementById('gradeArea').innerHTML = '';
    document.getElementById('saveScoresBtn').style.display = 'none';
  }
});

function renderGradeGrid() {
  const selected = [...document.querySelectorAll('.qChk:checked')].map(chk => chk.value);
  const area = document.getElementById('gradeArea');
  if (!gradeStudents.length) { area.innerHTML = '<p class="hint">해당 반에 학생이 없습니다.</p>'; return; }
  let html = '<div style="overflow-x:auto"><table class="gradeTbl"><tr><th>이름</th>';
  for (const num of selected) html += `<th>${num}</th>`;
  html += '<th>점수</th></tr>';
  for (const s of gradeStudents) {
    html += `<tr data-name="${escapeHtml(s.name)}"><td class="nameCell">${escapeHtml(s.name)}</td>`;
    for (const num of selected) {
      const v = gradeItems[s.name][num] || 0;
      html += `<td class="gradeCell" data-num="${num}" data-v="${v}">${v === 1 ? 'O' : v === 2 ? 'X' : ''}</td>`;
    }
    html += `<td class="scoreCell" data-role="score">-</td></tr>`;
  }
  html += '</table></div>';
  area.innerHTML = html;
  area.querySelectorAll('.gradeCell').forEach(cell => {
    cell.addEventListener('click', () => {
      const name = cell.closest('tr').dataset.name;
      const num = cell.dataset.num;
      const cur = gradeItems[name][num] || 0;
      const next = cur === 0 ? 1 : cur === 1 ? 2 : 0;
      if (next === 0) delete gradeItems[name][num]; else gradeItems[name][num] = next;
      cell.dataset.v = next;
      cell.textContent = next === 1 ? 'O' : next === 2 ? 'X' : '';
      updateScoreCell(cell.closest('tr'), name, selected.length);
    });
  });
  gradeStudents.forEach(s => updateScoreCell(area.querySelector(`tr[data-name="${CSS.escape(s.name)}"]`), s.name, selected.length));
}
function updateScoreCell(tr, name, total) {
  if (!tr) return;
  const correct = Object.values(gradeItems[name]).filter(v => v === 1).length;
  const answered = Object.keys(gradeItems[name]).length;
  tr.querySelector('[data-role="score"]').textContent = answered ? `${correct}/${answered}` : '-';
}

document.getElementById('saveScoresBtn').addEventListener('click', async () => {
  const btn = document.getElementById('saveScoresBtn');
  const hint = document.getElementById('saveHint');
  const selected = [...document.querySelectorAll('.qChk:checked')].map(chk => Number(chk.value));
  const cohort = document.getElementById('gradeCohort').value;
  const className = document.getElementById('gradeClass').value.trim();
  const category = document.getElementById('gradeCategory').value.trim();
  const mission = document.getElementById('gradeMission').value.trim();
  const maxNum = Math.max(...selected);
  const entries = gradeStudents.map(s => {
    const items = [];
    for (let n = 1; n <= maxNum; n++) items.push(gradeItems[s.name][n] || null);
    return { name: s.name, items, comment: '' };
  });
  btn.disabled = true;
  hint.textContent = '저장 중...';
  hint.className = 'hint';
  try {
    await callPost({ action: 'saveexamscores', key: TEACHER_KEY, cohort, category, class: className, mission, entries });
    hint.textContent = '저장 요청을 보냈습니다. (POST 응답은 확인할 수 없으니, 잠시 후 "명단 불러오기"로 다시 확인해보세요.)';
    hint.className = 'hint ok';
  } catch (e) {
    hint.textContent = '실패: ' + e.message;
    hint.className = 'hint err';
  } finally {
    btn.disabled = false;
  }
});
