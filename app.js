/**
 * Link Expander — single page app.
 *
 * Two views, picked from the path:
 *   /            -> the generator
 *   /<anything>  -> a generated link: decode the destination and go there
 *
 * GitHub Pages serves 404.html (a copy of index.html, made by the deploy
 * workflow) for unknown paths, which is what makes the deep links work.
 *
 * English and Chinese are both first class: the language comes from
 * `navigator.language`, is remembered in localStorage, and every piece of the
 * page — including whatever message happens to be on screen — is re-rendered
 * from the dictionary in `applyLanguage()`.
 */

import { DEFAULT_LENGTH, SOFT_MAX_LENGTH, buildLink, parseLink } from './lib.js';

const STRINGS = {
  en: {
    pageTitle: 'Link Expander',
    h1: 'Link Expander',
    subtitle: 'Plenty of people try to make links shorter. So what if one is longer?',
    targetLabel: 'Link to expand',
    seedLabel: 'Random seed (optional)',
    seedPlaceholder: 'leave empty for a random one',
    lengthLabel: 'Total length, protocol included (characters)',
    submit: 'Expand',
    resultLabel: 'Your very long link',
    copy: 'Copy',
    copied: 'Copied.',
    copyFailed: 'Copy failed — select the text and copy it manually.',
    open: 'Open it to check that it works',
    count: '{total} characters, {padding} of them noise · seed {seed}',
    howTitle: 'How does it work?',
    howBody:
      'Only a handful of characters carry your destination and the seed; everything else is noise derived ' +
      'from that seed, padding the link out to the exact length you asked for. The same destination, seed ' +
      'and length always rebuild the identical link, so nothing is lost on the way — and opening the link ' +
      'goes to your destination.',
    limitsBody:
      'Up to 8192 characters works. Past 2000, some browsers, chat apps and mail clients start truncating, ' +
      'and the page warns you when you go that far. The destination has to be an http:// or https:// link.',
    credit: 'Plain HTML, CSS and JS, no tracking. Styled after ',
    redirectTitle: 'Taking you there…',
    redirectManual: 'If nothing happens, open this link:',
    redirectEdited:
      'This link was edited on the way: its noise no longer matches its seed, so the destination may not be ' +
      'what the sender meant.',
    home: '← Link Expander',
    notFoundTitle: 'Dead link',
    notFoundBody: 'This long link does not point anywhere. A character probably got lost on the way.',
    errors: {
      EMPTY_TARGET: 'Enter the link you want to expand.',
      INVALID_TARGET: 'That does not look like a valid link.',
      BAD_SCHEME: 'Only http:// and https:// links can be expanded.',
      SEED_TOO_LONG: 'The seed can be at most {maximum} characters.',
      INVALID_LENGTH: 'Enter the total length as a whole number.',
      TOO_SHORT:
        'Cannot reach {requested} characters: this destination and seed need at least {minimum}. ' +
        'Try {minimum} or more.',
      TOO_LONG: 'The maximum is {maximum} characters.',
      INTERNAL: 'Something went wrong while building the link. Please try again.',
      unknown: 'Something went wrong. Please try again.',
    },
    warnings: {
      SOFT_TOO_LONG:
        'Done. Note that links over {soft} characters are truncated by some browsers, chat apps and mail clients.',
    },
  },
  zh: {
    pageTitle: '链接加长器',
    h1: '链接加长器',
    subtitle: '很多人都在想办法把链接变短，长一点又怎么样呢？',
    targetLabel: '要加长的链接',
    seedLabel: '随机种子（可选）',
    seedPlaceholder: '留空则随机生成一个',
    lengthLabel: '目标总长度，含协议头（字符数）',
    submit: '加长',
    resultLabel: '你的超长链接',
    copy: '复制',
    copied: '已复制。',
    copyFailed: '复制失败 —— 请手动选中并复制。',
    open: '打开测试一下',
    count: '共 {total} 个字符，其中 {padding} 个是噪音 · 种子 {seed}',
    howTitle: '这是怎么做到的？',
    howBody:
      '链接里只有少数几个字符记录了目标地址和种子，其余都是根据种子生成的噪音，用来把链接凑到你要求的长度。' +
      '相同的目标地址、种子和长度永远能复原出一模一样的链接，不会丢东西；打开链接就会跳到你的目标地址。',
    limitsBody:
      '最长支持 8192 个字符；超过 2000 时，部分浏览器、聊天软件和邮件客户端会开始截断，到那一步页面会提醒你。' +
      '目标地址必须以 http:// 或 https:// 开头。',
    credit: '纯 HTML、CSS 和 JS，没有任何追踪。风格参照 ',
    redirectTitle: '正在跳转…',
    redirectManual: '如果没有自动跳转，请打开这个链接：',
    redirectEdited: '这个链接中途被改过：噪音和种子对不上，目标地址可能不是发送者原本的意思。',
    home: '← 链接加长器',
    notFoundTitle: '死链',
    notFoundBody: '这个超长链接没有指向任何地方，多半是路上丢了一个字符。',
    errors: {
      EMPTY_TARGET: '请输入要加长的链接。',
      INVALID_TARGET: '这看起来不是一个有效的链接。',
      BAD_SCHEME: '只能加长 http:// 或 https:// 开头的链接。',
      SEED_TOO_LONG: '种子最长 {maximum} 个字符。',
      INVALID_LENGTH: '请输入一个整数的总长度。',
      TOO_SHORT: '无法达到 {requested} 个字符：这个目标地址和种子至少需要 {minimum} 个字符。请输入 {minimum} 或更大的数字。',
      TOO_LONG: '最长只支持 {maximum} 个字符。',
      INTERNAL: '生成链接时出错了，请再试一次。',
      unknown: '出错了，请再试一次。',
    },
    warnings: {
      SOFT_TOO_LONG: '完成了。注意：超过 {soft} 个字符的链接，部分浏览器、聊天软件和邮件客户端会截断。',
    },
  },
};

