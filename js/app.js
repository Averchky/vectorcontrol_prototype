/* VCS3 prototype: app shell and shared UI helpers.
   Shell = prototype masthead (D-045), header (logo, role switcher, demo date, notifications, data menu), side nav by role (SCR-16, SCR-15). */
window.VCS = window.VCS || {};
VCS.app = (function () {
  'use strict';
  var S = VCS.store, R = VCS.rules, W = VCS.workflow;

  // ---------------------------------------------------------------- formatting
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtDate(s, withDay) {
    if (!s) return '—';
    var p = s.slice(0, 10).split('-'), dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return (withDay ? DAYS[dt.getUTCDay()] + ' ' : '') + (+p[2]) + ' ' + MONTHS[+p[1] - 1] + ' ' + p[0];
  }
  function fmtDateTime(s) { return s ? fmtDate(s) + ' ' + s.slice(11, 16) : '—'; }
  function money(n) { return '$' + Number(n || 0).toLocaleString('en-SG'); }
  function qs(name) { return new URLSearchParams(location.search).get(name); }
  function userName(id) { if (id === 'SYSTEM') return 'VCS3 (automatic)'; var u = S.get('users', id); return u ? u.name : id; }
  var ROLE_LABEL = { FIELD_OFFICER: 'Field Officer', APPROVING_OFFICER: 'Approving Officer', OPS_MANAGER: 'Operations Manager', SYSTEM: 'System' };

  // ---------------------------------------------------------------- status badges (design-system-v2.md)
  var BADGE = {
    'Assigned': 'info', 'Completed – No Breeding': 'success', 'Completed – Breeding Found': 'warning', 'No Access': 'accent',
    'Pending Lab': 'info', 'Positive': 'danger', 'Negative': 'success',
    'Draft': 'neutral', 'Pending Approval': 'info', 'Returned': 'warning', 'Approved': 'accent', 'Served': 'success',
    'Open': 'info', 'Awaiting Payment': 'warning', 'Awaiting Re-inspection': 'accent', 'Closed': 'success', 'Referred for Prosecution': 'danger'
  };
  function badge(status) {
    if (status === 'Cancelled' || status === 'Withdrawn') return '<span class="badge badge-neutral badge-strike">' + esc(status) + '</span>';
    return '<span class="badge badge-' + (BADGE[status] || 'neutral') + '">' + esc(status === 'Served' ? 'Served (e-filed)' : status) + '</span>';
  }
  function overdue(text) { return ' <span class="flag flag-overdue">' + esc(text || 'Overdue') + '</span>'; }
  function highRisk() { return ' <span class="flag flag-highrisk">High-risk</span>'; }
  function alertLevel(l) { return l ? '<span class="alert-level alert-' + l.toLowerCase() + '">' + l + '</span>' : '<span class="badge badge-neutral">Closed</span>'; }
  function simulated() { return '<span class="flag flag-simulated">Simulated feed</span>'; }

  // ---------------------------------------------------------------- links
  function link(entity, id, text) {
    var page = { Inspection: 'inspection.html', LarvalSample: 'inspection.html', Notice: 'notice.html', EnforcementCase: 'case.html', Premises: 'premises-detail.html' }[entity];
    if (entity === 'LarvalSample') { var s = S.get('larvalSamples', id); id = s ? s.inspectionId : id; }
    return '<a href="' + page + '?id=' + encodeURIComponent(id) + '">' + esc(text || id) + '</a>';
  }
  function premisesLink(pid) { var p = S.get('premises', pid); return p ? link('Premises', pid, p.address) : esc(pid); }

  // ---------------------------------------------------------------- navigation by role (screen-inventory.md)
  var NAV = {
    FIELD_OFFICER: [['my-work', 'My work'], ['inspections', 'Inspections'], ['notices', 'Notices'], ['cases', 'Enforcement cases'], ['premises', 'Premises']],
    APPROVING_OFFICER: [['my-work', 'My work'], ['notices', 'Notices'], ['cases', 'Enforcement cases'], ['premises', 'Premises'], ['statistics', 'Statistics']],
    OPS_MANAGER: [['index', 'Dashboard'], ['my-work', 'My work'], ['high-risk', 'High-risk premises'], ['inspections', 'Inspections'], ['notices', 'Notices'], ['cases', 'Enforcement cases'], ['premises', 'Premises'], ['surveillance', 'Dengue & surveillance'], ['statistics', 'Statistics']]
  };
  var LANDING = { FIELD_OFFICER: 'my-work.html', APPROVING_OFFICER: 'my-work.html', OPS_MANAGER: 'index.html' };
  var PARENT = { 'premises-detail': 'premises', inspection: 'inspections', notice: 'notices', 'case': 'cases' };

  // ---------------------------------------------------------------- shell
  function init(opts) {
    W.system.sweep(); // date-driven rules (BR-020, BR-021)
    var u = S.currentUser();
    if (opts.roles && opts.roles.indexOf(u.role) < 0) {
      document.getElementById('content').innerHTML = '<div class="empty-state"><div class="empty-icon" aria-hidden="true">🔒</div><h2>Not available for ' + esc(ROLE_LABEL[u.role]) + '</h2><p>This screen is for: ' + opts.roles.map(function (r) { return ROLE_LABEL[r]; }).join(', ') + '. Switch role in the header.</p><p><a class="btn btn-primary" href="' + LANDING[u.role] + '">Go to my landing page</a></p></div>';
      buildShell(opts.page); return;
    }
    buildShell(opts.page);
    if (opts.render) {
      try { opts.render(); } catch (e) {
        console.error(e);
        document.getElementById('content').innerHTML = '<div class="banner banner-danger" role="alert"><div><strong>Something went wrong</strong>' + esc(e.message) + '. Try <em>Reset demo data</em> from the ⋮ menu.</div></div>';
      }
    }
  }

  function buildShell(page) {
    var u = S.currentUser();
    var main = document.getElementById('main');
    var unread = S.list('notifications', function (n) { return n.userId === u.id && !n.isRead; }).length;
    var opts = S.list('users').map(function (x) {
      return '<option value="' + x.id + '"' + (x.id === u.id ? ' selected' : '') + '>' + esc(x.name) + ': ' + ROLE_LABEL[x.role] + '</option>';
    }).join('');
    var shellTop =
      '<a class="skip-link" href="#main">Skip to content</a>' +
      '<div class="proto-masthead" role="note"><strong>PROTOTYPE</strong><span>VCS3 internal mockup <span class="long">· not an official NEA system · synthetic data </span>· Simulated login</span></div>' +
      '<header class="app-header">' +
      '<button class="icon-btn nav-toggle" id="navToggle" aria-label="Menu" aria-expanded="false" aria-controls="appNav">☰</button>' +
      '<a class="app-brand" href="' + LANDING[u.role] + '"><img src="img/nea-logo.png" alt="National Environment Agency"><span class="product">VCS3<small>Vector Control System</small></span></a>' +
      '<span class="sim-label">Simulated login</span><span class="spacer"></span>' +
      '<button class="demo-date" id="demoDateBtn" type="button" title="Demo date: the simulated today (US-028)"><span aria-hidden="true">📅 </span><span class="sr-only">Demo date: </span>' + fmtDate(S.demoDate(), true) + '</button>' +
      '<div class="role-switcher"><label for="whoSel">Acting as</label><select id="whoSel">' + opts + '</select></div>' +
      '<button class="icon-btn" id="bellBtn" aria-haspopup="true" aria-expanded="false" aria-label="Notifications, ' + unread + ' unread"><span aria-hidden="true">🔔</span>' + (unread ? '<span class="count-badge" aria-hidden="true">' + unread + '</span>' : '') + '</button>' +
      '<button class="icon-btn" id="menuBtn" aria-haspopup="true" aria-expanded="false" aria-label="Demo data menu"><span aria-hidden="true">⋮</span></button>' +
      '</header>';
    var navItems = NAV[u.role].map(function (n) {
      var cur = (n[0] === page || PARENT[page] === n[0]) ? ' aria-current="page"' : '';
      return '<li><a href="' + n[0] + '.html"' + cur + '>' + esc(n[1]) + '</a></li>';
    }).join('');
    var wrapper = document.createElement('div');
    wrapper.innerHTML = shellTop;
    var body = document.createElement('div');
    body.className = 'app-body';
    body.innerHTML = '<nav class="app-nav" id="appNav" aria-label="Main"><ul>' + navItems + '</ul></nav>';
    document.body.insertBefore(body, main);
    body.appendChild(main);
    while (wrapper.firstChild) document.body.insertBefore(wrapper.firstChild, body);
    if (!document.querySelector('.toast-region')) {
      var tr = document.createElement('div'); tr.className = 'toast-region'; tr.setAttribute('aria-live', 'polite'); document.body.appendChild(tr);
    }
    if (!S.isPersistent()) toast('Browser storage is unavailable. Changes will not be kept after refresh.', true);

    document.getElementById('whoSel').addEventListener('change', function (e) {
      S.setCurrentUser(e.target.value);
      var nu = S.get('users', e.target.value);
      location.href = LANDING[nu.role];
    });
    document.getElementById('navToggle').addEventListener('click', function (e) {
      var nav = document.getElementById('appNav'), open = nav.classList.toggle('is-open');
      e.currentTarget.setAttribute('aria-expanded', open);
    });
    document.getElementById('bellBtn').addEventListener('click', function (e) { toggleDropdown(e.currentTarget, notificationsHtml, bindNotifications); });
    document.getElementById('menuBtn').addEventListener('click', function (e) { toggleDropdown(e.currentTarget, menuHtml, bindMenu); });
    document.getElementById('demoDateBtn').addEventListener('click', openDemoDate);
  }

  // ---------------------------------------------------------------- dropdowns (SCR-15 notifications, data menu)
  var openDd = null;
  function closeDropdown() {
    if (!openDd) return;
    openDd.el.remove(); openDd.btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', outside, true); document.removeEventListener('keydown', ddKey);
    var b = openDd.btn; openDd = null; return b;
  }
  function outside(e) { if (openDd && !openDd.el.contains(e.target) && !openDd.btn.contains(e.target)) closeDropdown(); }
  function ddKey(e) { if (e.key === 'Escape') { var b = closeDropdown(); if (b) b.focus(); } }
  function toggleDropdown(btn, htmlFn, bindFn) {
    var same = openDd && openDd.btn === btn;
    closeDropdown();
    if (same) return;
    var el = document.createElement('div');
    el.className = 'dropdown'; el.innerHTML = htmlFn();
    document.body.appendChild(el);
    btn.setAttribute('aria-expanded', 'true');
    openDd = { el: el, btn: btn };
    bindFn(el);
    setTimeout(function () { document.addEventListener('click', outside, true); document.addEventListener('keydown', ddKey); var f = el.querySelector('a,button'); if (f) f.focus(); }, 0);
  }
  function notificationsHtml() {
    var u = S.currentUser();
    var ns = S.list('notifications', function (n) { return n.userId === u.id; }).sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; }).slice(0, 25);
    var items = ns.length ? ns.map(function (n) {
      return '<li><button type="button" data-ntf="' + n.id + '" class="' + (n.isRead ? '' : 'unread') + '">' + esc(n.message) + '<time>' + fmtDateTime(n.createdAt) + (n.isRead ? '' : ' · unread') + '</time></button></li>';
    }).join('') : '<li><div class="empty-state" style="padding:16px">No notifications</div></li>';
    return '<div class="dropdown-head"><span>Notifications</span><button type="button" class="btn-link" id="markAll">Mark all read</button></div><ul>' + items + '</ul>';
  }
  function bindNotifications(el) {
    el.querySelector('#markAll').addEventListener('click', function () { S.markAllRead(S.currentUser().id); location.reload(); });
    el.querySelectorAll('[data-ntf]').forEach(function (b) {
      b.addEventListener('click', function () {
        var n = S.get('notifications', b.getAttribute('data-ntf'));
        S.markRead(n.id);
        var page = { Inspection: 'inspection.html', LarvalSample: 'inspection.html', Notice: 'notice.html', EnforcementCase: 'case.html' }[n.entity];
        var id = n.entity === 'LarvalSample' ? S.get('larvalSamples', n.entityId).inspectionId : n.entityId;
        location.href = page + '?id=' + encodeURIComponent(id);
      });
    });
  }
  function menuHtml() {
    return '<div class="dropdown-head"><span>Demo data</span></div><ul>' +
      '<li><button type="button" id="mReset">↺ Reset demo data</button></li>' +
      '<li><button type="button" id="mExport">⤓ Export JSON</button></li>' +
      '<li><button type="button" id="mImport">⤒ Import JSON</button></li>' +
      '<li><button type="button" id="mDate">📅 Set demo date</button></li>' +
      '<li><a href="index.html#guide">☰ Prototype guide and screen list</a></li></ul>' +
      '<input type="file" id="mFile" accept="application/json,.json" hidden>';
  }
  function bindMenu(el) {
    el.querySelector('#mReset').addEventListener('click', function () {
      closeDropdown();
      confirmModal('Reset demo data', '<p>This restores the original demo data (demo date Fri 9 Oct 2026) and removes every change made in this browser.</p>', 'Reset demo data', 'danger', function () {
        S.reset(); sessionStorage.setItem('vcs3.toast', 'Demo data reset to the 9 Oct 2026 baseline.'); location.reload();
      });
    });
    el.querySelector('#mExport').addEventListener('click', function () { S.export(); toast('Exported vcs3-db-' + S.demoDate() + '.json'); closeDropdown(); });
    el.querySelector('#mImport').addEventListener('click', function () { el.querySelector('#mFile').click(); });
    el.querySelector('#mFile').addEventListener('change', function (e) {
      var f = e.target.files[0]; if (!f) return;
      S.import(f, function (err) {
        closeDropdown();
        if (err) toast('Import failed: ' + err.message, true);
        else { sessionStorage.setItem('vcs3.toast', 'Imported ' + f.name + '.'); location.reload(); }
      });
    });
    el.querySelector('#mDate').addEventListener('click', function () { closeDropdown(); openDemoDate(); });
  }

  // ---------------------------------------------------------------- demo date (US-028, D-035)
  function openDemoDate() {
    var u = S.currentUser();
    if (u.role !== 'OPS_MANAGER') { toast('Only the Operations Manager can change the demo date. Switch to Chua Siew Hoon.', true); return; }
    var cur = S.demoDate();
    formModal({
      title: 'Set demo date',
      body: '<p class="muted">The demo date is the simulated "today". Moving it forward re-runs the date rules: approval SLA (BR-020), unpaid fines (BR-021), cluster closure (BR-019) and overdue inspections.</p>' +
        field('demoDate', 'Demo date', '<input class="input" type="date" id="demoDate" name="demoDate" value="' + cur + '" min="' + cur + '" required>', true, 'Forward only. Use Reset demo data to go back to 9 Oct 2026.') +
        '<div class="btn-group"><button type="button" class="btn btn-secondary" data-plus="1">+1 day</button><button type="button" class="btn btn-secondary" data-plus="4">+4 days</button><button type="button" class="btn btn-secondary" data-plus="14">+14 days</button></div>',
      submit: 'Set date',
      onOpen: function (m) {
        m.querySelectorAll('[data-plus]').forEach(function (b) {
          b.addEventListener('click', function () { m.querySelector('#demoDate').value = R.addDays(cur, +b.getAttribute('data-plus')); });
        });
      },
      onSubmit: function (v) {
        if (!v.demoDate) return [{ field: 'demoDate', message: 'Choose a date.' }];
        if (v.demoDate < cur) return [{ field: 'demoDate', message: 'The demo date can only move forward. Use Reset demo data to go back.' }];
        S.setDemoDate(v.demoDate);
        var changed = W.system.sweep();
        sessionStorage.setItem('vcs3.toast', 'Demo date set to ' + fmtDate(v.demoDate, true) + '.' + (changed ? ' ' + changed + ' case(s) referred: fine unpaid (BR-021).' : ''));
        location.reload();
      }
    });
  }

  // ---------------------------------------------------------------- toasts
  function toast(msg, isError) {
    var region = document.querySelector('.toast-region');
    if (!region) { region = document.createElement('div'); region.className = 'toast-region'; region.setAttribute('aria-live', 'polite'); document.body.appendChild(region); }
    var t = document.createElement('div');
    t.className = 'toast' + (isError ? ' is-error' : ''); t.setAttribute('role', isError ? 'alert' : 'status'); t.textContent = msg;
    region.appendChild(t);
    setTimeout(function () { t.remove(); }, isError ? 7000 : 5000);
  }
  function flushToast() { var m = sessionStorage.getItem('vcs3.toast'); if (m) { sessionStorage.removeItem('vcs3.toast'); toast(m); } }
  function notInScope(what) { toast((what ? what + ': ' : '') + 'Not in prototype scope.'); }

  // ---------------------------------------------------------------- modal with focus trap, Esc, focus return
  function field(id, label, control, required, hint) {
    return '<div class="field" data-field="' + id + '"><label for="' + id + '">' + esc(label) + (required ? ' <span class="req" aria-hidden="true">*</span>' : '') + '</label>' +
      control + (hint ? '<span class="hint" id="' + id + '-hint">' + esc(hint) + '</span>' : '') + '<span class="field-error" id="' + id + '-err" hidden></span></div>';
  }
  function showErrors(root, errors) {
    root.querySelectorAll('.field.has-error').forEach(function (f) { f.classList.remove('has-error'); });
    root.querySelectorAll('.field-error').forEach(function (e) { e.hidden = true; e.textContent = ''; });
    root.querySelectorAll('[aria-invalid]').forEach(function (e) { e.removeAttribute('aria-invalid'); });
    var summary = root.querySelector('.error-summary');
    var general = [];
    (errors || []).forEach(function (er) {
      var f = er.field && root.querySelector('[data-field="' + er.field + '"]');
      if (f) {
        f.classList.add('has-error');
        var span = f.querySelector('.field-error'); span.hidden = false; span.textContent = er.message;
        var ctl = f.querySelector('input,select,textarea'); if (ctl) { ctl.setAttribute('aria-invalid', 'true'); ctl.setAttribute('aria-describedby', span.id); }
      } else general.push(er.message);
    });
    if (summary) {
      if (errors && errors.length) {
        summary.hidden = false;
        summary.innerHTML = '<h2 tabindex="-1">Please fix ' + errors.length + ' problem' + (errors.length > 1 ? 's' : '') + '</h2><ul>' + errors.map(function (e) { return '<li>' + esc(e.message) + '</li>'; }).join('') + '</ul>';
        summary.querySelector('h2').focus();
      } else summary.hidden = true;
    } else if (general.length) toast(general.join(' '), true);
    if (!summary && errors && errors.length) { var first = root.querySelector('[aria-invalid="true"]'); if (first) first.focus(); }
  }
  function formModal(o) {
    var opener = document.activeElement;
    var back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="mTitle"><form novalidate>' +
      '<div class="modal-head"><h2 id="mTitle">' + esc(o.title) + '</h2><button type="button" class="icon-btn" data-close aria-label="Close">✕</button></div>' +
      '<div class="modal-body"><div class="error-summary" role="alert" hidden></div>' + o.body + '</div>' +
      '<div class="modal-foot"><button type="button" class="btn btn-secondary" data-close>Cancel</button>' +
      '<button type="submit" class="btn btn-' + (o.style || 'primary') + '">' + esc(o.submit) + '</button></div></form></div>';
    document.body.appendChild(back);
    var modal = back.querySelector('.modal'), form = back.querySelector('form');
    function close() { back.remove(); document.removeEventListener('keydown', key); if (opener && opener.focus) opener.focus(); }
    function key(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      if (e.key === 'Tab') {
        var f = modal.querySelectorAll('button:not([disabled]),input:not([hidden]),select,textarea,a[href]');
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', key);
    back.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', close); });
    back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = {};
      Array.prototype.forEach.call(form.elements, function (el) {
        if (!el.name) return;
        if (el.type === 'radio') { if (el.checked) v[el.name] = el.value; } else if (el.type === 'checkbox') v[el.name] = el.checked; else v[el.name] = el.value;
      });
      var errors = o.onSubmit(v);
      if (errors && errors.length) showErrors(modal, errors); else close();
    });
    if (o.onOpen) o.onOpen(modal);
    var focusEl = modal.querySelector('.modal-body input, .modal-body select, .modal-body textarea') || modal.querySelector('[type=submit]');
    focusEl.focus();
    return { close: close, el: modal };
  }
  function confirmModal(title, bodyHtml, submit, style, onYes) {
    return formModal({ title: title, body: bodyHtml, submit: submit, style: style, onSubmit: function () { onYes(); return []; } });
  }

  // ---------------------------------------------------------------- workflow action buttons (shared by detail pages)
  function renderActions(container, entity, rec, after) {
    var acts = W.actionsFor(entity, rec).filter(function (a) { return !a.t.form; });
    if (!acts.length) { container.innerHTML = ''; return; }
    var hints = [];
    acts.forEach(function (a) { if (!a.ok && hints.indexOf(a.reason) < 0) hints.push(a.reason); });
    container.innerHTML = acts.map(function (a, i) {
      return '<button type="button" class="btn btn-' + (a.t.style || 'secondary') + '" data-act="' + i + '"' + (a.ok ? '' : ' aria-disabled="true" aria-describedby="hint-' + hints.indexOf(a.reason) + '"') + '>' + esc(a.t.label) + '</button>';
    }).join('') + hints.map(function (h, i) { return '<p class="action-hint" id="hint-' + i + '">' + esc(h) + '</p>'; }).join('');
    container.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var a = acts[+b.getAttribute('data-act')];
        if (!a.ok) { toast(a.reason, true); return; }
        runAction(entity, rec, a.t, after);
      });
    });
  }
  function done(res, after) {
    if (!res.ok) return res.errors;
    sessionStorage.setItem('vcs3.toast', res.message);
    if (after) after(res); else location.reload();
    return [];
  }
  function runAction(entity, rec, t, after) {
    var run = function (input) { return done(S.transition(entity, rec.id, t.action, input), after); };
    var label = rec.noticeNo || rec.sampleNo || rec.id;
    if (t.modal === 'reason') {
      var reasonLabel = { 'return': 'Return reason', withdraw: 'Withdraw reason', cancel: 'Cancellation reason', cancelCase: 'Cancellation reason' }[t.action];
      var rule = { 'return': 'BR-011', withdraw: 'BR-012', cancel: 'BR-024', cancelCase: 'BR-027' }[t.action];
      formModal({
        title: t.label + ': ' + label, style: t.style === 'danger' ? 'danger' : 'primary', submit: t.label,
        body: (t.action === 'withdraw' ? '<p>Withdrawing cannot be undone. Afterwards, reissue a new notice, or an Approving Officer can cancel the case.</p>' : '') +
          (t.action === 'cancelCase' ? '<p>The case will no longer count as an offence or appear in statistics (BR-027). This cannot be undone.</p>' : '') +
          field('reason', reasonLabel, '<textarea class="textarea" id="reason" name="reason" maxlength="500" required aria-describedby="reason-hint"></textarea>', true, 'Required, at least 5 characters (' + rule + '). Recorded in the history.'),
        onSubmit: function (v) { return run({ reason: v.reason }); }
      });
    } else if (t.modal === 'serve') {
      formModal({
        title: 'Record service: ' + label, submit: 'Record service and e-file',
        body: '<p class="muted">Serving the notice e-files it automatically (BR-004), counts it in the statistics (BR-005), schedules a re-inspection in 7 days (BR-022) and, for a Notice of Offence, sets payment due in 14 days (BR-021).</p>' +
          field('servedDate', 'Date of service', '<input class="input" type="date" id="servedDate" name="servedDate" value="' + S.demoDate() + '" max="' + S.demoDate() + '" required>', true) +
          field('serviceMethod', 'Service method', '<select class="select" id="serviceMethod" name="serviceMethod" required><option value="">Choose…</option><option>By hand</option><option>Registered post</option><option>Affixed at premises</option></select>', true),
        onSubmit: function (v) { return run(v); }
      });
    } else if (t.modal === 'payment') {
      formModal({
        title: 'Record payment: ' + rec.id, submit: 'Record payment',
        body: '<div class="banner banner-info"><div><strong>Simulated payment (D-036)</strong>In VCS3 this would come from the payment system. Here the Operations Manager records it.</div></div>' +
          '<p>Composition fine total: <strong>' + money(totalFineForCase(rec)) + '</strong> · due ' + fmtDate(rec.paymentDueAt) + '</p>' +
          '<p class="muted">' + (R.BR023_reinspectionDone(rec) ? 'The re-inspection is already done, so the case will close (BR-023).' : 'The case will close once the re-inspection is completed (BR-023).') + '</p>',
        onSubmit: function () { return run({}); }
      });
    } else if (t.modal === 'reassign') {
      formModal({
        title: 'Reassign inspection ' + rec.id, submit: 'Reassign',
        body: field('assignedTo', 'Field Officer', officerSelect(rec.assignedTo), true) +
          field('dueDate', 'Due date', '<input class="input" type="date" id="dueDate" name="dueDate" value="' + rec.dueDate + '" min="' + S.demoDate() + '" required>', true),
        onSubmit: function (v) { return run(v); }
      });
    } else if (t.modal === 'lab') {
      labModal(rec, after);
    } else {
      var msgs = {
        submit: 'Submit Notice ' + label + ' to the Approving Officers? Approval is due within 2 working days (BR-020).',
        approve: 'Approve Notice ' + label + '? Once approved it is locked and cannot be edited (BR-012).',
        resubmit: 'Resubmit Notice ' + label + ' for approval? The approval SLA restarts (BR-020).',
        reissue: 'Draft a new notice to replace ' + label + '? Charges are rebuilt from every positive sample (BR-028).'
      };
      confirmModal(t.label, '<p>' + esc(msgs[t.action] || 'Continue?') + '</p>', t.label, 'primary', function () {
        var errs = run({}); if (errs && errs.length) toast(errs.map(function (e) { return e.message; }).join(' '), true);
      });
    }
  }
  function labModal(sample, after) {
    var species = ['Aedes aegypti', 'Aedes albopictus', 'Culex spp.', 'Other mosquito'];
    formModal({
      title: 'Lab result: sample ' + sample.sampleNo, submit: 'Record lab result',
      body: '<div class="banner banner-info"><div><strong>Simulated lab (D-036)</strong>The Field Officer enters the result the lab reported.</div></div>' +
        '<p><strong>' + esc(sample.habitatType) + '</strong>, ' + esc(sample.habitatLocation) + '</p>' +
        '<div class="field" data-field="result"><fieldset style="border:0;padding:0;margin:0"><legend>Result <span class="req" aria-hidden="true">*</span></legend><div class="choice-group">' +
        '<label class="choice"><input type="radio" name="result" value="Positive"> Positive: mosquito larvae</label>' +
        '<label class="choice"><input type="radio" name="result" value="Negative"> Negative</label></div></fieldset><span class="field-error" id="result-err" hidden></span></div>' +
        field('species', 'Species (if positive)', '<select class="select" id="species" name="species"><option value="">Choose…</option>' + species.map(function (s) { return '<option>' + s + '</option>'; }).join('') + '</select>', false, 'A positive result confirms breeding (BR-009) and opens or adds to the enforcement case (BR-028).'),
      onSubmit: function (v) {
        var res = S.transition('LarvalSample', sample.id, 'recordLabResult', v);
        if (!res.ok) return res.errors;
        sessionStorage.setItem('vcs3.toast', res.message);
        if (after) after(res); else location.reload();
        return [];
      }
    });
  }
  function officerSelect(selected, id) {
    return '<select class="select" id="' + (id || 'assignedTo') + '" name="assignedTo" required><option value="">Choose…</option>' +
      S.list('users', function (u) { return u.role === 'FIELD_OFFICER'; }).map(function (u) {
        var load = S.list('inspections', function (i) { return i.assignedTo === u.id && i.status === 'Assigned'; }).length;
        return '<option value="' + u.id + '"' + (u.id === selected ? ' selected' : '') + '>' + esc(u.name) + ' (' + load + ' open)</option>';
      }).join('') + '</select>';
  }
  function totalFineForCase(c) {
    var ns = S.list('notices', function (n) { return n.enforcementCaseId === c.id && n.status === 'Served'; });
    return ns.length ? ns[ns.length - 1].totalFine : 0;
  }

  // SCR-07: Assign inspection
  function assignModal(premisesId) {
    var hr = {};
    R.BR006_highRiskPremises().forEach(function (x) { hr[x.premises.id] = true; });
    var prem = S.list('premises').slice().sort(function (a, b) { return (hr[b.id] ? 1 : 0) - (hr[a.id] ? 1 : 0) || (a.address < b.address ? -1 : 1); });
    formModal({
      title: 'Assign inspection', submit: 'Assign inspection',
      body: field('premisesId', 'Premises', '<select class="select" id="premisesId" name="premisesId" required><option value="">Choose…</option>' +
        prem.map(function (p) { return '<option value="' + p.id + '"' + (p.id === premisesId ? ' selected' : '') + '>' + (hr[p.id] ? '▲ ' : '') + esc(p.address) + '</option>'; }).join('') + '</select>', true, '▲ = High-risk premises (BR-016)') +
        field('assignedTo', 'Field Officer', officerSelect(''), true) +
        field('dueDate', 'Due date', '<input class="input" type="date" id="dueDate" name="dueDate" value="' + R.addWorkingDays(S.demoDate(), 2) + '" min="' + S.demoDate() + '" required>', true),
      onSubmit: function (v) {
        var res = S.transition('Inspection', null, 'assign', v);
        if (!res.ok) return res.errors;
        sessionStorage.setItem('vcs3.toast', res.message); location.reload(); return [];
      }
    });
  }

  // ---------------------------------------------------------------- audit timeline (BR-024, US-027)
  function timeline(pairs) {
    var entries = S.auditFor(pairs);
    if (!entries.length) return '<p class="muted">No history yet.</p>';
    var labels = { Inspection: 'Inspection', LarvalSample: 'Sample', Notice: 'Notice', EnforcementCase: 'Case' };
    return '<ol class="timeline">' + entries.slice().reverse().map(function (a) {
      var ref = a.entity === 'Notice' ? (S.get('notices', a.entityId) || {}).noticeNo : a.entity === 'LarvalSample' ? (S.get('larvalSamples', a.entityId) || {}).sampleNo : a.entityId;
      return '<li><div class="tl-action">' + esc(a.action) + ' <span class="muted">· ' + labels[a.entity] + ' ' + esc(ref) + '</span></div>' +
        '<div class="tl-meta">' + (a.fromStatus ? esc(a.fromStatus) + ' → ' : '') + esc(a.toStatus) + ' · ' + esc(userName(a.actorId)) + ' · ' + ROLE_LABEL[a.actorRole] + ' · ' + fmtDateTime(a.timestamp) + '</div>' +
        (a.comment ? '<div class="tl-comment">' + esc(a.comment) + '</div>' : '') + '</li>';
    }).join('') + '</ol>';
  }

  // ---------------------------------------------------------------- table helper (stacked cards on phones)
  function table(cols, rows, emptyMsg) {
    if (!rows.length) return '<div class="empty-state"><div class="empty-icon" aria-hidden="true">✓</div><h3>' + esc(emptyMsg || 'Nothing to show') + '</h3></div>';
    return '<div class="table-wrap"><table class="table table-stack"><thead><tr>' +
      cols.map(function (c) { return '<th scope="col"' + (c.num ? ' class="num"' : '') + '>' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr>' + cols.map(function (c) { return '<td data-label="' + esc(c.label) + '"' + (c.num ? ' class="num"' : '') + '>' + c.html(r) + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table></div>';
  }
  function matches(text, q) { return !q || String(text).toLowerCase().indexOf(q.toLowerCase()) >= 0; }

  document.addEventListener('DOMContentLoaded', flushToast);

  return {
    init: init, esc: esc, fmtDate: fmtDate, fmtDateTime: fmtDateTime, money: money, qs: qs, userName: userName, ROLE_LABEL: ROLE_LABEL,
    badge: badge, overdue: overdue, highRisk: highRisk, alertLevel: alertLevel, simulated: simulated, link: link, premisesLink: premisesLink,
    toast: toast, notInScope: notInScope, field: field, showErrors: showErrors, formModal: formModal, confirmModal: confirmModal,
    renderActions: renderActions, assignModal: assignModal, labModal: labModal, timeline: timeline, table: table, matches: matches
  };
})();
