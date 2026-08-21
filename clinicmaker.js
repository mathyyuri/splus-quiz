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

// "그냥 복붙" — copy the endnote's own first NON-BLANK line (a paragraph
// inside its <hp:subList>) verbatim, AS REAL CONTENT — including any
// <hp:equation> objects, not just their stripped text, so a rendered
// fraction/coordinate pair shows as an actual equation instead of raw
// script syntax. Returns the paragraph's inner <hp:run> XML (unwrapped —
// caller embeds it directly into its own paragraph).
function extractQuickAnswerXml(blockXml) {
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
    const stripped = stripTags(p.text).replace(/수식입니다\./g, '').replace(/\s+/g, ' ').trim();
    if (!stripped) continue;
    const runs = findTopLevelBlocks(p.text, 'hp:run');
    return runs.map(r => stripAutoNumCtrls(r.text)).join('');
  }
  return '';
}

// Like extractQuickAnswerXml, but returns the endnote's ENTIRE subList
// content (every paragraph, not just the first non-blank one) — used for
// the 해설(explanation) export section.
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

// 원본 그림(스캔/캡처된 도형·그래프)의 배경이 거의 항상 흰색으로 통째로
// 박혀 있어서, 크림/민트색 페이지 위에 놓이면 흰 사각형이 그대로 도드라져
// 보인다는 피드백 — 실제 픽셀에서 흰 배경만 투명으로 바꿔서, 화면이든
// html2canvas로 찍는 PDF/이미지 저장이든 어떤 배경색 위에서도 자연스럽게
// 녹아들게 한다(CSS mix-blend-mode는 html2canvas 캡처에서 지원이 들쭉날쭉
// 해서, 실제 알파 채널을 굽는 이 방식이 더 확실함).
function whitenToTransparent(imgEl) {
  const canvas = document.createElement('canvas');
  canvas.width = imgEl.naturalWidth;
  canvas.height = imgEl.naturalHeight;
  if (!canvas.width || !canvas.height) return null;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imgEl, 0, 0);
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imgData.data;
  // 문턱값 근처는 알파를 부드럽게 줄여(anti-alias 경계) 톱니 없이 자연스럽게
  // 섞이도록 한다.
  const LOW = 235, HIGH = 255;
  for (let i = 0; i < d.length; i += 4) {
    const minV = Math.min(d[i], d[i + 1], d[i + 2]);
    if (minV >= HIGH) d[i + 3] = 0;
    else if (minV > LOW) d[i + 3] = Math.round(d[i + 3] * (1 - (minV - LOW) / (HIGH - LOW)));
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/png');
}
function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
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
    let src = `data:${mime};base64,${base64}`;
    try {
      const img = await loadImageFromDataUrl(src);
      const converted = whitenToTransparent(img);
      if (converted) src = converted;
    } catch (e) { /* 변환 실패해도 원본 그림은 그대로 보여줌 */ }
    return `<img class="hwpImg" src="${src}" alt=""${sizeAttr} data-bin-id="${escapeHtml(refM[1])}" data-bin-href="${escapeHtml(href)}">`;
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
  // "위의 (가)에 알맞은 수를 p, (나)에 알맞은 식을 f(x)라 할 때, ...값은?"
  // — 이건 새로운 조건을 나열하는 문장이 아니라, 앞의 증명 박스 안에서 이미
  // 등장한 빈칸 (가)/(나)를 그냥 다시 언급하며 묻는 마무리 질문이다("위의"로
  // 시작 + "?"로 끝남). 실제 파일(삼차방정식 문제 21번)에서 이 한 문장 전체가
  // 통째로 불필요하게 박스 처리되는 것으로 확인 — "위의"로 시작하는 문장은
  // 조건 박스 대상에서 제외.
  // \b는 한글 앞뒤에서 발동하지 않으므로("의"→공백 전이는 word-boundary가
  // 아님) 여기선 \b 대신 뒤에 공백/문자열 끝이 오는지로 직접 확인.
  if (/^위의(?=\s|$)/.test(rawText.trim())) return null;
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
function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// ---------- 0. 저장된 클리닉 자료(구글 드라이브 문제은행에 연동) ----------
// 구글시트에 새 탭/전용 저장 공간을 직접 만들 방법이 없어서(Apps Script
// 코드 자체를 고칠 권한이 없음), 이미 배포되어 있는 문제은행 저장 API
// (problembank.html이 쓰는 것과 동일한 action=upload/list/download/delete)를
// 그대로 재사용한다 — 교재를 생성할 때마다 자동으로 문제은행에 함께
// 올라가고, 그중 memo에 "MATHY YURI'S CLINIC"이 들어있는 것만 걸러서 이
// 목록에 보여준다. 문제은행에 같이 섞여 보이는 것은 확인받음(다른 컴퓨터
// 에서도 목록이 그대로 보이는 게 목적이라 문제은행처럼 드라이브 공유
// 저장소를 통하는 것 외엔 방법이 없었음).
const CLINIC_MEMO_MARKER = "MATHY YURI'S CLINIC";
// 정답·해설 HTML을 문제은행에 공유 업로드할 때 쓰는 전용 마커 — 위
// CLINIC_MEMO_MARKER 문자열을 포함하지 않게 따로 둬서, "저장된 클리닉
// 자료" 목록(원본 시험지 기반, 다시 열기/바로 채점용)에 해설 파일이
// 섞여 들어가 목록이 깨지는 일이 없게 한다(index.html이 이 마커로 따로
// 찾아서 연다).
const CLINIC_KEY_MARKER = 'MYC_ANSWER_KEY_v1';
function arrayBufferToBase64(buf) {
  return btoa(new Uint8Array(buf).reduce((s, b) => s + String.fromCharCode(b), ''));
}

async function renderSavedList() {
  const el = document.getElementById('savedList');
  // index.html이 이 기능 추가 이전 버전이면 이 요소가 없을 수 있다 — 없으면
  // 조용히 아무것도 안 하고 빠져나간다(과거엔 여기서 null.innerHTML 접근이
  // 예외를 던지면서 이 아래에 나오는 업로드/파싱 관련 이벤트 리스너 등록
  // 전체가 멈춰버려, "파일을 선택해도 불러오기 버튼이 안 눌리는" 원인이 됨
  // — index.html과 clinicmaker.js는 항상 같이 최신으로 맞춰야 함).
  if (!el) return;
  el.innerHTML = '<p class="hint" style="padding:10px 4px">불러오는 중...</p>';
  let files, keyIdByTitle;
  try {
    const data = await callGet({ action: 'list' });
    const all = data.files || [];
    // 정답·해설 공유 업로드(memo가 CLINIC_KEY_MARKER로 시작)는 원본 시험지가
    // 아니라 "다시 열기/바로 채점"이 통하지 않으니, memo에 우연히
    // CLINIC_MEMO_MARKER 문자열이 겹쳐도 이 목록에서는 반드시 제외한다.
    files = all.filter(f => (f.memo || '').includes(CLINIC_MEMO_MARKER) && !(f.memo || '').startsWith(CLINIC_KEY_MARKER));
    files.sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
    // 정답·해설 공유 업로드는 memo가 "MYC_ANSWER_KEY_v1 <제목>" 형태라,
    // 뒤쪽 제목만 잘라내 그 제목의 원본 시험지 memo(=제목 그대로)와
    // 매칭시키면 어떤 저장된 교재에 해설이 이미 있는지 알 수 있다.
    keyIdByTitle = {};
    all.filter(f => (f.memo || '').startsWith(CLINIC_KEY_MARKER)).forEach(f => {
      const title = f.memo.slice(CLINIC_KEY_MARKER.length).trim();
      keyIdByTitle[title] = f.id;
    });
  } catch (e) {
    el.innerHTML = `<p class="hint err">불러오기 실패: ${escapeHtml(e.message)}</p>`;
    return;
  }
  populateMissionSelect(files);
  if (!files.length) { el.innerHTML = '<p class="hint" style="padding:10px 4px">아직 저장된 자료가 없습니다. 교재를 생성하면 자동으로 문제은행에 올라가고 여기 표시됩니다.</p>'; return; }
  el.innerHTML = files.map(f => {
    const hasKey = Object.prototype.hasOwnProperty.call(keyIdByTitle, f.memo || '');
    return `
    <div class="savedRow">
      <div style="flex:1;min-width:0">
        <div class="savedRowTitle">${escapeHtml(f.memo || f.filename)}</div>
        <div class="savedRowMeta">${escapeHtml(f.filename)} · ${f.uploadedAt ? escapeHtml(new Date(f.uploadedAt).toLocaleString('ko-KR')) : ''}</div>
      </div>
      <button type="button" class="secondary" data-act="reopen" data-id="${f.id}">다시 열기</button>
      <button type="button" data-act="grade" data-id="${f.id}">바로 채점</button>
      ${hasKey ? `<button type="button" class="secondary" data-act="viewkey" data-mission="${escapeHtml(f.memo || '')}">해설 링크 복사</button>` : '<span class="hint" style="align-self:center">해설 없음</span>'}
      <button type="button" class="secondary" data-act="delete" data-id="${f.id}">삭제</button>
    </div>`;
  }).join('');
}