const STORAGE_KEY = 'linkexpander';
const REDIRECT_DELAY = 400;
const $ = (id) => document.getElementById(id);

/** Everything on screen is rendered from these four pieces of state. */
let lang = readLang();
let lastResult = null;
let lastMessage = null;
let view = 'generator';
let redirectTarget = null;
let redirectIntact = true;
let redirectTimer = null;

/* ------------------------------------------------------------------ helpers */

function readLang() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (saved.lang === 'en' || saved.lang === 'zh') return saved.lang;
  } catch { /* ignore */ }
  return (navigator.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function remember(patch) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readMemory(), ...patch }));
  } catch { /* ignore */ }
}

function readMemory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function t() {
  return STRINGS[lang];
}

function fill(template, values = {}) {
  return String(template).replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  );
}

/* ------------------------------------------------------------------- render */

/** The one place that knows how to put the current language on the page. */
function applyLanguage() {
  const strings = t();
  document.documentElement.lang = lang === 'zh' ? 'zh-Hans' : 'en';
  document.title = strings.pageTitle;

  $('title').textContent = strings.h1;
  $('subtitle').textContent = strings.subtitle;
  $('label-target').textContent = strings.targetLabel;
  $('label-seed').textContent = strings.seedLabel;
  $('seed').placeholder = strings.seedPlaceholder;
  $('label-length').textContent = strings.lengthLabel;
  $('submit').textContent = strings.submit;
  $('label-result').textContent = strings.resultLabel;
  $('copy').textContent = strings.copy;
  $('open').textContent = strings.open;
  $('how-title').textContent = strings.howTitle;
  $('how-body').textContent = strings.howBody;
  $('limits-body').textContent = strings.limitsBody;
  $('credit-text').textContent = strings.credit;
  $('redirect-note').textContent = strings.redirectEdited;
  $('redirect-home').textContent = strings.home;
  $('lang').textContent = lang === 'en' ? '中文' : 'English';

  renderResult();
  renderMessage();
  renderView();
}

/** `lastResult.seed` comes out of the generated link, not out of the input. */
function renderResult() {
  if (!lastResult) return;
  $('result').hidden = false;
  $('output').value = lastResult.url;
  $('count').textContent = fill(t().count, {
    total: lastResult.length,
    padding: lastResult.padding,
    seed: lastResult.seed,
  });
  $('open').href = lastResult.url;
}

function renderMessage() {
  const node = $('message');
  if (!lastMessage) {
    node.hidden = true;
    node.textContent = '';
    return;
  }

  const strings = t();
  let text = '';
  let ok = false;
  if (lastMessage.kind === 'error') {
    text = fill(strings.errors[lastMessage.code] || strings.errors.unknown, lastMessage.meta || {});
  } else if (lastMessage.kind === 'warning') {
    text = fill(strings.warnings[lastMessage.name], lastMessage.meta || {});
    ok = true;
  } else if (lastMessage.kind === 'notice') {
    text = strings[lastMessage.key];
    ok = lastMessage.ok;
  }

  node.textContent = text;
  node.classList.toggle('ok', Boolean(ok));
  node.hidden = false;
}

