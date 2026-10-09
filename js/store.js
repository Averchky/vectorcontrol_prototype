/* VCS3 prototype: data store (persistence option A, D-042).
   Loads window.SEED (data/seed.js) into localStorage["vcs3.store.v1"] on first run.
   Screens never touch localStorage directly; everything goes through VCS.store. */
window.VCS = window.VCS || {};
VCS.store = (function () {
  'use strict';
  var KEY = 'vcs3.store.v1';
  var SESSION_KEY = 'vcs3.session';
  var PREFIX = {
    users: 'USR', ownerOccupiers: 'OOC', premises: 'PRM', inspections: 'INS', larvalSamples: 'LS',
    enforcementCases: 'ENF', notices: 'NTC', dengueCases: 'DGC', surveillanceReadings: 'SVR',
    notifications: 'NTF', auditLog: 'AUD'
  };
  var STAMPED = { inspections: 1, larvalSamples: 1, enforcementCases: 1, notices: 1 };
  var db = null;
  var persistent = true;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      db = raw ? JSON.parse(raw) : clone(window.SEED);
      if (!raw) save();
    } catch (e) {
      persistent = false;
      db = clone(window.SEED);
    }
  }
  function save() {
    if (!persistent) return;
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { persistent = false; }
  }

  // ---------- session (current user) ----------
  function session() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || {}; } catch (e) { return {}; }
  }
  function currentUser() {
    var s = session();
    return get('users', s.userId) || get('users', 'USR-0006');
  }
  function setCurrentUser(userId) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: userId })); } catch (e) { /* in-memory only */ }
  }

  // ---------- time: the demo date plus the real SGT time of day ----------
  function demoDate() { return db.settings.demoDate; }
  function now() {
    var sgt = new Date(Date.now() + 8 * 3600 * 1000);
    var hh = String(sgt.getUTCHours()).padStart(2, '0');
    var mm = String(sgt.getUTCMinutes()).padStart(2, '0');
    var ss = String(sgt.getUTCSeconds()).padStart(2, '0');
    return demoDate() + 'T' + hh + ':' + mm + ':' + ss + '+08:00';
  }

  // ---------- CRUD ----------
  function list(coll, fn) { var a = db[coll] || []; return fn ? a.filter(fn) : a.slice(); }
  function get(coll, id) {
    var a = db[coll] || [];
    for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i];
    return null;
  }
  function nextId(coll) {
    var p = PREFIX[coll], width = coll === 'auditLog' ? 5 : 4, max = 0;
    (db[coll] || []).forEach(function (r) {
      var n = parseInt(String(r.id).split('-')[1], 10);
      if (n > max) max = n;
    });
    return p + '-' + String(max + 1).padStart(width, '0');
  }
  function create(coll, rec) {
    rec = clone(rec);
    rec.id = rec.id || nextId(coll);
    if (STAMPED[coll]) {
      var by = actorId();
      rec.createdAt = rec.createdAt || now(); rec.createdBy = rec.createdBy || by;
      rec.updatedAt = rec.createdAt; rec.updatedBy = rec.createdBy;
    }
    db[coll].push(rec);
    save();
    return rec;
  }
  function update(coll, id, patch, opts) {
    var r = get(coll, id);
    if (!r) throw new Error(coll + ' ' + id + ' not found');
    Object.keys(patch).forEach(function (k) {
      if (patch[k] === undefined) delete r[k]; else r[k] = patch[k];
    });
    if (STAMPED[coll]) { r.updatedAt = now(); r.updatedBy = (opts && opts.system) ? 'SYSTEM' : actorId(); }
    save();
    return r;
  }
  function actorId() { var u = currentUser(); return u ? u.id : 'SYSTEM'; }

  // ---------- audit and notifications ----------
  // BR-024: append-only audit entry for every status change
  function audit(entity, entityId, action, fromStatus, toStatus, comment, system) {
    var u = currentUser();
    var e = {
      id: nextId('auditLog'), entity: entity, entityId: entityId, action: action,
      fromStatus: fromStatus === undefined ? null : fromStatus, toStatus: toStatus,
      actorId: system ? 'SYSTEM' : u.id, actorRole: system ? 'SYSTEM' : u.role, timestamp: now()
    };
    if (comment) e.comment = String(comment).slice(0, 500);
    db.auditLog.push(e);
    save();
    return e;
  }
  function auditFor(pairs) {
    // pairs: [[entity, id], ...] -> entries, oldest first
    var keys = {};
    pairs.forEach(function (p) { keys[p[0] + '|' + p[1]] = true; });
    return db.auditLog.filter(function (a) { return keys[a.entity + '|' + a.entityId]; })
      .sort(function (a, b) { return a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : (a.id < b.id ? -1 : 1); });
  }
  function notify(userId, message, entity, entityId) {
    db.notifications.push({
      id: nextId('notifications'), userId: userId, message: message.slice(0, 200), entity: entity,
      entityId: entityId, createdAt: now(), isRead: false
    });
    save();
  }
  function markRead(id) { var n = get('notifications', id); if (n) { n.isRead = true; save(); } }
  function markAllRead(userId) {
    db.notifications.forEach(function (n) { if (n.userId === userId) n.isRead = true; });
    save();
  }

  // ---------- settings ----------
  function settings() { return db.settings; }
  function config() { return db.settings.config; }
  function setDemoDate(d) { db.settings.demoDate = d; save(); }

  // ---------- transition: delegates to the workflow engine ----------
  function transition(entity, id, action, input) { return VCS.workflow.execute(entity, id, action, input || {}); }

  // ---------- reset / export / import ----------
  function reset() { db = clone(window.SEED); persistent = true; save(); }
  function exportJson() {
    var blob = new Blob([JSON.stringify(db, null, 1)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'vcs3-db-' + demoDate() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function importJson(file, done) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        var required = Object.keys(window.SEED);
        var missing = required.filter(function (k) { return !(k in data); });
        if (missing.length) throw new Error('Missing collections: ' + missing.join(', '));
        db = data; save(); done(null);
      } catch (e) { done(e); }
    };
    reader.onerror = function () { done(new Error('Could not read the file')); };
    reader.readAsText(file);
  }

  load();
  return {
    list: list, get: get, create: create, update: update, transition: transition,
    audit: audit, auditFor: auditFor, notify: notify, markRead: markRead, markAllRead: markAllRead,
    settings: settings, config: config, demoDate: demoDate, setDemoDate: setDemoDate, now: now,
    currentUser: currentUser, setCurrentUser: setCurrentUser,
    reset: reset, export: exportJson, import: importJson,
    isPersistent: function () { return persistent; }
  };
})();