async function loadSavedWorksheet(id, forGrading) {
  const hint = document.getElementById('parseHint');
  hint.textContent = '저장된 자료 불러오는 중...';
  hint.className = 'hint';
  const data = await callGet({ action: 'download', id });
  const file = data.file;
  if (!file) throw new Error('저장된 자료를 찾을 수 없습니다(삭제되었을 수 있어요).');
  const buf = base64ToArrayBuffer(file.data);
  rawFileBuf = buf;
  rawFilename = file.filename;
  const zipData = await JSZip.loadAsync(buf);
  parsedEntry = await parseHwpx(zipData);
  parsedEntry.filename = file.filename;
  questionNums = [...parsedEntry.markers.keys()].sort((a, b) => Number(a) - Number(b));
  await renderQuestionList();

  let qd = [];
  try { qd = JSON.parse(file.questionData || '[]'); } catch (e) {}
  const includedSet = new Set(qd.filter(q => q.included).map(q => String(q.num)));
  document.querySelectorAll('.qChk').forEach(chk => { chk.checked = includedSet.size ? includedSet.has(chk.value) : true; });
  updateQCount();

  document.getElementById('qBox').style.display = '';
  document.getElementById('titleBox').style.display = '';
  document.getElementById('keyBox').style.display = '';
  document.getElementById('gradeBox').style.display = '';
  if (!document.getElementById('issueDate').value) document.getElementById('issueDate').value = new Date().toISOString().slice(0, 10);
  // 저장 당시의 정확한 제목(Vol./날짜 포함)을 그대로 복원 — memo가 곧 그때의
  // 완성된 제목 문자열이므로, "제목 직접 입력"에 그대로 채워 넣으면 된다.
  if (file.memo) {
    document.getElementById('titleOverrideChk').checked = true;
    document.getElementById('titleOverrideInput').style.display = '';
    document.getElementById('titleOverrideInput').value = file.memo;
  }
  updateTitlePreview();

  hint.textContent = `"${file.memo || file.filename}" 불러옴 (전체 ${questionNums.length}문제 중 ${includedSet.size || questionNums.length}개 선택된 상태로 복원됨)`;
  hint.className = 'hint ok';

  if (forGrading) {
    document.getElementById('gradeCategory').value = '클리닉';
    setGradeMissionValue(file.memo || '');
    document.getElementById('gradeMission').dataset.auto = 'false';
    document.getElementById('gradeBox').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

document.getElementById('savedList')?.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;
  if (act === 'delete') {
    if (!confirm('이 저장 기록을 문제은행에서 삭제할까요?')) return;
    btn.disabled = true;
    try {
      await callPost({ action: 'delete', id });
      await renderSavedList();
    } catch (err) {
      alert('삭제 실패: ' + err.message);
      btn.disabled = false;
    }
    return;
  }
  if (act === 'viewkey') {
    // 이 링크는 로그인/TEACHER_KEY 없이도 열리는 공개 페이지(clinicanswer.html)
    // 로 연결돼, 학생·학부모 등 외부인에게 그대로 복사해 보내도 클릭만으로
    // 정답·해설을 볼 수 있다. id를 그대로 굳혀서 링크에 박아두면, 같은
    // 클리닉의 해설을 다시 생성(재생성)했을 때 옛 id가 가리키던 자료가
    // 지워지거나 옛 채로 남아 링크가 깨질 수 있어 — 미션명으로 담아
    // clinicanswer.html이 열릴 때마다 그 미션의 "가장 최근" 해설을 다시
    // 찾아 열도록 한다(항상 최신 상태를 가리키는 링크).
    const url = new URL('clinicanswer.html?mission=' + encodeURIComponent(btn.dataset.mission), location.href).href;
    window.open(url, '_blank');
    const orig = btn.textContent;
    const restore = () => { btn.textContent = orig; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => { btn.textContent = '링크 복사됨'; setTimeout(restore, 1500); }).catch(() => {});
    }
    return;
  }
  btn.disabled = true;
  try {
    await loadSavedWorksheet(id, act === 'grade');
  } catch (err) {
    alert('불러오기 실패: ' + err.message);
  } finally {
    btn.disabled = false;
  }
});

renderSavedList();

// ---------- 1. 업로드/파싱 ----------
let parsedEntry = null;
let questionNums = []; // ["1","2",...] parsed order
let rawFilename = '';
let rawFileBuf = null; // ArrayBuffer — 새로 업로드했든 저장된 자료를 다시 열었든 항상 최신 원본을 들고 있음(문제은행 저장 등에 재사용)

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
    rawFileBuf = buf;
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
    document.getElementById('keyBox').style.display = '';
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
    setGradeMissionValue(currentTitle());
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
    // "언제든 다시 확인할 수 있게" — 생성할 때마다 문제은행에도 자동으로
    // 함께 올려서(원본 파일 + 그때 선택했던 문제 번호를 questionData의
    // included 플래그로 같이 담아) 다른 컴퓨터에서도 목록이 그대로 보이고,
    // 나중에 그대로 다시 열거나 바로 채점으로 넘어갈 수 있게 한다. 실패해도
    // 다운로드 자체는 이미 끝난 뒤라 치명적이지 않으므로 조용히 무시.
    try {
      const selectedNums = [...document.querySelectorAll('.qChk:checked')].map(chk => chk.value);
      const questionData = questionNums.map(num => ({
        num, choiceCount: null, hasBogi: null, hasCondition: null, warnings: [], unit: '', type: '',
        included: selectedNums.includes(num),
      }));
      await callPost({ action: 'upload', filename: rawFilename, data: arrayBufferToBase64(rawFileBuf), memo: title, questionData: JSON.stringify(questionData) });
      await renderSavedList();
    } catch (e) { /* 저장 실패는 조용히 무시 — 다운로드는 이미 완료됨 */ }
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
  if (!rawFileBuf) { hint.textContent = '파일을 먼저 불러오세요.'; hint.className = 'hint err'; return; }
  btn.disabled = true;
  try {
    const questionData = questionNums.map(num => ({ num, choiceCount: null, hasBogi: null, hasCondition: null, warnings: [], unit: '', type: '' }));
    await callPost({ action: 'upload', filename: rawFilename, data: arrayBufferToBase64(rawFileBuf), memo: currentTitle(), questionData: JSON.stringify(questionData) });
    hint.textContent = '문제은행에 저장 요청을 보냈습니다 (problembank.html에서 확인하고 태그를 채워주세요).';
    hint.className = 'hint ok';
  } catch (e) {
    hint.textContent = '저장 실패: ' + e.message;
    hint.className = 'hint err';
  } finally {
    btn.disabled = false;
  }
});