function renderView() {
  const generator = view === 'generator';
  $('view-generator').hidden = !generator;
  $('view-redirect').hidden = generator;
  setIndexable(generator);
  if (generator) return;

  const strings = t();
  if (!redirectTarget) {
    document.title = strings.notFoundTitle;
    $('redirect-title').textContent = strings.notFoundTitle;
    $('redirect-manual').textContent = strings.notFoundBody;
    $('redirect-link').hidden = true;
    $('redirect-note').hidden = true;
    return;
  }

  document.title = `${strings.redirectTitle} ${redirectTarget}`;
  $('redirect-title').textContent = strings.redirectTitle;
  $('redirect-manual').textContent = strings.redirectManual;
  const link = $('redirect-link');
  link.hidden = false;
  link.href = redirectTarget;
  link.textContent = redirectTarget;
  $('redirect-note').hidden = redirectIntact;
}

function setMessage(message) {
  lastMessage = message;
  renderMessage();
}

/**
 * The generator page is the canonical, indexable one (its `rel=canonical` lives
 * in index.html). A generated link is random, infinite in number and answered
 * with a 404 status, so it must never reach an index — and it must not claim a
 * canonical pointing at the homepage either.
 */
function setIndexable(indexable) {
  const robots = document.querySelector('meta[name="robots"]');
  if (robots) robots.content = indexable ? 'index, follow' : 'noindex, nofollow';
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical && !indexable) canonical.remove();
}

/* --------------------------------------------------------------- generator */

function generate(event) {
  event.preventDefault();
  const rawTarget = $('target').value;
  const rawLength = $('length').value.trim();
  $('result').hidden = true;

  if (!rawLength) {
    setMessage({ kind: 'error', code: 'INVALID_LENGTH' });
    return;
  }

  let built;
  try {
    built = buildLink(rawTarget, rawLength, { seed: $('seed').value });
  } catch (error) {
    setMessage({ kind: 'error', code: (error && error.code) || 'unknown', meta: (error && error.meta) || {} });
    return;
  }

  const restored = parseLink(built.url);
  const result = restored ? { ...built, seed: restored.seed } : built;

  // Write the seed back, so pressing Expand again reproduces this exact link.
  $('seed').value = result.seed;
  lastResult = result;
  renderResult();
  remember({ target: rawTarget, seed: result.seed, length: String(rawLength) });

  if (result.warning) setMessage({ kind: 'warning', name: result.warning, meta: { soft: SOFT_MAX_LENGTH } });
  else setMessage(null);
}

async function copyResult() {
  const node = $('output');
  if (!node.value) return;
  try {
    await navigator.clipboard.writeText(node.value);
    setMessage({ kind: 'notice', key: 'copied', ok: true });
  } catch {
    node.select();
    const ok = Boolean(document.execCommand && document.execCommand('copy'));
    setMessage({ kind: 'notice', key: ok ? 'copied' : 'copyFailed', ok });
  }
}

/* ---------------------------------------------------------------- redirect */

function enterRedirect(parsed) {
  view = 'redirect';
  redirectTarget = parsed ? parsed.target : null;
  redirectIntact = parsed ? parsed.intact : true;
}

/* -------------------------------------------------------------------- boot */

function route() {
  let pathname = window.location.pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch { /* keep the raw path */ }
  const isDeepLink = pathname.length > 1 && !/^\/(index\.html)?$/.test(pathname);
  return { isDeepLink, parsed: isDeepLink ? parseLink(pathname) : null };
}

function boot() {
  const params = new URLSearchParams(window.location.search);
  const memory = readMemory();
  $('target').value = memory.target || '';
  $('length').value = memory.length || String(DEFAULT_LENGTH);
  $('seed').value = memory.seed || '';
  $('redirect-home').href = window.location.origin + '/';

  // ?lang=en|zh: same page, an explicit language, handy to share or to override
  // what navigator.language guessed.
  const requestedLang = params.get('lang');
  if (requestedLang === 'en' || requestedLang === 'zh') {
    lang = requestedLang;
    remember({ lang });
  }

  $('form').addEventListener('submit', generate);
  $('copy').addEventListener('click', copyResult);
  $('lang').addEventListener('click', () => {
    lang = lang === 'en' ? 'zh' : 'en';
    remember({ lang });
    applyLanguage();
  });

  const { isDeepLink, parsed } = route();
  if (isDeepLink) enterRedirect(parsed);
  else view = 'generator';

  // One render pass for whichever view we landed on, in the right language.
  applyLanguage();

  if (isDeepLink) {
    // Give the browser a moment to paint the page before leaving. Switching
    // language re-renders the view but never re-arms this.
    if (redirectTarget) {
      clearTimeout(redirectTimer);
      redirectTimer = setTimeout(() => window.location.replace(redirectTarget), REDIRECT_DELAY);
    }
    return;
  }

  // Preset link, e.g. /?target=example.com&seed=abc&length=200.
  if (params.get('target')) {
    $('target').value = params.get('target');
    if (params.get('seed')) $('seed').value = params.get('seed');
    if (params.get('length')) $('length').value = params.get('length');
    generate({ preventDefault() {} });
    return;
  }

  $('target').focus();
}

boot();
