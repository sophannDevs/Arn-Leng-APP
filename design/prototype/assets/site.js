/* Inkline static prototype: shared data, demo state and page shell. */
(function () {
  var DAY = 864e5;
  var CONFIG = { name: 'Inkline', freeEpisodes: 3, earlyAccessDays: 7, currency: 'USD' };
  var PLANS = [
    { code: 'monthly', name: 'Monthly', interval: 'month', priceMinor: 499 },
    { code: 'yearly', name: 'Yearly', interval: 'year', priceMinor: 4999 }
  ];

  var rays = function (at, a) { return 'repeating-conic-gradient(from 0deg at ' + at + ',rgba(255,255,255,' + a + ') 0 8deg,transparent 8deg 16deg),'; };
  var SERIES = [
    { slug: 'super-knight', title: 'Super Knight', cover: 'SUPER\nKNIGHT', ink: '#FFD60A', bg: rays('50% 70%', .2) + 'linear-gradient(160deg,#e03030,#1c3faa)', base: ['#e03030', '#1c3faa'],
      genres: ['Superhero', 'Action'], status: 'ongoing', creator: 'A. Rivera', age: 'Teen', views: '4.2M', followers: '312K', likes: '1.1M',
      desc: 'A rookie guardian inherits a battered suit of armor and a city that has stopped believing in heroes. Every patrol costs her something, and the suit keeps a record.' },
    { slug: 'red-squad', title: 'Red Squad', cover: 'RED\nSQUAD', ink: '#FFD60A', bg: rays('50% 55%', .22) + 'linear-gradient(160deg,#e03030,#7a0f0f)', base: ['#e03030', '#7a0f0f'],
      genres: ['Action', 'Thriller'], status: 'ongoing', creator: 'M. Okafor', age: 'Mature', views: '3.8M', followers: '254K', likes: '980K', premiumEp: 6,
      desc: 'Five operatives, one compromised mission. Red Squad works behind enemy lines where every ally might be a double agent, including the one giving orders.' },
    { slug: 'nova-nexus', title: 'Nova Nexus', cover: 'NOVA\nNEXUS', ink: '#fff', bg: rays('50% 60%', .2) + 'linear-gradient(160deg,#7b2cbf,#240046)', base: ['#7b2cbf', '#240046'],
      genres: ['Sci-Fi', 'Adventure'], status: 'ongoing', creator: 'L. Tanaka', age: 'Teen', views: '5.1M', followers: '401K', likes: '1.6M',
      desc: 'A signal from deep space pulls a crew of misfits toward the Nexus, a station that should not exist. When they dock, someone is already waiting for them.' },
    { slug: 'night-owl', title: 'Night Owl', cover: 'NIGHT\nOWL', ink: '#fff', shadow: '#D91E1E', bg: rays('50% 70%', .12) + 'linear-gradient(170deg,#444,#111)', base: ['#444', '#111'],
      genres: ['Mystery', 'Thriller'], status: 'ongoing', creator: 'J. Moreau', age: 'Teen', views: '2.6M', followers: '188K', likes: '720K',
      desc: 'A radio host who only broadcasts after midnight starts receiving calls about crimes that have not happened yet.' },
    { slug: 'steel-vanguard', title: 'Steel Vanguard', cover: 'STEEL\nVANGUARD', ink: '#FFD60A', bg: rays('50% 60%', .2) + 'linear-gradient(160deg,#1c3faa,#0b1b4d)', base: ['#1c3faa', '#0b1b4d'],
      genres: ['Sci-Fi', 'Action'], status: 'completed', creator: 'R. Lindqvist', age: 'Teen', views: '6.9M', followers: '512K', likes: '2.3M',
      desc: 'The last mech pilots of a fallen academy defend a border nobody else remembers. A complete ten-episode story.' },
    { slug: 'iron-echo', title: 'Iron Echo', cover: 'IRON\nECHO', ink: '#fff', bg: rays('50% 60%', .2) + 'linear-gradient(160deg,#1e7a4a,#0c2e1c)', base: ['#1e7a4a', '#0c2e1c'],
      genres: ['Fantasy', 'Adventure'], status: 'ongoing', creator: 'S. Kaur', age: 'All ages', views: '1.9M', followers: '143K', likes: '540K',
      desc: 'In a forest where every tree remembers a song, a blacksmith\'s apprentice forges a bell that can wake the old giants.' }
  ];
  var EP_TITLES = ['The First Page', 'Static', 'Old Friends', 'Fault Lines', 'Into the Dark', 'The Trade', 'Echoes', 'No Way Back', 'Signal Fire', 'Point of No Return'];

  function episodes(series) {
    var now = Date.now();
    var shift = (SERIES.indexOf(series) % 4) * 1.1 * DAY + (series.status === 'completed' ? 60 * DAY : 0);
    var list = [];
    for (var n = 1; n <= 10; n++) {
      var daysAgo = n === 10 ? 2 : n === 9 ? 5 : (8 - n) * 7 + 9;
      var published = now - daysAgo * DAY - shift;
      var ep = { series: series.slug, number: n, title: EP_TITLES[n - 1], publishedAt: published, accessType: 'subscriber', freeAfter: null };
      if (n <= CONFIG.freeEpisodes) ep.accessType = 'free';
      else if (series.premiumEp !== n) ep.freeAfter = published + CONFIG.earlyAccessDays * DAY;
      list.push(ep);
    }
    return list;
  }

  /* ---------- demo state (browser only) ---------- */
  var KEY = 'inkline-demo';
  var state = { user: null, sub: null, follows: [], likes: [], progress: {}, history: [] };
  try { var saved = JSON.parse(localStorage.getItem(KEY) || 'null'); if (saved) state = Object.assign(state, saved); } catch (e) {}
  if (state.user && !state.user.role) {
    state.user = Object.assign({ role: 'reader', color: '#D91E1E', locale: 'en', twoFA: false, notify: { episodes: true, replies: true, product: false }, creator: null, joined: Date.now() }, state.user);
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

  function entitled(now) {
    var s = state.sub;
    if (!s || !state.user) return false;
    now = now || Date.now();
    if (s.status === 'active') return true;
    if (s.status === 'canceled') return now < s.periodEnd;
    return false;
  }

  /* The CLAUDE.md access rule, minus the admin/creator branch. */
  function access(ep, now) {
    now = now || Date.now();
    if (ep.number <= CONFIG.freeEpisodes) return { ok: true, why: 'free' };
    if (ep.accessType === 'free') return { ok: true, why: 'free' };
    if (ep.freeAfter && now >= ep.freeAfter) return { ok: true, why: 'free' };
    if (entitled(now)) return { ok: true, why: 'sub' };
    return { ok: false, why: ep.freeAfter ? 'early' : 'premium', freeIn: ep.freeAfter ? Math.ceil((ep.freeAfter - now) / DAY) : null };
  }

  /* ---------- helpers ---------- */
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var bySlug = function (slug) { return SERIES.find(function (s) { return s.slug === slug; }); };
  var money = function (minor) { return '$' + (minor / 100).toFixed(2); };
  var param = function (k) { return new URLSearchParams(location.search).get(k); };
  function ago(t) {
    var d = Math.floor((Date.now() - t) / DAY);
    return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : d < 30 ? d + ' days ago' : new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function date(t) { return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  function inkShadow(s) { return s.shadow || '#111'; }
  function epPill(ep) {
    var a = access(ep), read = isRead(ep);
    if (!a.ok && a.why === 'early') return '<span class="pill soon">' + lockSvg(11) + ' Free in ' + a.freeIn + (a.freeIn === 1 ? ' day' : ' days') + '</span>';
    if (!a.ok) return '<span class="pill lock">' + lockSvg(11) + ' Premium</span>';
    if (read) return '<span class="pill read">Read</span>';
    if (Date.now() - ep.publishedAt < 7 * DAY) return '<span class="pill new">' + (a.why === 'sub' ? 'Early access' : 'New') + '</span>';
    return '<span class="pill free">Free</span>';
  }
  function lockSvg(size) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 10V7.5a5 5 0 0 1 10 0V10h1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1zm2 0h6V7.5a3 3 0 0 0-6 0z"/></svg>';
  }
  function isRead(ep) { return state.history.some(function (h) { return h.series === ep.series && h.number === ep.number; }); }
  function thumbStyle(s, n) { return 'background:' + rays((20 + (n * 17) % 60) + '% 70%', .18) + 'linear-gradient(' + (120 + n * 14) + 'deg,' + s.base[0] + ',' + s.base[1] + ')'; }

  var ICON = {
    search: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.8-4.8"/></svg>',
    library: '<svg width="22" height="22" viewBox="0 0 24 24" fill="#111" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v17.2a.6.6 0 0 1-1 .45L12 17l-6 4.65a.6.6 0 0 1-1-.45V4a1 1 0 0 1 1-1z"/></svg>',
    home: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3 3 10.5V21h6v-6h6v6h6V10.5z"/></svg>',
    star: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 2.5 2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z"/></svg>',
    close: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19"/></svg>',
    plus: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    check: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    arrow: '<svg width="20" height="20" viewBox="0 0 24 24" stroke="#D91E1E" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M9 15l6-6M10 9h5v5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  /* ---------- shell ---------- */
  function burstPoints() {
    var pts = [];
    for (var i = 0; i < 28; i++) {
      var r = i % 2 ? 36 : 49, a = (i * Math.PI) / 14;
      pts.push((50 + r * Math.cos(a)).toFixed(1) + ',' + (50 + r * Math.sin(a)).toFixed(1));
    }
    return pts.join(' ');
  }

  function mountShell(active) {
    var head = $('#site-header');
    if (head) {
      var link = function (href, key, label) { return '<a href="' + href + '"' + (active === key ? ' class="active" aria-current="page"' : '') + '>' + label + '</a>'; };
      head.outerHTML =
        '<header class="header wrap">' +
          '<a href="index.html" class="logo" aria-label="Inkline home"><svg width="84" height="84" viewBox="0 0 100 100" aria-hidden="true"><polygon points="' + burstPoints() + '" fill="#FFD60A" stroke="#111" stroke-width="2.5" stroke-linejoin="round"/></svg><span class="logo-text">INK<small>LINE</small></span></a>' +
          '<nav class="nav" aria-label="Main">' + link('index.html', 'home', 'Home') + link('index.html#all', 'series', 'Series') + link('index.html#new', 'new', 'New Episodes') + link('library.html', 'library', 'Library') + link('subscribe.html', 'premium', 'Premium') + '</nav>' +
          '<div class="actions">' +
            '<button type="button" class="icon-btn" data-search aria-label="Search series">' + ICON.search + '</button>' +
            '<div class="auth-group" data-auth="out"><button type="button" class="link-btn" data-open="login">Login</button><button type="button" class="btn btn-sm" data-open="signup">Signup</button></div>' +
            '<div class="auth-group" data-auth="in" hidden><a href="account.html" class="avatar" data-avatar aria-label="Account settings"></a><span class="hello">Hi, <span data-user-name></span><span class="pro-pill" data-pro hidden>PRO</span></span><button type="button" class="link-btn" data-logout>Logout</button></div>' +
            '<a href="library.html" class="icon-btn" data-lib-link aria-label="Library">' + ICON.library + '<span class="badge" data-lib-badge hidden>0</span></a>' +
          '</div>' +
        '</header>';
    }
    var foot = $('#site-footer');
    if (foot) {
      foot.outerHTML =
        '<footer class="footer"><div class="wrap"><div><span class="footer-brand">INKLINE</span><p>Webtoons and comics, with new episodes every week.</p></div>' +
        '<nav aria-label="Footer"><a href="index.html">Home</a><a href="index.html#all">Series</a><a href="library.html">Library</a><a href="subscribe.html">Premium</a><a href="account.html">Account</a><a href="studio.html">Creator Studio</a><a href="admin.html">Admin</a></nav></div></footer>';
    }
    if (!document.body.classList.contains('reader-body')) {
      document.body.classList.add('has-bottom-nav');
      var bn = document.createElement('nav');
      bn.className = 'bottom-nav';
      bn.setAttribute('aria-label', 'Quick');
      var b = function (href, key, icon, label) { return '<a href="' + href + '"' + (active === key ? ' class="active" aria-current="page"' : '') + '>' + icon + label + '</a>'; };
      bn.innerHTML = b('index.html', 'home', ICON.home, 'Home') +
        '<button type="button" data-search>' + ICON.search.replace('stroke="#111"', 'stroke="currentColor"') + 'Search</button>' +
        b('library.html', 'library', ICON.library.replace('fill="#111"', 'fill="currentColor"'), 'Library') +
        b('subscribe.html', 'premium', ICON.star, 'Premium');
      document.body.appendChild(bn);
    }

    var overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.hidden = true;
    overlay.innerHTML = '<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlgTitle"><div class="dialog-head"><h2 id="dlgTitle"></h2><button type="button" class="close" data-close aria-label="Close">' + ICON.close + '</button></div><div data-dlg-body></div></div>';
    document.body.appendChild(overlay);
    var t = document.createElement('div');
    t.className = 'toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite');
    document.body.appendChild(t);

    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeDialog(); });
    document.addEventListener('click', function (e) {
      var o = e.target.closest('[data-open]');
      if (o) { e.preventDefault(); openAuth(o.dataset.open); }
      if (e.target.closest('[data-close]')) closeDialog();
      if (e.target.closest('[data-search]')) openSearch();
      if (e.target.closest('[data-logout]')) logout();
    });
    document.addEventListener('keydown', function (e) {
      if (overlay.hidden) return;
      if (e.key === 'Escape') closeDialog();
      if (e.key === 'Tab') {
        var f = Array.prototype.filter.call(overlay.querySelectorAll('button,input,select,textarea,a[href]'), function (el) { return el.offsetParent !== null && !el.disabled; });
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    });
    renderShell();
  }

  var listeners = [];
  function onChange(fn) { listeners.push(fn); }
  function changed() { save(); renderShell(); listeners.forEach(function (fn) { fn(); }); }

  function renderShell() {
    document.querySelectorAll('[data-auth=out]').forEach(function (el) { el.hidden = !!state.user; });
    document.querySelectorAll('[data-auth=in]').forEach(function (el) { el.hidden = !state.user; });
    document.querySelectorAll('[data-user-name]').forEach(function (el) { el.textContent = state.user ? state.user.name : ''; });
    document.querySelectorAll('[data-pro]').forEach(function (el) { el.hidden = !entitled(); });
    document.querySelectorAll('[data-avatar]').forEach(function (el) {
      if (!state.user) return;
      el.textContent = initials(state.user.name);
      el.style.background = state.user.color || '#D91E1E';
    });
    document.querySelectorAll('[data-lib-badge]').forEach(function (el) { el.hidden = !state.follows.length; el.textContent = state.follows.length; });
    document.querySelectorAll('[data-lib-link]').forEach(function (el) { el.setAttribute('aria-label', 'Library, following ' + state.follows.length + ' series'); });
  }

  /* ---------- dialog ---------- */
  var lastFocus = null, onClose = null;
  function openDialog(title, html, opts) {
    opts = opts || {};
    var overlay = $('.overlay');
    if (overlay.hidden) lastFocus = document.activeElement;
    $('#dlgTitle').textContent = title;
    $('[data-dlg-body]').innerHTML = html;
    $('.dialog').classList.toggle('wide', !!opts.wide);
    onClose = opts.onClose || null;
    overlay.hidden = false;
    document.body.classList.add('locked');
    setTimeout(function () { var f = overlay.querySelector(opts.focus || 'input,[data-dlg-body] button,.close'); if (f) f.focus(); }, 20);
    return $('[data-dlg-body]');
  }
  function closeDialog() {
    var overlay = $('.overlay');
    if (overlay.hidden) return;
    overlay.hidden = true;
    document.body.classList.remove('locked');
    var cb = onClose; onClose = null;
    if (cb) cb();
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }

  var toastTimer;
  function toast(msg) {
    var t = $('.toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2000);
  }

  /* ---------- auth ---------- */
  var pending = null;
  function requireLogin(then, reason) {
    if (state.user) return then();
    pending = then;
    openAuth('signup', reason);
  }
  function openAuth(mode, reason) {
    var signup = mode === 'signup';
    var body = openDialog(signup ? 'Create account' : 'Welcome back',
      (reason ? '<p class="note-line" style="margin:-6px 0 2px">' + esc(reason) + '</p>' : '') +
      '<form novalidate data-auth-form>' +
        (signup ? '<div class="field"><label for="fName">Name</label><input id="fName" type="text" autocomplete="name"></div>' : '') +
        '<div class="field"><label for="fEmail">Email</label><input id="fEmail" type="email" autocomplete="email" required></div>' +
        '<div class="field"><label for="fPass">Password</label><input id="fPass" type="password" autocomplete="' + (signup ? 'new-password' : 'current-password') + '" required minlength="8"></div>' +
        (signup ? '' : '<button type="button" class="switch" data-forgot style="align-self:flex-start;min-height:32px">Forgot password?</button>') +
        '<button type="submit" class="btn btn-block">' + (signup ? 'Sign up' : 'Log in') + '</button>' +
        '<button type="button" class="switch" data-switch>' + (signup ? 'Already have an account? Log in' : 'New here? Create an account') + '</button>' +
        '<p class="note">Demo only: nothing is sent anywhere. Your session stays in this browser.</p>' +
      '</form>',
      { onClose: function () { pending = null; } });
    var keep = pending;
    body.querySelector('[data-switch]').addEventListener('click', function () { pending = keep; openAuth(signup ? 'login' : 'signup', reason); pending = keep; });
    var forgot = body.querySelector('[data-forgot]');
    if (forgot) forgot.addEventListener('click', function () {
      var em = $('#fEmail').value;
      toast(em ? 'Reset link sent to ' + em + ' (demo)' : 'Enter your email first');
    });
    body.querySelector('[data-auth-form]').addEventListener('submit', function (e) {
      e.preventDefault();
      var name = $('#fName'), email = $('#fEmail'), pass = $('#fPass');
      if (name && !name.value.trim()) { name.focus(); toast('Please enter your name'); return; }
      if (!email.value || !email.checkValidity()) { email.focus(); toast('Please enter a valid email'); return; }
      if (pass.value.length < 8) { pass.focus(); toast('Password needs at least 8 characters'); return; }
      var n = (name && name.value.trim()) || email.value.split('@')[0];
      state.user = { name: n, email: email.value, role: 'reader', color: '#D91E1E', locale: 'en', twoFA: false, notify: { episodes: true, replies: true, product: false }, creator: null, joined: Date.now() };
      var next = keep;
      pending = null;
      closeDialog();
      changed();
      toast(signup ? 'Welcome to Inkline, ' + n + '!' : 'Welcome back, ' + n + '!');
      if (next) next();
    });
  }
  function logout() {
    state.user = null;
    changed();
    toast('You are logged out');
  }

  function initials(name) {
    var p = String(name || '?').trim().split(/\s+/);
    return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  }

  /* Page gate for signed-in-only and role-only pages. Returns true when the page may render. */
  function gate(el, need) {
    var u = state.user;
    var card = function (title, text, cta) {
      el.innerHTML = '<div class="gate"><div class="lock-card"><div class="lock-ico">' + lockSvg(32) + '</div><h1>' + title + '</h1><p>' + text + '</p>' + cta + '</div></div>';
    };
    if (!u) { card('Log in to continue', 'You need an Inkline account to see this page.', '<button type="button" class="btn btn-lg" data-open="login">Log in</button><button type="button" class="switch" data-open="signup">New here? Create an account</button>'); return false; }
    if (need === 'creator' && u.role === 'reader') { card('Creators only', 'The studio is for creators. Set up a creator profile with a pen name and you can publish your first series today.', '<a class="btn btn-lg" href="account.html#creator">Become a creator</a>'); return false; }
    if (need === 'admin' && u.role !== 'admin') { card('403 · Admins only', 'You don\'t have access to the admin area.', '<a class="btn btn-lg" href="account.html#demo">Switch role (demo)</a>'); return false; }
    if (need === 'admin' && !u.twoFA) { card('Turn on 2FA first', 'Admins must use two-factor authentication before opening the admin area.', '<a class="btn btn-lg" href="account.html#security">Set up 2FA</a>'); return false; }
    return true;
  }

  function audit(action, target, meta) {
    state.audit = state.audit || [];
    state.audit.unshift({ at: Date.now(), actor: state.user ? state.user.email : 'system', action: action, target: target, meta: meta || '' });
    state.audit = state.audit.slice(0, 200);
  }

  /* Small confirm dialog for destructive actions. */
  function confirmAction(title, text, label, then) {
    var body = openDialog(title, '<p style="margin:0;font-size:14px;line-height:1.6">' + text + '</p><div class="cta-row"><button type="button" class="btn btn-ink" data-yes style="flex:1">' + esc(label) + '</button><button type="button" class="btn btn-ghost" data-close style="flex:1">Cancel</button></div>', { focus: '[data-close]' });
    body.querySelector('[data-yes]').addEventListener('click', function () { closeDialog(); then(); });
  }

  /* ---------- search ---------- */
  function openSearch() {
    var body = openDialog('Search', '<div class="field"><label for="q" class="sr-only">Search by title, genre or creator</label><input id="q" type="search" placeholder="Title, genre or creator" autocomplete="off"></div><ul class="list search-results" data-results></ul>', { wide: true });
    var q = body.querySelector('#q'), out = body.querySelector('[data-results]'), timer;
    function run() {
      var term = q.value.trim().toLowerCase();
      var hits = SERIES.filter(function (s) {
        return !term || (s.title + ' ' + s.genres.join(' ') + ' ' + s.creator).toLowerCase().indexOf(term) > -1;
      });
      out.innerHTML = hits.length ? hits.map(function (s) {
        return '<li><a class="row" href="series.html?s=' + s.slug + '"><span class="thumb" style="' + thumbStyle(s, 3) + '"></span><span class="row-body"><p class="row-title">' + esc(s.title) + '</p><p class="row-sub">' + esc(s.genres.join(' · ')) + ' · by ' + esc(s.creator) + '</p></span>' + ICON.arrow + '</a></li>';
      }).join('') : '<li><p class="note-line" style="padding:16px 4px">No series match "' + esc(q.value) + '".</p></li>';
    }
    q.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, 150); });
    run();
  }

  /* ---------- follows ---------- */
  function isFollowing(slug) { return state.follows.indexOf(slug) > -1; }
  function toggleFollow(slug) {
    var s = bySlug(slug), on = isFollowing(slug);
    state.follows = on ? state.follows.filter(function (x) { return x !== slug; }) : state.follows.concat(slug);
    changed();
    if (!on) document.querySelectorAll('[data-lib-badge]').forEach(function (b) { b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); });
    toast(on ? 'Unfollowed ' + s.title : 'Following ' + s.title + '. Find it in your Library.');
  }

  /* ---------- series card ---------- */
  function seriesCard(s) {
    var on = isFollowing(s.slug), eps = episodes(s), latest = eps[eps.length - 1];
    return '<article class="book" data-slug="' + s.slug + '">' +
      '<div class="cover" style="background:' + s.bg + '">' +
        '<span class="cover-title" aria-hidden="true" style="color:' + s.ink + ';text-shadow:3px 3px 0 ' + inkShadow(s) + '">' + esc(s.cover) + '</span>' +
        '<span class="cover-tag" aria-hidden="true">' + (s.status === 'completed' ? 'COMPLETED' : 'EP. ' + latest.number) + '</span>' +
        '<a class="cover-hit" href="series.html?s=' + s.slug + '" aria-label="Open ' + esc(s.title) + '"></a>' +
        '<button type="button" class="plus' + (on ? ' added' : '') + '" data-follow="' + s.slug + '" aria-pressed="' + on + '" aria-label="' + (on ? 'Unfollow ' : 'Follow ') + esc(s.title) + '">' + (on ? ICON.check : ICON.plus) + '</button>' +
      '</div>' +
      '<div class="book-meta"><div style="min-width:0"><h3><a href="series.html?s=' + s.slug + '">' + esc(s.title.toUpperCase()) + '</a></h3><p class="dot-meta">' + esc(s.genres[0]) + ' · ' + s.views + ' views</p></div>' +
      '<a class="wish" href="read.html?s=' + s.slug + '&e=1" aria-label="Read episode 1 of ' + esc(s.title) + '">' + ICON.arrow + '</a></div>' +
    '</article>';
  }
  document.addEventListener('click', function (e) {
    var f = e.target.closest('[data-follow]');
    if (!f) return;
    var where = f.closest('[id]'), slug = f.dataset.follow;
    toggleFollow(slug);
    // lists re-render on change, so put focus back on the same button
    var again = where && document.getElementById(where.id) && document.getElementById(where.id).querySelector('[data-follow="' + slug + '"]');
    if (again) again.focus();
  });

  /* ---------- subscription (fake provider) ---------- */
  function subscribe(planCode) {
    var plan = PLANS.find(function (p) { return p.code === planCode; });
    var now = Date.now(), end = new Date(now);
    if (plan.interval === 'month') end.setMonth(end.getMonth() + 1); else end.setFullYear(end.getFullYear() + 1);
    var payments = (state.sub && state.sub.payments) || [];
    state.sub = { plan: plan.code, status: 'active', start: now, periodEnd: end.getTime(), nextPlan: null,
      payments: [{ at: now, amount: plan.priceMinor, status: 'Succeeded', txn: 'DEMO-' + Math.random().toString(36).slice(2, 10).toUpperCase() }].concat(payments) };
    changed();
  }
  function cancelSub() { state.sub.status = 'canceled'; changed(); }
  function resumeSub() { state.sub.status = 'active'; changed(); }
  function switchPlan(code) { state.sub.nextPlan = code === state.sub.plan ? null : code; changed(); }

  /* ---------- reading ---------- */
  function saveProgress(slug, number, pos) {
    state.progress[slug] = { number: number, pos: pos, at: Date.now() };
    state.history = state.history.filter(function (h) { return !(h.series === slug && h.number === number); });
    state.history.unshift({ series: slug, number: number, at: Date.now() });
    state.history = state.history.slice(0, 50);
    save();
  }
  function toggleLike(slug, number) {
    var k = slug + '#' + number, on = state.likes.indexOf(k) > -1;
    state.likes = on ? state.likes.filter(function (x) { return x !== k; }) : state.likes.concat(k);
    changed();
    return !on;
  }

  window.Inkline = {
    CONFIG: CONFIG, PLANS: PLANS, SERIES: SERIES, ICON: ICON, state: state,
    episodes: episodes, access: access, entitled: entitled, bySlug: bySlug,
    esc: esc, money: money, param: param, ago: ago, date: date, lockSvg: lockSvg, epPill: epPill, isRead: isRead, thumbStyle: thumbStyle, inkShadow: inkShadow,
    mountShell: mountShell, onChange: onChange, changed: changed, openDialog: openDialog, closeDialog: closeDialog, toast: toast,
    requireLogin: requireLogin, openAuth: openAuth, isFollowing: isFollowing, toggleFollow: toggleFollow, seriesCard: seriesCard,
    initials: initials, gate: gate, audit: audit, confirmAction: confirmAction, save: save,
    subscribe: subscribe, cancelSub: cancelSub, resumeSub: resumeSub, switchPlan: switchPlan, saveProgress: saveProgress, toggleLike: toggleLike
  };
})();
