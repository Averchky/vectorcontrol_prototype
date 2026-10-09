/* VCS3 prototype: business rules. One function per BR-xxx (output/.../prd/business-rules.md).
   Screens call these; they never inline rule logic. ⚙ values come from settings.config (D-019). */
window.VCS = window.VCS || {};
VCS.rules = (function () {
  'use strict';
  var S = function () { return VCS.store; };
  var cfg = function () { return VCS.store.config(); };

  // ---------- date helpers ----------
  function d(s) { var p = String(s).slice(0, 10).split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function iso(dt) { return dt.toISOString().slice(0, 10); }
  function addDays(s, n) { var x = d(s); x.setUTCDate(x.getUTCDate() + n); return iso(x); }
  function daysBetween(a, b) { return Math.round((d(b) - d(a)) / 86400000); } // b - a
  function addWorkingDays(s, n) { // DM-7: weekends only, no public holidays
    var x = d(s);
    while (n > 0) { x.setUTCDate(x.getUTCDate() + 1); var w = x.getUTCDay(); if (w !== 0 && w !== 6) n--; }
    return iso(x);
  }
  function minusMonths(s, m) { var x = d(s); x.setUTCMonth(x.getUTCMonth() - m); return iso(x); }
  function today() { return S().demoDate(); }
  function metres(a, b) {
    var lat = (a.latitude + b.latitude) / 2 * Math.PI / 180;
    var dy = (a.latitude - b.latitude) * 111320, dx = (a.longitude - b.longitude) * 111320 * Math.cos(lat);
    return Math.sqrt(dx * dx + dy * dy);
  }
  function err(field, message) { return { field: field, message: message }; }
  function blank(v) { return v === undefined || v === null || String(v).trim() === ''; }

  // ---------- BR-001: every Breeding Habitat found is removed on the spot ----------
  function BR001_habitatRemoved(h) { return h.isRemoved === true; }

  // ---------- BR-007: completed Inspection needs premises, officer, date/time, outcome ----------
  function BR007_validateVisit(v) {
    var e = [];
    if (blank(v.outcome)) e.push(err('outcome', 'Choose the visit outcome (BR-007).'));
    if (blank(v.visitedAt)) e.push(err('visitedAt', 'Enter the visit date and time (BR-007).'));
    else if (v.visitedAt.slice(0, 10) > today()) e.push(err('visitedAt', 'The visit cannot be after today (' + today() + ').'));
    return e;
  }

  // ---------- BR-008: each habitat needs type, location and a Larval Sample ID (+ BR-001) ----------
  function BR008_validateHabitats(habitats) {
    var e = [];
    if (!habitats.length) e.push(err('habitats', 'Add at least one Breeding Habitat (BR-008).'));
    var seen = {};
    habitats.forEach(function (h, i) {
      var n = i + 1;
      if (blank(h.habitatType)) e.push(err('h' + i + '-type', 'Habitat ' + n + ': choose the habitat type (BR-008).'));
      if (blank(h.habitatLocation) || h.habitatLocation.trim().length < 2) e.push(err('h' + i + '-loc', 'Habitat ' + n + ': describe where in the premises it was found (BR-008).'));
      if (!/^EH\d{2}-\d{5}$/.test(h.sampleNo || '')) e.push(err('h' + i + '-sample', 'Habitat ' + n + ': enter the Larval Sample ID in the format EH26-00123 (BR-008).'));
      else if (seen[h.sampleNo] || S().list('larvalSamples', function (s) { return s.sampleNo === h.sampleNo; }).length) e.push(err('h' + i + '-sample', 'Habitat ' + n + ': Larval Sample ID ' + h.sampleNo + ' is already used.'));
      seen[h.sampleNo] = true;
      if (!BR001_habitatRemoved(h)) e.push(err('h' + i + '-removed', 'Habitat ' + n + ': confirm the habitat was removed (BR-001).'));
    });
    return e;
  }

  // ---------- BR-009: positive Lab Result confirms breeding ----------
  function BR009_isConfirmed(sample) { return sample.status === 'Positive'; }

  // ---------- BR-010: approver must not be the drafter ----------
  function BR010_canApprove(notice, user) { return user.role === 'APPROVING_OFFICER' && notice.draftedBy !== user.id; }

  // ---------- BR-011 / BR-012 / BR-024: reasons are mandatory ----------
  function validateReason(reason, rule) {
    if (blank(reason) || reason.trim().length < 5) return [err('reason', 'Enter a reason of at least 5 characters (' + rule + ').')];
    return [];
  }
  function BR011_validateReturnReason(r) { return validateReason(r, 'BR-011'); }
  function BR012_isLocked(notice) { return ['Approved', 'Served', 'Withdrawn'].indexOf(notice.status) >= 0; }
  function BR024_validateReason(r) { return validateReason(r, 'BR-024'); }

  // ---------- BR-013: Composition Fine per Charge ----------
  function BR013_finePerCharge(premisesType, offenceCount) {
    if (offenceCount >= cfg().prosecutionFromOffence) return 0;
    var table = premisesType === 'Residential' ? cfg().fines.Residential : cfg().fines.NonResidential;
    return table[Math.min(offenceCount, table.length) - 1];
  }
  // ---------- BR-014: 3rd+ offence -> Notice to Abate (no fine), D-032 ----------
  function BR014_noticeType(offenceCount) {
    return offenceCount >= cfg().prosecutionFromOffence ? 'Notice to Abate' : 'Notice of Offence';
  }
  // ---------- BR-015: Offence Count = prior Inspections with confirmed breeding in look-back + 1 ----------
  function BR015_offenceCount(premisesId, visitDate, excludeInspectionId) {
    var from = minusMonths(visitDate, cfg().offenceLookbackMonths);
    var n = S().list('enforcementCases', function (c) {
      if (c.premisesId !== premisesId || c.status === 'Cancelled' || c.inspectionId === excludeInspectionId) return false; // BR-027
      var ins = S().get('inspections', c.inspectionId);
      var v = ins.visitedAt.slice(0, 10);
      return v >= from && v < visitDate;
    }).length;
    return n + 1;
  }

  // ---------- BR-017 / BR-018 / BR-019: Dengue Clusters (DM-5 single linkage) ----------
  function BR017_clusters() {
    var c = cfg(), t = today();
    var cases = S().list('dengueCases', function (x) { return x.onsetDate <= t; })
      .sort(function (a, b) { return a.onsetDate < b.onsetDate ? -1 : 1; });
    var parent = {};
    cases.forEach(function (x) { parent[x.id] = x.id; });
    function find(x) { while (parent[x] !== x) x = parent[x]; return x; }
    for (var i = 0; i < cases.length; i++) for (var j = i + 1; j < cases.length; j++) {
      var a = cases[i], b = cases[j];
      if (Math.abs(daysBetween(a.onsetDate, b.onsetDate)) <= c.clusterWindowDays && metres(a, b) <= c.clusterRadiusMetres) parent[find(b.id)] = find(a.id);
    }
    var groups = {};
    cases.forEach(function (x) { var r = find(x.id); (groups[r] = groups[r] || []).push(x); });
    var out = Object.keys(groups).map(function (k) { return groups[k]; })
      .filter(function (g) { return g.length >= c.clusterMinCases; })
      .sort(function (a, b) { return a[0].onsetDate < b[0].onsetDate ? -1 : 1; })
      .map(function (g, i) {
        var last = g.reduce(function (m, x) { return x.onsetDate > m ? x.onsetDate : m; }, '');
        var active = BR019_isActive(last);
        return {
          id: 'C-' + String(i + 1).padStart(3, '0'), cases: g, caseCount: g.length,
          firstOnset: g[0].onsetDate, lastOnset: last, postalCode: g[0].postalCode,
          status: active ? 'Active' : 'Closed', alertLevel: active ? BR018_alertLevel(g.length) : null
        };
      });
    return out;
  }
  function BR018_alertLevel(caseCount) { return caseCount >= cfg().redAlertMinCases ? 'Red' : 'Yellow'; }
  function BR019_isActive(lastOnset) { return daysBetween(lastOnset, today()) <= cfg().clusterWindowDays; }
  function clusterOfCase(caseId, clusters) {
    clusters = clusters || BR017_clusters();
    for (var i = 0; i < clusters.length; i++) if (clusters[i].cases.some(function (x) { return x.id === caseId; })) return clusters[i];
    return null;
  }

  // ---------- BR-016 (gives BR-006): High-Risk Premises and their reasons ----------
  function lastConfirmedBreeding(premisesId) { // DM-6: visit date; cancelled cases excluded
    var best = null;
    S().list('enforcementCases', function (c) { return c.premisesId === premisesId && c.status !== 'Cancelled'; }).forEach(function (c) {
      var v = S().get('inspections', c.inspectionId).visitedAt.slice(0, 10);
      if (!best || v > best) best = v;
    });
    return best;
  }
  function BR016_riskReasons(premises, clusters) {
    clusters = clusters || BR017_clusters();
    var r = [], c = cfg();
    clusters.forEach(function (k) {
      if (k.status === 'Active' && k.cases.some(function (x) { return metres(premises, x) <= c.clusterRadiusMetres; }))
        r.push({ code: 'cluster', text: 'In active cluster ' + k.id + ' (' + k.alertLevel + ')' });
    });
    var last = lastConfirmedBreeding(premises.id);
    if (last) { var ago = daysBetween(last, today()); if (ago >= 0 && ago <= c.highRiskBreedingDays) r.push({ code: 'breeding', text: 'Breeding confirmed ' + ago + ' days ago' }); }
    if (premises.premisesType === 'Construction Site') r.push({ code: 'construction', text: 'Construction site' });
    return r;
  }
  function BR006_highRiskPremises() {
    var clusters = BR017_clusters();
    return S().list('premises').map(function (p) { return { premises: p, reasons: BR016_riskReasons(p, clusters) }; })
      .filter(function (x) { return x.reasons.length; });
  }

  // ---------- BR-020: approval SLA ----------
  function BR020_approvalDue(submittedAt) { return addWorkingDays(submittedAt.slice(0, 10), cfg().approvalSlaWorkingDays); }
  function BR020_isApprovalOverdue(n) { return n.status === 'Pending Approval' && n.approvalDueAt < today(); }
  // ---------- BR-021: payment due and overdue ----------
  function BR021_paymentDue(servedAt) { return addDays(servedAt.slice(0, 10), cfg().paymentDueDays); }
  function BR021_isPaymentOverdue(c) { return c.status === 'Awaiting Payment' && c.paymentDueAt < today(); }
  // ---------- BR-022 / BR-026: follow-up dates ----------
  function BR022_reinspectionDue(servedAt) { return addDays(servedAt.slice(0, 10), cfg().reinspectionDays); }
  function BR026_revisitDue(visitedAt) { return addDays(visitedAt.slice(0, 10), cfg().revisitDays); }
  // ---------- BR-023 (amended D-033): close when paid and re-inspected (any outcome except No Access) ----------
  function BR023_reinspectionDone(c) {
    var done = S().list('inspections', function (i) {
      return i.enforcementCaseId === c.id && i.isReinspection && (i.status === 'Completed – No Breeding' || i.status === 'Completed – Breeding Found');
    });
    return done.length > 0;
  }
  // ---------- BR-025: Field Officer acts only on Inspections assigned to them ----------
  function BR025_canActOnInspection(user, ins) { return ins.assignedTo === user.id; }
  function BR025_visibleInspections(user) {
    return user.role === 'FIELD_OFFICER' ? S().list('inspections', function (i) { return i.assignedTo === user.id; }) : S().list('inspections');
  }
  // ---------- BR-027: cancel case only when the latest Notice is Withdrawn ----------
  function latestNotice(caseId) {
    var ns = S().list('notices', function (n) { return n.enforcementCaseId === caseId; });
    ns.sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : (a.id < b.id ? -1 : 1); });
    return ns[ns.length - 1] || null;
  }
  function BR027_canCancelCase(c) { var n = latestNotice(c.id); return c.status === 'Open' && n && n.status === 'Withdrawn'; }
  // ---------- BR-028: one Charge per positive habitat, each with the BR-013 fine ----------
  function BR028_buildCharges(positiveSamples, fine) {
    return positiveSamples.map(function (s, i) { return { chargeNo: i + 1, larvalSampleId: s.id, habitatType: s.habitatType, fineAmount: fine }; });
  }
  function BR028_total(charges) { return charges.reduce(function (t, c) { return t + c.fineAmount; }, 0); }

  // ---------- derived helpers for dashboards ----------
  function isInspectionOverdue(i) { return i.status === 'Assigned' && i.dueDate < today(); }
  function breedingFindingsSince(days) {
    var from = addDays(today(), -(days - 1));
    return S().list('larvalSamples', function (s) {
      if (s.status !== 'Positive') return false;
      var ins = S().get('inspections', s.inspectionId), v = ins.visitedAt.slice(0, 10);
      var c = S().list('enforcementCases', function (x) { return x.inspectionId === ins.id; })[0];
      return v >= from && v <= today() && !(c && c.status === 'Cancelled');
    });
  }
  // BR-005: statistics from e-filed (Served) Notices; withdrawn notices and cancelled cases excluded
  function BR005_statistics(month) {
    var served = S().list('notices', function (n) { return n.status === 'Served' && (!month || n.servedAt.slice(0, 7) === month); });
    var byType = {}, byMonth = {}, byPremisesType = {}, charges = 0, total = 0;
    served.forEach(function (n) {
      var c = S().get('enforcementCases', n.enforcementCaseId), p = S().get('premises', c.premisesId), m = n.servedAt.slice(0, 7);
      byType[n.noticeType] = (byType[n.noticeType] || 0) + 1;
      byMonth[m] = byMonth[m] || { notices: 0, charges: 0, total: 0 };
      byMonth[m].notices++; byMonth[m].charges += n.charges.length; byMonth[m].total += n.totalFine;
      byPremisesType[p.premisesType] = (byPremisesType[p.premisesType] || 0) + 1;
      charges += n.charges.length; total += n.totalFine;
    });
    var cases = {};
    S().list('enforcementCases', function (c) { return !month || c.createdAt.slice(0, 7) === month; }).forEach(function (c) { cases[c.status] = (cases[c.status] || 0) + 1; });
    return { notices: served.length, charges: charges, totalFine: total, byType: byType, byMonth: byMonth, byPremisesType: byPremisesType, casesByStatus: cases };
  }

  return {
    // date helpers
    addDays: addDays, addWorkingDays: addWorkingDays, daysBetween: daysBetween, today: today, metres: metres,
    // rules
    BR001_habitatRemoved: BR001_habitatRemoved, BR005_statistics: BR005_statistics, BR006_highRiskPremises: BR006_highRiskPremises,
    BR007_validateVisit: BR007_validateVisit, BR008_validateHabitats: BR008_validateHabitats, BR009_isConfirmed: BR009_isConfirmed,
    BR010_canApprove: BR010_canApprove, BR011_validateReturnReason: BR011_validateReturnReason, BR012_isLocked: BR012_isLocked,
    BR013_finePerCharge: BR013_finePerCharge, BR014_noticeType: BR014_noticeType, BR015_offenceCount: BR015_offenceCount,
    BR016_riskReasons: BR016_riskReasons, BR017_clusters: BR017_clusters, BR018_alertLevel: BR018_alertLevel, BR019_isActive: BR019_isActive,
    BR020_approvalDue: BR020_approvalDue, BR020_isApprovalOverdue: BR020_isApprovalOverdue,
    BR021_paymentDue: BR021_paymentDue, BR021_isPaymentOverdue: BR021_isPaymentOverdue,
    BR022_reinspectionDue: BR022_reinspectionDue, BR023_reinspectionDone: BR023_reinspectionDone,
    BR024_validateReason: BR024_validateReason, BR025_canActOnInspection: BR025_canActOnInspection, BR025_visibleInspections: BR025_visibleInspections,
    BR026_revisitDue: BR026_revisitDue, BR027_canCancelCase: BR027_canCancelCase, BR028_buildCharges: BR028_buildCharges, BR028_total: BR028_total,
    // derived
    clusterOfCase: clusterOfCase, latestNotice: latestNotice, isInspectionOverdue: isInspectionOverdue,
    breedingFindingsSince: breedingFindingsSince, lastConfirmedBreeding: lastConfirmedBreeding
  };
})();