// ---------- 5. 정답·해설 HTML ----------
document.getElementById('generateKeyBtn')?.addEventListener('click', async () => {
  const btn = document.getElementById('generateKeyBtn');
  const hint = document.getElementById('keyHint');
  btn.disabled = true;
  const origText = btn.textContent;
  try {
    btn.textContent = '생성 중...';
    const selected = [...document.querySelectorAll('.qChk:checked')].map(chk => chk.value);
    if (!selected.length) throw new Error('선택된 문제가 없습니다.');
    let quickRows = '';
    const explMap = {};
    for (const num of selected) {
      const marker = parsedEntry.markers.get(num);
      const answerXml = extractQuickAnswerXml(marker.blockXml);
      let answerHtml = answerXml ? await hwpFragmentRunsToHtml(answerXml, parsedEntry) : '<span class="eqFallback">(정답 인식 실패)</span>';
      // 원본 해설(hp:endNote)의 첫 줄이 그대로 "[정답] ①"처럼 라벨을 포함한
      // 채로 시작하는 경우가 대부분이라, 빠른정답표에는 그 라벨 없이 답만
      // 보이도록 맨 앞에서 한 번만 제거(문두에 있을 때만 지움 — 답 안에
      // 우연히 같은 글자가 있어도 건드리지 않음).
      answerHtml = answerHtml.replace(/^\s*\[정답\]\s*/, '');
      quickRows += `<div class="qkItem" data-num="${num}"><span class="qkNum">${num}</span>${answerHtml}</div>`;

      // 답을 누를 때마다 그리드 칸 하나하나가 커졌다 줄었다 하면 보기
      // 불편하다는 피드백 — 그리드는 그대로 두고, 그 아래 고정된 패널 하나만
      // 클릭한 번호에 맞춰 내용이 바뀌도록 변경(번호를 눌러도 그리드
      // 레이아웃 자체는 흔들리지 않음).
      const explXml = extractEndnoteFullBodyXml(marker.blockXml);
      const explHtml = explXml ? await hwpBodyXmlToHtml(explXml, parsedEntry) : '<p class="hint">(해설 인식 실패)</p>';
      explMap[num] = explHtml;
    }
    const title = currentTitle();
    const keyHtml = downloadKeyHtml(title, quickRows, explMap);
    // 학생이 로그인(index.html)해서 자기 클리닉 해설을 볼 수 있으려면 이
    // 완성된 정답·해설 HTML이 어딘가에 남아있어야 한다 — 문제은행 저장
    // API(action=upload, 키 불필요)에 채점표/원본 시험지와는 다른 마커로
    // 올려서 index.html이 미션명으로 찾아 열 수 있게 한다.
    // callPost는 no-cors라 업로드 성공 여부를 응답으로 알 수 없다(항상
    // "네트워크 요청은 나갔다"까지만 확인됨) — 실제로 "링크는 있는데
    // 해설을 찾을 수 없다"는 오류가 반복 재현돼서, 업로드 직후 바로
    // list→download까지 다시 시도해 실제로 열리는지 그 자리에서 검증하고
    // 결과를 선생님께 즉시 보여준다(조용히 무시하지 않음).
    let shareStatus = '';
    try {
      const bytes = new TextEncoder().encode(keyHtml).buffer;
      const sizeKB = Math.round(bytes.byteLength / 1024);
      await callPost({
        action: 'upload',
        filename: `${title} - 정답해설.txt`,
        data: arrayBufferToBase64(bytes),
        memo: `${CLINIC_KEY_MARKER} ${title}`,
        questionData: JSON.stringify({ mission: title }),
      });
      const verifyList = await callGet({ action: 'list' });
      const candidates = (verifyList.files || []).filter(f =>
        (f.memo || '') === `${CLINIC_KEY_MARKER} ${title}`);
      candidates.sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
      const newest = candidates[0];
      if (!newest) {
        shareStatus = ` / ⚠️ 공유 업로드 확인 실패(목록에 안 보임, ${sizeKB}KB) — 학생용 링크는 아직 안 됩니다.`;
      } else {
        const verifyDownload = await callGet({ action: 'download', id: newest.id });
        const gotData = verifyDownload.file && verifyDownload.file.data;
        if (!gotData) {
          shareStatus = ` / ⚠️ 공유는 됐지만 다시 불러오기 실패(${sizeKB}KB — 용량이 크면 이 문제은행 저장소가 못 버틸 수 있어요) — 학생용 링크가 안 열릴 수 있습니다.`;
        } else {
          shareStatus = ` / 공유 링크 확인 완료(${sizeKB}KB)`;
        }
      }
    } catch (e) {
      shareStatus = ` / ⚠️ 공유 업로드 실패: ${e.message}`;
    }
    hint.textContent = `완료 — ${selected.length}문제${shareStatus}`;
    hint.className = 'hint ok';
  } catch (e) {
    hint.textContent = '실패: ' + e.message;
    hint.className = 'hint err';
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
});

function downloadKeyHtml(title, quickRows, explMap) {
  // JSON 안에 우연히 "</script"가 들어있으면 스크립트 태그가 거기서 끊기니
  // (해설 원문에 나올 일은 거의 없지만) 방어적으로 이스케이프.
  const explMapJson = JSON.stringify(explMap).replace(/<\/script/gi, '<\\/script');
  const html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<title>${escapeHtml(title)} — 정답·해설</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900&family=Noto+Serif+KR:wght@400;700&family=Noto+Sans+KR:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"><\/script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"><\/script>
<script defer src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"><\/script>
<script defer src="https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js"><\/script>
<style>
:root{--ink:#1A1A1A;--gold:#A8853F;--gold-line:#E6DCC6;--cream:#D9F0E6;--mint-deep:#3E8F79;--mint-soft:rgba(127,200,180,.14);}
*{box-sizing:border-box}
body{font-family:'Noto Sans KR',sans-serif;max-width:900px;margin:30px auto;padding:0 4vw 60px;background:var(--cream);color:var(--ink);line-height:1.6}
h1{font-family:'Playfair Display','Noto Serif KR',serif;font-weight:900;font-size:22px;border-bottom:2px solid var(--ink);padding-bottom:6px}
h2{font-family:'Noto Serif KR',serif;font-weight:700;font-size:16px;color:var(--gold);margin-top:28px}
.qkGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(70px,1fr));gap:8px;margin:12px 0}
.qkItem{border:1px solid var(--gold-line);border-radius:4px;padding:6px 8px;background:#fff;font-size:13px;text-align:center;cursor:pointer;user-select:none}
.qkItem:hover{border-color:var(--mint-deep)}
.qkItem.active{border-color:var(--mint-deep);background:var(--mint-soft);box-shadow:inset 0 0 0 1px var(--mint-deep)}
.qkNum{display:block;font-weight:800;color:var(--gold);font-size:11px;margin-bottom:2px}
.explPanel{margin-top:14px;background:#fff;border:1px solid var(--gold-line);border-radius:6px;padding:16px;min-height:60px;font-size:13px;position:sticky;top:12px}
.explPanel .explNum{font-weight:800;color:var(--mint-deep);margin-bottom:8px;font-size:14px}
img{max-width:100%;height:auto}
table{border-collapse:collapse}
td{border:1px solid var(--gold-line);padding:2px 6px}
.exportBar{position:fixed;top:16px;right:16px;z-index:999;display:flex;gap:8px}
.exportBar button{background:var(--ink);color:var(--cream);border:none;padding:10px 18px;border-radius:6px;font-family:'Noto Sans KR',sans-serif;font-weight:700;font-size:13px;cursor:pointer;box-shadow:0 3px 12px rgba(0,0,0,.28)}
.exportBar button:hover:not(:disabled){background:var(--mint-deep)}
.exportBar button:disabled{opacity:.6;cursor:default}
@media print{body{background:#fff}.explPanel{position:static}.exportBar{display:none}}
</style></head><body>
<div class="exportBar">
  <button type="button" id="saveImgBtn">이미지로 저장</button>
  <button type="button" id="savePdfBtn">PDF로 저장</button>
</div>
<div id="keyCapture">
<h1>${escapeHtml(title)} — 정답·해설</h1>
<h2>빠른정답 <small style="font-family:'Noto Sans KR',sans-serif;font-weight:500;font-size:12px;color:rgba(26,26,26,.55)">— 번호를 클릭하면 아래에 그 문제의 해설이 나옵니다</small></h2>
<div class="qkGrid">${quickRows}</div>
<div class="explPanel" id="explPanel"><p class="hint" style="color:rgba(26,26,26,.5)">위에서 번호를 클릭하면 여기에 해설이 표시됩니다.</p></div>
</div>
<script>
const EXPL_MAP = ${explMapJson};
document.addEventListener('DOMContentLoaded', () => {
  renderMathInElement(document.body, { delimiters: [{ left: '\\\\(', right: '\\\\)', display: false }, { left: '\\\\[', right: '\\\\]', display: true }], throwOnError: false });
  const panel = document.getElementById('explPanel');
  document.querySelectorAll('.qkItem').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.qkItem.active').forEach(x => x.classList.remove('active'));
      item.classList.add('active');
      const num = item.dataset.num;
      panel.innerHTML = '<div class="explNum">' + num + '번 해설</div>' + (EXPL_MAP[num] || '<p class="hint">(해설 인식 실패)</p>');
      try { renderMathInElement(panel, { delimiters: [{ left: '\\\\(', right: '\\\\)', display: false }, { left: '\\\\[', right: '\\\\]', display: true }], throwOnError: false }); } catch (e) {}
    });
  });

  // 이 페이지는 표지/여러 A4 시트로 나뉜 다른 생성물과 달리 위에서
  // 아래로 쭉 이어지는 한 장짜리 콘텐츠라, html2canvas로 #keyCapture
  // 전체를 한 번에 찍은 뒤 PDF는 그 긴 캔버스를 A4 세로 비율 높이만큼씩
  // 잘라 여러 페이지에 나눠 붙인다(워크시트/채점표 내보내기와 같은
  // html2canvas+jsPDF 방식, 다만 페이지 단위가 아니라 높이 기준 슬라이싱).
  var keyCapture = document.getElementById('keyCapture');
  async function captureEl(el) {
    return await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
  }
  var exportFileBase = ${JSON.stringify(title.replace(/[\\\/:*?"<>|]/g, '_') + ' - 정답해설')};
  var saveImgBtn = document.getElementById('saveImgBtn');
  var savePdfBtn = document.getElementById('savePdfBtn');
  if (saveImgBtn) saveImgBtn.addEventListener('click', async function () {
    saveImgBtn.disabled = true;
    var orig = saveImgBtn.textContent;
    saveImgBtn.textContent = '캡처 중...';
    try {
      var canvas = await captureEl(keyCapture);
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
    savePdfBtn.textContent = '캡처 중...';
    try {
      var jsPDFCtor = (window.jspdf && window.jspdf.jsPDF);
      if (!jsPDFCtor) throw new Error('PDF 라이브러리를 불러오지 못했습니다');
      var canvas = await captureEl(keyCapture);
      var pageW = 210;
      var pxPerMm = canvas.width / pageW;
      var pagePxH = Math.floor(297 * pxPerMm);
      var totalPages = Math.max(1, Math.ceil(canvas.height / pagePxH));
      var pdf = null;
      for (var i = 0; i < totalPages; i++) {
        savePdfBtn.textContent = '캡처 중... (' + (i + 1) + '/' + totalPages + ')';
        var sliceH = Math.min(pagePxH, canvas.height - i * pagePxH);
        var pageCanvas = document.createElement('canvas');
        pageCanvas.width = canvas.width;
        pageCanvas.height = sliceH;
        var ctx = pageCanvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
        ctx.drawImage(canvas, 0, i * pagePxH, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
        var imgData = pageCanvas.toDataURL('image/jpeg', 0.95);
        var thisPageH = sliceH / pxPerMm;
        if (!pdf) {
          pdf = new jsPDFCtor({ orientation: 'portrait', unit: 'mm', format: [pageW, thisPageH] });
        } else {
          pdf.addPage([pageW, thisPageH], 'portrait');
        }
        pdf.addImage(imgData, 'JPEG', 0, 0, pageW, thisPageH, undefined, 'FAST');
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
  a.download = `${title} - 정답해설.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return html;
}

// ---------- 5.5 반/미션명을 직접 입력 대신 선택형으로 ----------
// "S+"를 "s+"로 잘못 치거나 미션명에 오타가 하나라도 있으면 채점 명단
// 조회(examroster)나 정답·해설 링크 매칭이 문자열을 정확히 맞춰야 해서
// 조용히 실패한다 — 실제로 이런 사례가 있었다. 텍스트 입력 대신
// 드롭다운으로 바꿔서 오타 자체가 나지 않게 한다. index.html처럼 별도
// 파일을 건드릴 필요 없이, 기존 <input id="gradeClass">/<input id="gradeMission">
// 을 여기서 통째로 <select>로 교체한다(id를 그대로 유지하므로 다른
// 곳에서 .value로 읽는 코드는 손댈 필요가 없다).
function replaceInputWithSelect(id) {
  const input = document.getElementById(id);
  if (!input || input.tagName === 'SELECT') return input;
  const select = document.createElement('select');
  select.id = id;
  select.className = input.className;
  const styleAttr = input.getAttribute('style');
  if (styleAttr) select.setAttribute('style', styleAttr);
  input.replaceWith(select);
  return select;
}
const gradeClassSelect = replaceInputWithSelect('gradeClass');
const gradeMissionSelect = replaceInputWithSelect('gradeMission');

const COHORT_CLASS_OPTIONS = { '2': ['S+', 'S'], '3': ['PRISM'] };
function populateClassSelect() {
  if (!gradeClassSelect) return;
  const cohort = document.getElementById('gradeCohort').value;
  const prev = gradeClassSelect.value;
  const opts = COHORT_CLASS_OPTIONS[cohort] || COHORT_CLASS_OPTIONS['2'];
  gradeClassSelect.innerHTML = opts.map(c => `<option value="${c}">${c}</option>`).join('');
  gradeClassSelect.value = opts.includes(prev) ? prev : opts[0];
}
document.getElementById('gradeCohort')?.addEventListener('change', populateClassSelect);
populateClassSelect();

// 미션명 드롭다운은 "저장된 클리닉 자료" 목록(실제로 저장된 적 있는
// 제목들)으로 채운다 — renderSavedList가 그 목록을 불러올 때마다 같이
// 갱신된다(savedFiles 인자로 재사용, 별도 조회 없음). 지금 화면에 떠
// 있는 제목(currentTitle())이 아직 한 번도 저장 안 된 새 교재여도 선택
// 가능하도록 항상 목록 맨 앞에 끼워 넣는다.
function populateMissionSelect(savedFiles) {
  if (!gradeMissionSelect) return;
  const current = currentTitle();
  const titles = [...new Set((savedFiles || []).map(f => f.memo).filter(Boolean))];
  if (!titles.includes(current)) titles.unshift(current);
  titles.sort((a, b) => b.localeCompare(a));
  const wasAuto = gradeMissionSelect.dataset.auto !== 'false';
  const prev = gradeMissionSelect.value;
  gradeMissionSelect.innerHTML = titles.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
  gradeMissionSelect.value = wasAuto ? current : (titles.includes(prev) ? prev : current);
  gradeMissionSelect.dataset.auto = wasAuto ? 'true' : 'false';
}
// <select>는 존재하지 않는 옵션 값을 그냥 무시해버리므로(<input>과 달리
// 실패가 조용히 일어남), 값을 세팅하기 전에 그 옵션이 없으면 먼저
// 만들어 끼워 넣는다.
function setGradeMissionValue(title) {
  if (!gradeMissionSelect) { const el = document.getElementById('gradeMission'); if (el) el.value = title; return; }
  if (![...gradeMissionSelect.options].some(o => o.value === title)) {
    const opt = document.createElement('option');
    opt.value = title;
    opt.textContent = title;
    gradeMissionSelect.insertBefore(opt, gradeMissionSelect.firstChild);
  }
  gradeMissionSelect.value = title;
}
gradeMissionSelect?.addEventListener('change', () => { gradeMissionSelect.dataset.auto = 'false'; });

// ---------- 6. 채점 ----------
const GRADE_SYMS = { 0: '-', 1: 'O', 2: 'X', 3: '△' };
let gradeStudents = []; // [{name,class,cohort}]
let gradeItems = {}; // name -> {num: 0|1|2|3}

// 공통문항/개별오답(학생마다 다른 문제)을 섞은 클리닉을 채점할 때, 채점표
// 어디부터가 개별 구간인지 한눈에 보이게 하는 경계값 — index.html처럼
// 별도 파일을 안 건드리고 여기서 컨트롤을 직접 만들어 끼워 넣는다(기존
// select 변환과 같은 방식). 문항 번호 자체는 실제 내용이 학생마다
// 달라도 항상 1..N으로 채점하므로, 이 경계는 순수히 화면 표시용 —
// 채점/저장 로직에는 아무 영향 없음.
const commonBoundaryWrap = document.createElement('label');
commonBoundaryWrap.className = 'hint';
commonBoundaryWrap.style.marginLeft = '8px';
commonBoundaryWrap.innerHTML = '공통문항 경계(이 번호까지 공통, 다음 번호부터 개별오답) <input type="number" id="commonBoundaryInput" value="40" min="0" style="width:56px">';
document.getElementById('gradeToolsRow')?.prepend(commonBoundaryWrap);
document.getElementById('commonBoundaryInput')?.addEventListener('input', () => renderGradeGrid());

// "명단 불러오기"는 누를 때마다 기존 gradeStudents/gradeItems에 없는
// 학생만 추가한다(이름 기준 중복 방지) — S반/S+반처럼 같은 클리닉을 같이
// 푼 여러 반을 순서대로 불러와 한 표에서 채점할 수 있게 하기 위함. 각
// 학생에게 "이 학생을 어느 반으로 불러왔는지"를 class로 태그해 저장 —
// saveexamscores는 반(class) 하나당 한 번씩 호출해야 하는 API라서, 나중에
// 저장할 때 이 태그로 그룹을 다시 나눈다.
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
    let added = 0, skipped = 0;
    for (const s of data.students) {
      if (gradeStudents.some(g => g.name === s.name)) { skipped++; continue; }
      gradeStudents.push({ name: s.name, class: className, cohort });
      gradeItems[s.name] = {};
      (s.items || []).forEach((v, i) => { if (v >= 1 && v <= 3) gradeItems[s.name][i + 1] = v; });
      added++;
    }
    // 이전에 저장할 때 배점을 균등에서 직접 수정했었다면, 그 배점도 O/X
    // 기록과 함께 그대로 복원한다 — 없으면(처음 채점이라 저장 이력이 없으면)
    // renderGradeGrid가 기본 균등 배점을 채운다.
    if (Array.isArray(data.weights) && data.weights.length) {
      const selected = [...document.querySelectorAll('.qChk:checked')].map(chk => chk.value);
      gradeWeights = {};
      selected.forEach(num => { gradeWeights[num] = data.weights[Number(num) - 1] || 0; });
      gradeWeightsKey = selected.join(',');
    }
    renderGradeGrid();
    hint.textContent = `${added}명 추가됨${skipped ? ` (이미 불러온 ${skipped}명 제외)` : ''} — 전체 ${gradeStudents.length}명`;
    hint.className = 'hint ok';
    document.getElementById('gradeToolsRow').style.display = gradeStudents.length ? '' : 'none';
    document.getElementById('saveScoresBtn').style.display = gradeStudents.length ? '' : 'none';
  } catch (e) {
    hint.textContent = '실패: ' + e.message;
    hint.className = 'hint err';
  }
});

document.getElementById('resetRosterBtn')?.addEventListener('click', () => {
  gradeStudents = [];
  gradeItems = {};
  renderGradeGrid();
  const hint = document.getElementById('gradeHint');
  hint.textContent = '명단을 초기화했습니다.';
  hint.className = 'hint';
  document.getElementById('gradeToolsRow').style.display = 'none';
  document.getElementById('saveScoresBtn').style.display = 'none';
});

document.getElementById('markAllCorrectBtn')?.addEventListener('click', () => {
  if (!gradeStudents.length) return;
  if (!confirm('현재 표에 보이는 모든 칸을 정답(O)으로 표시합니다. 계속할까요?')) return;
  const selected = [...document.querySelectorAll('.qChk:checked')].map(chk => chk.value);
  for (const s of gradeStudents) {
    for (const num of selected) gradeItems[s.name][num] = 1;
  }
  renderGradeGrid();
});

// 모든 채점은 100점 만점을 기준으로 한다 — 문항 수가 몇 개든(60문항이든
// 몇 문항이든) 기본은 100점을 문항 수만큼 균등하게 나눈 배점이지만,
// 선생님이 문항별로 직접 수정할 수 있다("배점" 행의 입력칸). gradeWeights는
// 선택된 문제 구성이 바뀌지 않는 한(gradeWeightsKey로 판별) 그대로
// 유지되므로, 채점 도중 다시 그려져도 입력해둔 배점이 날아가지 않는다.
let gradeWeights = {}; // num(문자열) -> 배점
let gradeWeightsKey = '';
function ensureEvenWeights(selected) {
  const key = selected.join(',');
  if (key === gradeWeightsKey) return;
  gradeWeights = {};
  const base = Math.round((100 / selected.length) * 100) / 100;
  let allocated = 0;
  selected.forEach((num, i) => {
    const isLast = i === selected.length - 1;
    const w = isLast ? Math.round((100 - allocated) * 100) / 100 : base;
    gradeWeights[num] = w;
    allocated += w;
  });
  gradeWeightsKey = key;
}

function renderGradeGrid() {
  const selected = [...document.querySelectorAll('.qChk:checked')].map(chk => chk.value);
  const area = document.getElementById('gradeArea');
  if (!gradeStudents.length) { area.innerHTML = '<p class="hint">불러온 학생이 없습니다.</p>'; return; }
  ensureEvenWeights(selected);
  // 공통문항/개별오답(학생마다 실제 문제는 다르지만 번호 슬롯은 1..N으로
  // 동일하게 채점하는) 클리닉을 위한 표시용 경계선 — commonBoundary까지는
  // "공통", 그 다음 번호부터는 "개별"로 표에 구분해 보여준다. 저장되는
  // 데이터(문항 번호별 O/X)에는 아무 영향 없이 순수 화면 표시만 다르다.
  const commonBoundary = Number(document.getElementById('commonBoundaryInput')?.value) || 0;
  const commonCount = selected.filter(n => Number(n) <= commonBoundary).length;
  const indivCount = selected.length - commonCount;
  function colStyle(num) {
    const n = Number(num);
    if (commonBoundary <= 0 || commonBoundary >= selected.length) return '';
    if (n === commonBoundary + 1) return ' style="border-left:3px solid var(--mint-deep)"';
    if (n > commonBoundary) return ' style="background:rgba(127,200,180,.10)"';
    return '';
  }
  let html = '<div style="overflow-x:auto"><table class="gradeTbl">';
  if (commonCount && indivCount) {
    html += `<tr><th colspan="2"></th><th colspan="${commonCount}" style="background:var(--gold-soft)">공통문항 (~${commonBoundary}번)</th><th colspan="${indivCount}" style="background:rgba(127,200,180,.18);border-left:3px solid var(--mint-deep)">개별오답 (${commonBoundary + 1}번~)</th><th></th></tr>`;
  }
  html += '<tr><th>이름</th><th>반</th>';
  for (const num of selected) html += `<th${colStyle(num)}>${num}</th>`;
  html += '<th>점수</th></tr>';
  html += '<tr class="weightRow"><th colspan="2">배점(100점 기준)</th>';
  for (const num of selected) html += `<th${colStyle(num)}><input type="number" class="weightInput" data-num="${num}" value="${gradeWeights[num]}" step="0.1" min="0"></th>`;
  html += `<th id="weightTotalCell">${weightSum().toFixed(1)}</th></tr>`;
  for (const s of gradeStudents) {
    html += `<tr data-name="${escapeHtml(s.name)}"><td class="nameCell">${escapeHtml(s.name)}</td><td class="classCell">${escapeHtml(s.class || '')}</td>`;
    for (const num of selected) {
      const v = gradeItems[s.name][num] || 0;
      html += `<td class="gradeCell" data-num="${num}" data-v="${v}"${colStyle(num)}>${GRADE_SYMS[v]}</td>`;
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
      const next = (cur + 1) % 4;
      if (next === 0) delete gradeItems[name][num]; else gradeItems[name][num] = next;
      cell.dataset.v = next;
      cell.textContent = GRADE_SYMS[next];
      updateScoreCell(cell.closest('tr'), name, selected.length);
    });
  });
  area.querySelectorAll('.weightInput').forEach(input => {
    input.addEventListener('input', () => {
      gradeWeights[input.dataset.num] = Number(input.value) || 0;
      const totalCell = document.getElementById('weightTotalCell');
      if (totalCell) totalCell.textContent = weightSum().toFixed(1);
      gradeStudents.forEach(s => updateScoreCell(area.querySelector(`tr[data-name="${CSS.escape(s.name)}"]`), s.name, selected.length));
    });
  });
  gradeStudents.forEach(s => updateScoreCell(area.querySelector(`tr[data-name="${CSS.escape(s.name)}"]`), s.name, selected.length));
}
function weightSum() {
  return Object.values(gradeWeights).reduce((a, b) => a + b, 0);
}
function updateScoreCell(tr, name, total) {
  if (!tr) return;
  const items = gradeItems[name] || {};
  let score = 0, correct = 0;
  const answered = Object.keys(items).length;
  for (const [num, v] of Object.entries(items)) {
    if (v === 1) { correct++; score += gradeWeights[num] || 0; }
  }
  score = Math.round(score * 10) / 10;
  tr.querySelector('[data-role="score"]').textContent = answered ? `${score}점 (${correct}/${total})` : '-';
}

// 명단이 여러 반(class)에서 누적됐을 수 있으므로, saveexamscores를 반별로
// 그룹을 나눠서 그만큼 호출한다(그 API 자체가 한 번에 반 하나만 받음).
document.getElementById('saveScoresBtn').addEventListener('click', async () => {
  const btn = document.getElementById('saveScoresBtn');
  const hint = document.getElementById('saveHint');
  const selected = [...document.querySelectorAll('.qChk:checked')].map(chk => Number(chk.value));
  const cohort = document.getElementById('gradeCohort').value;
  const category = document.getElementById('gradeCategory').value.trim();
  const mission = document.getElementById('gradeMission').value.trim();
  const maxNum = Math.max(...selected);
  // 채점표의 "배점" 행에서 직접 입력/수정한 값을 그대로 사용 — 기본은
  // 100점을 균등 배분한 값이지만 선생님이 바꿨으면 그 값을 보낸다.
  const weights = [];
  for (let n = 1; n <= maxNum; n++) weights.push(gradeWeights[String(n)] || 0);
  const byClass = new Map();
  for (const s of gradeStudents) {
    const items = [];
    for (let n = 1; n <= maxNum; n++) items.push(gradeItems[s.name][n] || null);
    const cls = s.class || document.getElementById('gradeClass').value.trim();
    if (!byClass.has(cls)) byClass.set(cls, []);
    byClass.get(cls).push({ name: s.name, items, comment: '' });
  }
  btn.disabled = true;
  hint.textContent = '저장 중...';
  hint.className = 'hint';
  try {
    for (const [cls, entries] of byClass) {
      await callPost({ action: 'saveexamscores', key: TEACHER_KEY, cohort, category, class: cls, mission, entries, weights });
    }
    hint.textContent = `저장 요청을 보냈습니다 (${[...byClass.keys()].join(', ')}반, 총 ${gradeStudents.length}명). POST 응답은 확인할 수 없으니, 잠시 후 다시 불러와 확인해보세요.`;
    hint.className = 'hint ok';
  } catch (e) {
    hint.textContent = '실패: ' + e.message;
    hint.className = 'hint err';
  } finally {
    btn.disabled = false;
  }
});

// ---------- 7. 채점 리포트(완수율/단원별 성취도/예상 9모등급) ----------
// 공통수학1 범위 한정 — 문제 텍스트에 등장하는 단원 고유 용어로 1차 자동
// 분류(키워드 매칭)한다. hwpx 파일 자체엔 단원 정보가 전혀 없어서 선생님이
// 매 문제 입력하는 대신 이 방식을 택함 — 완벽하지 않은 휴리스틱이다.
// 키워드를 최대한 넓게 잡아뒀지만(v2), 그래도 하나도 안 걸리는 문항은
// "미분류"로 남기지 않고(요청에 따라) 공통수학1에서 가장 범위가 넓은
// "여러 가지 방정식과 부등식"으로 잠정 배정한다 — 완벽한 분류는 아니니,
// 이상하게 배정된 문항이 보이면 알려주면 규칙을 더 다듬을 수 있다.
const UNIT_RULES = [
  { unit: '행렬과 그 연산', keywords: ['행렬', '정사각행렬', '단위행렬', '역행렬', '성분', '행과 열'] },
  { unit: '순열과 조합', keywords: ['순열', '조합', '나열하는', '줄을 세우는', '일렬로'] },
  { unit: '경우의 수', keywords: ['경우의 수', '합의 법칙', '곱의 법칙', '나누어 넣는', '분배하는', '등산로', '색을 칠하는', '최단 거리', '격자점', '뽑는 경우', '함수의 개수'] },
  { unit: '복소수와 이차방정식', keywords: ['복소수', '허근', '허수', '켤레복소수', '판별식', '중근', '허수단위'] },
  { unit: '이차방정식과 이차함수', keywords: ['이차함수', '포물선', '꼭짓점', 'x축과 만나는', '그래프가 x축', '이차식의 그래프', '최댓값과 최솟값'] },
  { unit: '여러 가지 방정식과 부등식', keywords: ['삼차방정식', '사차방정식', '연립방정식', '연립부등식', '부등식', '방정식', '절댓값', '해의 개수', '근의 개수', '자연수인 해'] },
  { unit: '나머지정리와 인수분해', keywords: ['인수분해', '인수정리', '나머지정리', '항등식', '몫과 나머지'] },
  { unit: '다항식의 연산', keywords: ['다항식', '조립제법', '곱셈 공식', '전개식', '차수', '동류항', '다항식의 나눗셈'] },
];
function classifyUnit(rawText) {
  for (const { unit, keywords } of UNIT_RULES) {
    if (keywords.some(k => rawText.includes(k))) return unit;
  }
  return '여러 가지 방정식과 부등식';
}

// 선생님이 정해준 원점수(정답률 %) → 등급 컷. 3등급 컷을 60%→70%로
// 올리고, 정답률만으로는 3등급이어도 완수율(끝까지 푼 비율)이 80%
// 이하면 4등급으로 낮춘다 — 예상등급이 너무 후하게 나온다는 피드백 반영
// (못 푼 문제가 20% 넘게 있으면 실전에서는 더 낮게 나올 가능성이 크다고
// 보는 것).
function estimateGrade(pct, completionRate) {
  if (pct >= 86) return 1;
  if (pct >= 75) return 2;
  if (pct >= 70) return (completionRate != null && completionRate <= 80) ? 4 : 3;
  if (pct >= 45) return 4;
  return 5;
}

function computeStudentStats(student, selectedNums, unitMap) {
  const total = selectedNums.length;
  let answered = 0, correct = 0;
  const unitStats = {};
  const items = gradeItems[student.name] || {};
  for (const num of selectedNums) {
    const v = items[num] || 0;
    const unit = unitMap[num];
    if (!unitStats[unit]) unitStats[unit] = { correct: 0, total: 0 };
    unitStats[unit].total++;
    if (v !== 0) answered++;
    if (v === 1) { correct++; unitStats[unit].correct++; }
  }
  const completionRate = total ? Math.round((answered / total) * 1000) / 10 : 0;
  const accuracyRate = total ? Math.round((correct / total) * 1000) / 10 : 0;
  return { name: student.name, class: student.class, total, answered, correct, completionRate, accuracyRate, grade: estimateGrade(accuracyRate, completionRate), unitStats };
}

function computeClassUnitAverage(stats) {
  const agg = {};
  for (const st of stats) {
    for (const [unit, u] of Object.entries(st.unitStats)) {
      if (!agg[unit]) agg[unit] = { correct: 0, total: 0 };
      agg[unit].correct += u.correct;
      agg[unit].total += u.total;
    }
  }
  return agg;
}

// 학부모님이 보는 안내문이라 존댓말(합니다체)로, 감상평이 아니라 수치
// 근거를 댄 분석형 문장으로 구성한다. LLM 호출 없이(정적 HTML 도구라 서버
// API가 따로 없음) 등급/단원 성취도 기반 템플릿으로 1차 생성 — 선생님이
// 다운로드 전에 직접 검토·수정할 수 있게 UI에서 편집 가능하게 둔다(아래
// genReportBtn 핸들러의 편집 단계 참고).
const MATHY_GRADE_MSG = {
  1: '현재 페이스를 유지한다면 9월 모의고사에서도 좋은 결과가 기대되는 상태입니다.',
  2: '전반적으로 안정적인 성취를 보이고 있으며, 취약 단원만 보완되면 1등급 진입도 충분히 가능한 수준입니다.',
  3: '기본 개념은 갖추어져 있으나, 특정 단원에서의 반복적인 실수가 등급 상승의 걸림돌이 되고 있는 것으로 분석됩니다.',
  4: '기초 개념은 형성되어 있으나 문제 적용 단계에서 아직 흔들리는 모습이 관찰됩니다. 취약 단원 위주의 보충 학습이 필요합니다.',
  5: '기초 개념 이해부터 다시 점검이 필요한 단계로 판단됩니다. 단원별로 차근차근 다져가는 학습이 우선되어야 합니다.',
};
function buildMathyYuriComment(s) {
  const entries = Object.entries(s.unitStats)
    .filter(([u, d]) => u !== '미분류' && d.total > 0)
    .map(([u, d]) => ({ unit: u, pct: Math.round((d.correct / d.total) * 1000) / 10, total: d.total }))
    .sort((a, b) => b.pct - a.pct);
  const strong = entries[0];
  const weak = entries[entries.length - 1];
  const parts = [];
  parts.push(`안녕하세요, ${s.name} 학생 학부모님. 이번 클리닉 교재(총 ${s.total}문항) 채점 결과를 분석하여 안내드립니다.`);
  parts.push(`완수율 ${s.completionRate}%, 정답률 ${s.accuracyRate}%로, 이를 기준으로 환산한 예상 9월 모의고사 등급은 ${s.grade}등급입니다.`);
  parts.push(MATHY_GRADE_MSG[s.grade]);
  if (strong && weak && strong !== weak) {
    parts.push(`단원별로 살펴보면 「${strong.unit}」에서 정답률 ${strong.pct}%로 가장 안정적인 성취를 보였고, 「${weak.unit}」은(는) 정답률 ${weak.pct}%로 상대적으로 보완이 더 필요한 단원으로 확인됩니다.`);
    parts.push(`9월 모의고사 대비 기간 동안 「${weak.unit}」을(를) 중심으로 복습을 지도하겠습니다.`);
  } else if (strong) {
    parts.push(`단원 전반에 걸쳐 고르게 ${strong.pct}% 안팎의 정답률을 보이고 있습니다.`);
  }
  parts.push('앞으로도 아이의 학습 상태를 세심하게 살피며 지도하겠습니다. 감사합니다. — Mathy Yuri 드림');
  return parts.join(' ');
}

// 리포트는 바로 다운로드하지 않고, 먼저 학생별 자동 코멘트를 만들어 화면에
// 보여준다 — 학부모님께 그대로 나가는 글이라 선생님이 검토·수정할 기회가
// 필요해서(요청: "코멘트는 내가 수정 가능하도록 해주고"). "리포트 HTML
// 다운로드" 버튼을 눌러야 그 시점의 (수정됐을 수도 있는) 텍스트로 최종
// 생성된다.
let lastReportStats = null, lastReportUnitMap = null, lastReportQTotal = 0;

document.getElementById('genReportBtn')?.addEventListener('click', async () => {
  const btn = document.getElementById('genReportBtn');
  const hint = document.getElementById('reportHint');
  if (!gradeStudents.length) { hint.textContent = '채점할 학생이 없습니다. 먼저 명단을 불러오세요.'; hint.className = 'hint err'; return; }
  btn.disabled = true;
  const origText = btn.textContent;
  try {
    btn.textContent = '분석 중...';
    const selected = [...document.querySelectorAll('.qChk:checked')].map(chk => chk.value);
    if (!selected.length) throw new Error('선택된 문제가 없습니다.');
    const unitMap = {};
    for (const num of selected) {
      const marker = parsedEntry.markers.get(num);
      const noComments = stripCtrlBlocks(marker.blockXml).replace(/<hp:shapeComment>[\s\S]*?<\/hp:shapeComment>/g, '');
      const raw = decodeXmlEntities(stripTags(stripRectBlocksForRaw(noComments)));
      unitMap[num] = classifyUnit(raw);
    }
    const stats = gradeStudents.map(s => computeStudentStats(s, selected, unitMap));
    lastReportStats = stats;
    lastReportUnitMap = unitMap;
    lastReportQTotal = selected.length;
    renderCommentEditor(stats);
    document.getElementById('reportCommentBox').style.display = '';
    hint.textContent = `분석 완료 — 학생 ${stats.length}명. 아래에서 코멘트를 확인/수정한 뒤 다운로드하세요.`;
    hint.className = 'hint ok';
  } catch (e) {
    hint.textContent = '실패: ' + e.message;
    hint.className = 'hint err';
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
});

function renderCommentEditor(stats) {
  const area = document.getElementById('reportCommentArea');
  area.innerHTML = stats.map(s => `
    <div class="commentItem">
      <label>${escapeHtml(s.name)}${s.class ? ` (${escapeHtml(s.class)})` : ''} — ${s.grade}등급, 정답률 ${s.accuracyRate}%</label>
      <textarea data-name="${escapeHtml(s.name)}">${escapeHtml(buildMathyYuriComment(s))}</textarea>
    </div>`).join('');
}

document.getElementById('downloadReportBtn')?.addEventListener('click', () => {
  if (!lastReportStats) return;
  const comments = {};
  document.querySelectorAll('#reportCommentArea textarea').forEach(ta => { comments[ta.dataset.name] = ta.value; });
  downloadGradeReportHtml(currentTitle(), lastReportStats, lastReportUnitMap, lastReportQTotal, comments);
});

function downloadGradeReportHtml(title, stats, unitMap, qTotal, comments) {
  const unitList = [...new Set(Object.values(unitMap))];
  const classUnitAvg = computeClassUnitAverage(stats);
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  stats.forEach(s => dist[s.grade]++);
  const classAvgAcc = stats.length ? Math.round(stats.reduce((s, x) => s + x.accuracyRate, 0) / stats.length * 10) / 10 : 0;
  const classAvgComp = stats.length ? Math.round(stats.reduce((s, x) => s + x.completionRate, 0) / stats.length * 10) / 10 : 0;

  const rankRows = [...stats].sort((a, b) => b.accuracyRate - a.accuracyRate)
    .map((s, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.class || '')}</td><td>${s.correct}/${s.total}</td><td>${s.accuracyRate}%</td><td>${s.grade}등급</td></tr>`).join('');

  // 단원별 성취도를 표(정확한 수치)뿐 아니라 막대그래프로도 보여주기
  // 위한 데이터 — 표는 그대로 두고 그 위에 그래프를 추가한다(숫자만
  // 나열된 표보다 한눈에 들어온다는 피드백). 학생당 하나, 관리자 요약에
  // 하나(반 평균), 각각 캔버스 id로 구분해 그린다.
  const adminUnitChartData = {
    labels: unitList,
    data: unitList.map(u => { const a = classUnitAvg[u] || { correct: 0, total: 0 }; return a.total ? Math.round(a.correct / a.total * 1000) / 10 : null; }),
  };
  const studentUnitChartData = stats.map(s => ({
    labels: unitList,
    data: unitList.map(u => { const us = s.unitStats[u] || { correct: 0, total: 0 }; return us.total ? Math.round(us.correct / us.total * 1000) / 10 : null; }),
  }));

  const unitAvgRows = unitList.map(u => {
    const a = classUnitAvg[u] || { correct: 0, total: 0 };
    const pct = a.total ? Math.round((a.correct / a.total) * 1000) / 10 : 0;
    return `<tr><td>${escapeHtml(u)}</td><td>${a.correct}/${a.total}</td><td>${pct}%</td></tr>`;
  }).join('');

  const adminPage = `
    <section class="rpSheet">
      <h1>${escapeHtml(title)} — 채점 관리자 리포트</h1>
      <div class="rpSummaryGrid">
        <div class="rpStat"><div class="rpStatLabel">응시 인원</div><div class="rpStatVal">${stats.length}명</div></div>
        <div class="rpStat"><div class="rpStatLabel">문항 수</div><div class="rpStatVal">${qTotal}문항</div></div>
        <div class="rpStat"><div class="rpStatLabel">반 평균 완수율</div><div class="rpStatVal">${classAvgComp}%</div></div>
        <div class="rpStat"><div class="rpStatLabel">반 평균 정답률</div><div class="rpStatVal">${classAvgAcc}%</div></div>
      </div>
      <h2>예상 9모등급 분포</h2>
      <div class="rpDistRow">${[1, 2, 3, 4, 5].map(g => `<div class="rpDistItem"><div class="rpDistGrade">${g}등급</div><div class="rpDistCount">${dist[g]}명</div></div>`).join('')}</div>
      <h2>단원별 반 평균 성취도 (공통수학1, 자동분류 1차 결과 — 확인 필요)</h2>
      <div class="rpChartWrap"><canvas id="chart-admin-unit"></canvas></div>
      <table class="rpTbl"><tr><th>단원</th><th>맞은 문항</th><th>정답률</th></tr>${unitAvgRows}</table>
      <h2>학생별 순위</h2>
      <table class="rpTbl"><tr><th>순위</th><th>이름</th><th>반</th><th>맞은 개수</th><th>정답률</th><th>예상 등급</th></tr>${rankRows}</table>
    </section>`;

  const studentPages = stats.map((s, si) => {
    const rows = unitList.map(u => {
      const us = s.unitStats[u] || { correct: 0, total: 0 };
      const pct = us.total ? Math.round((us.correct / us.total) * 1000) / 10 : 0;
      return `<tr><td>${escapeHtml(u)}</td><td>${us.correct}/${us.total}</td><td>${pct}%</td></tr>`;
    }).join('');
    return `
    <section class="rpSheet rpStudent" data-student="${escapeHtml(s.name)}">
      <div class="rpTitleTag">${escapeHtml(title)}</div>
      <h1>${escapeHtml(s.name)}<small>${escapeHtml(s.class || '')}</small></h1>
      <div class="rpSummaryGrid">
        <div class="rpStat"><div class="rpStatLabel">완수율</div><div class="rpStatVal">${s.completionRate}%</div></div>
        <div class="rpStat"><div class="rpStatLabel">정답률</div><div class="rpStatVal">${s.accuracyRate}%</div></div>
        <div class="rpStat"><div class="rpStatLabel">맞은 개수</div><div class="rpStatVal">${s.correct}/${s.total}</div></div>
        <div class="rpStat rpGradeHighlight"><div class="rpStatLabel">예상 9모등급</div><div class="rpStatVal">${s.grade}등급</div></div>
      </div>
      <div class="rpComment"><div class="rpCommentTag">Mathy Yuri's Comment</div><p>${escapeHtml((comments && comments[s.name]) || buildMathyYuriComment(s))}</p></div>
      <h2>단원별 성취도</h2>
      <div class="rpChartWrap"><canvas id="chart-unit-${si}"></canvas></div>
      <table class="rpTbl"><tr><th>단원</th><th>맞은 문항</th><th>정답률</th></tr>${rows}</table>
      <div class="rpStudentTools noPrint">
        <button type="button" class="rpBtnSm" data-act="img">이 학생만 이미지로 저장</button>
        <button type="button" class="rpBtnSm" data-act="html">이 학생만 HTML로 저장</button>
      </div>
    </section>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<title>${escapeHtml(title)} — 채점 리포트</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900&family=Noto+Serif+KR:wght@400;700&family=Noto+Sans+KR:wght@400;500;700&display=swap" rel="stylesheet">
<script defer src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"><\/script>
<script defer src="https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js"><\/script>
<script defer src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"><\/script>
<style>
:root{--ink:#1A1A1A;--gold:#A8853F;--gold-line:#E6DCC6;--cream:#D9F0E6;--mint-deep:#3E8F79;--pink-deep:#C64E71;}
*{box-sizing:border-box}
body{font-family:'Noto Sans KR',sans-serif;background:#c8ded4;margin:0;padding:20px 0 60px;color:var(--ink)}
.rpSheet{position:relative;max-width:760px;margin:0 auto 20px;background:var(--cream);border-radius:6px;box-shadow:0 2px 14px rgba(0,0,0,.15);padding:26px 30px}
.rpSheet h1{font-family:'Playfair Display','Noto Serif KR',serif;font-weight:900;font-size:20px;border-bottom:2px solid var(--ink);padding-bottom:8px;margin:0 0 14px}
.rpSheet h1 small{display:block;font-family:'Noto Sans KR',sans-serif;font-weight:500;font-size:12px;color:rgba(26,26,26,.55);margin-top:2px}
.rpSheet h2{font-family:'Noto Serif KR',serif;font-weight:700;font-size:14px;color:var(--gold);margin:22px 0 8px}
.rpSummaryGrid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.rpStat{background:#fff;border:1px solid var(--gold-line);border-radius:5px;padding:10px;text-align:center}
.rpStatLabel{font-size:11px;color:rgba(26,26,26,.55)}
.rpStatVal{font-family:'Noto Serif KR',serif;font-weight:800;font-size:18px;margin-top:3px}
.rpGradeHighlight{background:var(--mint-deep);border-color:var(--mint-deep)}
.rpGradeHighlight .rpStatLabel{color:rgba(255,255,255,.8)}
.rpGradeHighlight .rpStatVal{color:#fff}
.rpDistRow{display:flex;gap:8px}
.rpDistItem{flex:1;background:#fff;border:1px solid var(--gold-line);border-radius:5px;padding:8px;text-align:center}
.rpDistGrade{font-size:11px;color:rgba(26,26,26,.55)}
.rpDistCount{font-weight:800;font-size:15px}
.rpChartWrap{height:190px;margin-top:6px}
table.rpTbl{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:4px}
table.rpTbl th,table.rpTbl td{border:1px solid var(--gold-line);padding:5px 8px;text-align:center}
table.rpTbl th{background:rgba(168,133,63,.14);color:var(--gold);font-weight:700}
.rpComment{margin-top:18px;background:#fff;border:1px solid var(--gold-line);border-left:4px solid var(--mint-deep);border-radius:5px;padding:12px 16px}
.rpCommentTag{font-family:'Playfair Display','Noto Serif KR',serif;font-weight:700;font-style:italic;font-size:12px;color:var(--mint-deep);margin-bottom:5px}
.rpTitleTag{font-size:11px;letter-spacing:.06em;color:var(--gold);font-weight:700;margin-bottom:4px}
.rpComment p{margin:0;font-size:13px;line-height:1.7}
.rpStudentTools{margin-top:16px;display:flex;gap:8px}
.rpBtnSm{font-family:'Noto Sans KR',sans-serif;font-size:12px;font-weight:700;padding:7px 12px;border-radius:5px;border:1px solid var(--gold-line);background:#fff;color:var(--ink);cursor:pointer}
.rpBtnSm:hover:not(:disabled){background:rgba(168,133,63,.12)}
.rpBtnSm:disabled{opacity:.5;cursor:default}
.exportBar{position:fixed;top:16px;right:16px;z-index:999;display:flex;gap:8px}
.exportBar button{background:var(--ink);color:var(--cream);border:none;padding:10px 16px;border-radius:6px;font-family:'Noto Sans KR',sans-serif;font-weight:700;font-size:12.5px;cursor:pointer;box-shadow:0 3px 12px rgba(0,0,0,.28)}
.exportBar button:hover:not(:disabled){background:var(--mint-deep)}
.exportBar button:disabled{opacity:.6;cursor:default}
@media print{body{background:#fff}.rpSheet{box-shadow:none;page-break-after:always}.noPrint,.exportBar{display:none}}
</style></head><body>
<div class="exportBar noPrint">
  <button type="button" id="rpSaveImgBtn">전체 이미지로 저장</button>
  <button type="button" id="rpSavePdfBtn">전체 PDF로 저장</button>
</div>
${adminPage}
${studentPages}
<script>
document.addEventListener('DOMContentLoaded', function () {
  var sheets = [...document.querySelectorAll('.rpSheet')];
  async function captureEl(el) {
    return await html2canvas(el, {
      scale: 2, backgroundColor: '#ffffff', useCORS: true,
      ignoreElements: (node) => node.classList && node.classList.contains('noPrint'),
    });
  }
  var fileBase = ${JSON.stringify(title.replace(/[\\\/:*?"<>|]/g, '_'))};

  // 숫자만 나열된 표보다 한눈에 들어오게, 단원별 정답률을 막대그래프로도
  // 그린다 — html2canvas는 <canvas>를 그대로 픽셀 복사해오므로 이미지/PDF
  // 저장에도 그래프가 그대로 찍힌다.
  var adminUnitChartData = ${JSON.stringify(adminUnitChartData)};
  var studentUnitChartData = ${JSON.stringify(studentUnitChartData)};
  function barColor(v) { return v == null ? '#ddd' : v < 50 ? '#C64E71' : v < 75 ? '#A8853F' : '#3E8F79'; }
  function drawUnitChart(canvasId, chartData) {
    var el = document.getElementById(canvasId);
    if (!el || !window.Chart || !chartData.labels.length) return;
    new Chart(el, {
      type: 'bar',
      data: { labels: chartData.labels, datasets: [{ data: chartData.data, backgroundColor: chartData.data.map(barColor), borderRadius: 4 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, max: 100, ticks: { callback: function (v) { return v + '%'; }, font: { size: 10 } } },
          x: { ticks: { font: { size: 9 }, maxRotation: 40, minRotation: 0 } },
        },
      },
    });
  }
  drawUnitChart('chart-admin-unit', adminUnitChartData);
  studentUnitChartData.forEach(function (d, i) { drawUnitChart('chart-unit-' + i, d); });

  var saveImgBtn = document.getElementById('rpSaveImgBtn');
  var savePdfBtn = document.getElementById('rpSavePdfBtn');
  if (saveImgBtn) saveImgBtn.addEventListener('click', async function () {
    saveImgBtn.disabled = true;
    var orig = saveImgBtn.textContent;
    saveImgBtn.textContent = '캡처 중...';
    try {
      var canvas = await captureEl(sheets[0]);
      var a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = fileBase + ' - 관리자요약.png';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { alert('이미지 저장 실패: ' + e.message); }
    finally { saveImgBtn.disabled = false; saveImgBtn.textContent = orig; }
  });
  if (savePdfBtn) savePdfBtn.addEventListener('click', async function () {
    savePdfBtn.disabled = true;
    var orig = savePdfBtn.textContent;
    try {
      var jsPDFCtor = (window.jspdf && window.jspdf.jsPDF);
      if (!jsPDFCtor) throw new Error('PDF 라이브러리를 불러오지 못했습니다');
      var pageW = 210, pdf = null;
      for (var i = 0; i < sheets.length; i++) {
        savePdfBtn.textContent = '캡처 중... (' + (i + 1) + '/' + sheets.length + ')';
        var canvas = await captureEl(sheets[i]);
        var imgData = canvas.toDataURL('image/jpeg', 0.95);
        var pageH = pageW * (canvas.height / canvas.width);
        if (!pdf) pdf = new jsPDFCtor({ orientation: 'portrait', unit: 'mm', format: [pageW, pageH] });
        else pdf.addPage([pageW, pageH], 'portrait');
        pdf.addImage(imgData, 'JPEG', 0, 0, pageW, pageH, undefined, 'FAST');
      }
      pdf.save(fileBase + ' - 채점리포트.pdf');
    } catch (e) { alert('PDF 저장 실패: ' + e.message); }
    finally { savePdfBtn.disabled = false; savePdfBtn.textContent = orig; }
  });

  // 학생 1명만 이미지/HTML로 저장 — 문자·카카오톡으로 그 학생 것만 바로
  // 보낼 수 있게. 이미지는 어느 메신저든 바로 전송되니 "문자로 보내도
  // 보이는" 용도로는 이미지 쪽이 가장 무난하고, HTML은 그 학생 페이지만
  // 담긴 독립 파일이 필요할 때 쓴다.
  var headHtml = document.head.innerHTML;
  document.querySelectorAll('.rpStudent').forEach(function (section, sectionIdx) {
    var name = section.dataset.student;
    section.querySelectorAll('.rpBtnSm').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var act = btn.dataset.act;
        btn.disabled = true;
        var orig = btn.textContent;
        try {
          if (act === 'img') {
            btn.textContent = '캡처 중...';
            var canvas = await captureEl(section);
            var a = document.createElement('a');
            a.href = canvas.toDataURL('image/png');
            a.download = name + ' - 채점리포트.png';
            document.body.appendChild(a); a.click(); a.remove();
          } else {
            // section.outerHTML만으로는 그 학생의 단원별 성취도 그래프를
            // 그리는 스크립트가 안 딸려온다(그 그래프는 전체 리포트
            // 페이지의 별도 <script>에서만 그림) — 이 학생 것만 담긴
            // 독립 파일에서도 그래프가 정상적으로 나오도록 그 학생의
            // 차트 데이터와 그리는 코드만 따로 인라인으로 끼워 넣는다.
            var chartData = studentUnitChartData[sectionIdx];
            var chartScript = '<script>document.addEventListener("DOMContentLoaded",function(){' +
              'function bc(v){return v==null?"#ddd":v<50?"#C64E71":v<75?"#A8853F":"#3E8F79";}' +
              'var cd=' + JSON.stringify(chartData) + ';' +
              'var el=document.getElementById("chart-unit-' + sectionIdx + '");' +
              'if(el&&window.Chart&&cd.labels.length){new Chart(el,{type:"bar",data:{labels:cd.labels,datasets:[{data:cd.data,backgroundColor:cd.data.map(bc),borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,max:100,ticks:{callback:function(v){return v+"%";},font:{size:10}}},x:{ticks:{font:{size:9},maxRotation:40,minRotation:0}}}}});}' +
              '});<\\/script>';
            var doc = '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>' + name + ' - 채점리포트</title>' + headHtml + '</head><body style="padding:20px 0">' + section.outerHTML + chartScript + '</body></html>';
            var blob = new Blob([doc], { type: 'text/html;charset=utf-8' });
            var url = URL.createObjectURL(blob);
            var a2 = document.createElement('a');
            a2.href = url; a2.download = name + ' - 채점리포트.html';
            document.body.appendChild(a2); a2.click(); a2.remove();
            URL.revokeObjectURL(url);
          }
        } catch (e) { alert('저장 실패: ' + e.message); }
        finally { btn.disabled = false; btn.textContent = orig; }
      });
    });
  });
});
<\/script>
</body></html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title} - 채점리포트.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
