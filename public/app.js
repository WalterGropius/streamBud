// streamBud front end. No framework, no build step.

const $ = (sel) => document.querySelector(sel);
const els = {
  form: $('#form'),
  input: $('#link'),
  paste: $('#paste'),
  clear: $('#clear'),
  autoCopy: $('#auto-copy'),
  result: $('#result'),
  recent: $('#recent'),
  recentList: $('#recent-list'),
  clearHistory: $('#clear-history'),
  toast: $('#toast'),
};

const NAMES = { spotify: 'Spotify', youtubeMusic: 'YouTube Music', youtube: 'YouTube' };
const LINK_HINT = /(spotify\.com\/|spotify\.link\/|spoti\.fi\/|youtube\.com\/|youtu\.be\/|spotify:[a-z]+:)/i;
const HISTORY_KEY = 'streambud.history.v1';
const SETTINGS_KEY = 'streambud.settings.v1';
const HISTORY_MAX = 15;

// ---- tiny helpers ------------------------------------------------------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function icon(name, cls = 'i') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key) ?? 'null');
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return null; // private mode, storage full, etc. Everything still works without it.
  }
  return value;
}

let toastTimer;
function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2200);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers / non-secure contexts.
    const ta = h('textarea', { readonly: true, class: 'sr-only' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

function prettyUrl(url) {
  return url.replace(/^https?:\/\/(www\.)?/, '');
}

function songLine(meta) {
  return meta.artist ? `${meta.title} — ${meta.artist}` : meta.title;
}

// ---- settings ----------------------------------------------------------

const settings = { autoCopy: true, ...(store(SETTINGS_KEY) || {}) };
els.autoCopy.checked = settings.autoCopy;
els.autoCopy.addEventListener('change', () => {
  settings.autoCopy = els.autoCopy.checked;
  store(SETTINGS_KEY, settings);
});

// ---- converting --------------------------------------------------------

let inflight = null;
let lastInput = '';

async function convert(text) {
  text = String(text || '').trim();
  if (!text) return;
  if (text === lastInput && els.result.dataset.state !== 'error') return;
  lastInput = text;

  inflight?.abort();
  const ctrl = new AbortController();
  inflight = ctrl;
  showLoading();

  try {
    const res = await fetch(`/api/convert?url=${encodeURIComponent(text)}`, { signal: ctrl.signal });
    const data = await res.json().catch(() => null);
    if (ctrl !== inflight) return;
    if (!res.ok || !data || data.error) {
      throw Object.assign(new Error(data?.error?.message || `Something went wrong (${res.status}). Try again?`), {
        friendly: true,
      });
    }
    showResult(data);
    remember(data);
    if (settings.autoCopy) autoCopy(data);
  } catch (err) {
    if (err.name === 'AbortError' || ctrl !== inflight) return;
    showError(err.friendly ? err.message : "Couldn't reach streamBud. Check your connection and try again.");
  } finally {
    if (ctrl === inflight) inflight = null;
  }
}

async function autoCopy(data) {
  const target = data.targets[data.primary];
  if (!target || document.visibilityState !== 'visible') return;
  // Browsers only allow this right after a tap; if it's refused, the big Copy button is right there.
  try {
    await navigator.clipboard.writeText(target.url);
    markCopied(els.result.querySelector('[data-copy-primary]'));
    toast(`${NAMES[data.primary]} link copied`);
  } catch {
    /* ignore */
  }
}

// ---- rendering ---------------------------------------------------------

function showLoading() {
  els.result.hidden = false;
  els.result.dataset.state = 'loading';
  els.result.replaceChildren(
    h(
      'div',
      { class: 'card skeleton', 'aria-busy': 'true', 'aria-label': 'Finding the song…' },
      h('div', { class: 'song' }, h('div', { class: 'art' }), h('div', { class: 'song-text' }, bar('180px'), bar('120px'))),
      h('div', { class: 'bar big' }),
    ),
  );
}

function bar(width) {
  const b = h('div', { class: 'bar' });
  b.style.width = width;
  return b;
}

function showError(message) {
  els.result.hidden = false;
  els.result.dataset.state = 'error';
  els.result.replaceChildren(
    h(
      'div',
      { class: 'card error', role: 'alert' },
      icon('alert'),
      h('div', {}, h('p', { text: message }), h('p', { class: 'sub', text: 'Songs and albums from Spotify, YouTube Music or YouTube work.' })),
    ),
  );
}

function markCopied(btn) {
  if (!btn) return;
  const label = btn.querySelector('span');
  const original = btn.dataset.label || label?.textContent;
  btn.dataset.label = original;
  btn.classList.add('copied');
  btn.querySelector('use')?.setAttribute('href', '#i-check');
  if (label) label.textContent = 'Copied';
  clearTimeout(btn._t);
  btn._t = setTimeout(() => {
    btn.classList.remove('copied');
    btn.querySelector('use')?.setAttribute('href', '#i-copy');
    if (label) label.textContent = original;
  }, 1800);
}

function badge(match) {
  if (match === 'direct') return h('span', { class: 'badge direct' }, icon('check'), 'Exact link');
  if (match === 'search') return h('span', { class: 'badge search' }, icon('search'), 'Search link');
  return h('span', { class: 'badge source' }, 'Original');
}

function showResult(data) {
  const { meta, source, targets, primary: primaryKey } = data;
  const primary = targets[primaryKey];
  const sourceKey = source.platform === 'spotify' ? 'spotify' : 'youtubeMusic';
  const name = NAMES[primaryKey];

  const copyBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn primary',
      'data-copy-primary': true,
      onclick: async (e) => {
        if (await copyText(primary.url)) {
          markCopied(e.currentTarget);
          toast(`${name} link copied`);
        } else toast("Couldn't copy. Long-press the link instead.");
      },
    },
    icon('copy'),
    h('span', { text: 'Copy link' }),
  );

  const actions = [
    copyBtn,
    h(
      'a',
      { class: 'btn secondary', href: primary.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Open in ${name}` },
      icon('open'),
    ),
  ];
  if (navigator.share) {
    actions.push(
      h(
        'button',
        {
          type: 'button',
          class: 'btn secondary',
          'aria-label': 'Share',
          onclick: () => navigator.share({ title: songLine(meta), text: songLine(meta), url: primary.url }).catch(() => {}),
        },
        icon('share'),
      ),
    );
  }

  const linkLabel =
    primary.match === 'search'
      ? h('span', {}, `Search “${data.query}”`)
      : h('span', { text: prettyUrl(primary.url) });

  const hint =
    primary.match === 'search'
      ? h('p', {
          class: 'hint',
          text: `Couldn’t pin down the exact track, so this opens ${name} already searching for it. It’s almost always the top result.`,
        })
      : null;

  const bothText = [
    songLine(meta),
    `Spotify: ${targets.spotify.url}`,
    `YouTube Music: ${targets.youtubeMusic.url}`,
  ].join('\n');

  const moreItems = [];
  if (targets.youtube && primaryKey !== 'youtube') {
    moreItems.push({ name: 'YouTube', url: targets.youtube.url, kind: targets.youtube.match, key: 'youtube' });
  }
  const otherMain = primaryKey === 'spotify' ? 'youtubeMusic' : 'spotify';
  if (targets[otherMain] && targets[otherMain].match !== 'source') {
    moreItems.push({ name: NAMES[otherMain], url: targets[otherMain].url, kind: targets[otherMain].match, key: otherMain });
  }
  for (const m of data.more || []) moreItems.push({ name: m.name, url: m.url, kind: m.key === 'songlink' ? 'page' : 'search', key: m.key });

  const card = h(
    'article',
    { class: 'card' },
    h(
      'div',
      { class: 'song' },
      meta.artwork
        ? h('img', { class: 'art', src: meta.artwork, alt: '', referrerpolicy: 'no-referrer', decoding: 'async' })
        : h('div', { class: 'art' }),
      h(
        'div',
        { class: 'song-text' },
        h('div', { class: 'song-title', text: meta.title || 'Unknown title' }),
        meta.artist ? h('div', { class: 'song-artist', text: meta.artist }) : null,
        h('div', { class: 'song-from' }, h('i', { class: `dot ${sourceKey}` }), `${meta.kindLabel} from ${NAMES[sourceKey]}`),
      ),
    ),
    h(
      'div',
      { class: 'target' },
      h(
        'div',
        { class: 'target-head' },
        h('span', { class: 'platform' }, h('span', { class: `platform-icon ${primaryKey}` }, icon('play')), name),
        badge(primary.match),
      ),
      h(
        'a',
        { class: 'link-box', href: primary.url, target: '_blank', rel: 'noopener noreferrer' },
        primary.match === 'search' ? icon('search') : null,
        linkLabel,
      ),
      h('div', { class: 'actions' }, actions),
      hint,
    ),
    h(
      'div',
      { class: 'card-foot' },
      h(
        'details',
        { class: 'more' },
        h('summary', {}, 'Other services'),
        h(
          'ul',
          {},
          moreItems.map((m) =>
            h(
              'li',
              {},
              h(
                'a',
                { href: m.url, target: '_blank', rel: 'noopener noreferrer' },
                h('i', { class: `dot ${m.key}` }),
                m.name,
                h('span', { class: 'kind', text: m.kind === 'direct' ? 'exact link' : m.kind === 'page' ? 'every app' : 'search' }),
              ),
              h(
                'button',
                {
                  type: 'button',
                  class: 'icon-btn',
                  'aria-label': `Copy ${m.name} link`,
                  onclick: async () => toast((await copyText(m.url)) ? `${m.name} link copied` : "Couldn't copy"),
                },
                icon('copy'),
              ),
            ),
          ),
        ),
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'text-btn',
          title: 'Copies the song name with both links, so whoever gets it can tap theirs',
          onclick: async () => toast((await copyText(bothText)) ? 'Both links copied' : "Couldn't copy"),
        },
        'Copy both links',
      ),
    ),
  );

  els.result.hidden = false;
  els.result.dataset.state = 'done';
  els.result.replaceChildren(card);
}

// ---- recent conversions (stored only on this device) --------------------

function loadHistory() {
  const list = store(HISTORY_KEY);
  return Array.isArray(list) ? list : [];
}

function remember(data) {
  const list = loadHistory().filter((item) => item?.source?.url !== data.source.url);
  list.unshift({ ...data, savedAt: Date.now() });
  store(HISTORY_KEY, list.slice(0, HISTORY_MAX));
  renderHistory();
}

function renderHistory() {
  const list = loadHistory().filter((d) => d?.meta && d?.targets && d?.source);
  els.recent.hidden = list.length === 0;
  els.recentList.replaceChildren(
    ...list.map((d) => {
      const from = d.source.platform === 'spotify' ? 'spotify' : 'youtubeMusic';
      return h(
        'li',
        {},
        h(
          'button',
          {
            type: 'button',
            onclick: () => {
              lastInput = d.source.url;
              els.input.value = d.source.url;
              syncClear();
              showResult(d);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            },
          },
          d.meta.artwork ? h('img', { src: d.meta.artwork, alt: '', referrerpolicy: 'no-referrer', loading: 'lazy' }) : h('span', { class: 'ph' }),
          h(
            'span',
            { class: 'txt' },
            h('span', { class: 't', text: d.meta.title }),
            h('span', { class: 's' }, h('i', { class: `dot ${from}` }), NAMES[from], icon('arrow'), h('i', { class: `dot ${d.primary}` }), NAMES[d.primary]),
          ),
        ),
      );
    }),
  );
}

els.clearHistory.addEventListener('click', () => {
  store(HISTORY_KEY, []);
  renderHistory();
});

// ---- input handling ----------------------------------------------------

function syncClear() {
  els.clear.hidden = !els.input.value;
}

let typingTimer;
els.input.addEventListener('input', (e) => {
  syncClear();
  clearTimeout(typingTimer);
  if (!LINK_HINT.test(els.input.value)) return;
  if (e.inputType === 'insertFromPaste') {
    els.input.blur(); // put the keyboard away so the result is visible
    convert(els.input.value);
  } else {
    typingTimer = setTimeout(() => convert(els.input.value), 350);
  }
});

els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  lastInput = '';
  convert(els.input.value);
  els.input.blur();
});

els.clear.addEventListener('click', () => {
  els.input.value = '';
  lastInput = '';
  inflight?.abort();
  els.result.hidden = true;
  els.result.replaceChildren();
  syncClear();
  els.input.focus();
});

els.paste.addEventListener('click', async () => {
  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch {
    /* permission denied or unsupported */
  }
  if (!text) {
    els.input.focus();
    toast('Long-press the box and tap Paste');
    return;
  }
  els.input.value = text.trim();
  syncClear();
  convert(text);
});

// ---- opened via share sheet / deep link (?url=… or ?text=…) -------------

function fromLaunchParams() {
  const params = new URLSearchParams(location.search);
  const shared = ['url', 'text', 'title'].map((k) => params.get(k)).filter(Boolean).join(' ').trim();
  if (!shared) return;
  window.history.replaceState?.(null, '', location.pathname);
  els.input.value = shared;
  syncClear();
  convert(shared);
}

// Fill in this site's address in the iPhone Shortcut instructions.
const origin = location.origin.startsWith('http') ? location.origin : 'https://your-streambud-site';
$('#shortcut-url').textContent = `${origin}/?text=`;
$('#deep-link').textContent = `${origin}/?url=…`;

renderHistory();
fromLaunchParams();
