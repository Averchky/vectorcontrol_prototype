/* VCS3 prototype: workflow engine. Transitions are data (artifacts/diagrams/workflow-*.md).
   canTransition() decides which buttons appear; execute() runs guards (VCS.rules), side effects,
   the audit entry (BR-024) and notifications. Automatic (SYSTEM) transitions live in system{}. */
window.VCS = window.VCS || {};
VCS.workflow = (function () {
  'use strict';
  var S = function () { return VCS.store; };
  var R = function () { return VCS.rules; };
  var ROLE = { FO: 'FIELD_OFFICER', AO: 'APPROVING_OFFICER', OM: 'OPS_MANAGER' };

  function yes() { return { ok: true }; }
  function no(reason, show) { return { ok: false, reason: reason, show: !!show }; }
  function hasRole(user, role) { return user.role === role; }
  function users(role) { return S().list('users', function (u) { return u.role === role; }); }
  function inspectionOf(sampleOrCase) { return S().get('inspections', sampleOrCase.inspectionId); }
  function caseOf(notice) { return S().get('enforcementCases', notice.enforcementCaseId); }
  function isDrafter(user, n) { return n.draftedBy === user.id; }
  function at(dateStr) { return dateStr + S().now().slice(10); } // a chosen date with the current time

  // ---------------------------------------------------------------- transition table
  var T = [
    // ----- Inspection (workflow-inspection.md)
    { entity: 'Inspection', action: 'reassign', label: 'Reassign', style: 'secondary', from: ['Assigned'], to: 'Assigned', modal: 'reassign',
      who: function (u) { return hasRole(u, ROLE.OM) ? yes() : no(); } },
    { entity: 'Inspection', action: 'cancel', label: 'Cancel inspection', style: 'danger', from: ['Assigned'], to: 'Cancelled', modal: 'reason',
      who: function (u) { return hasRole(u, ROLE.OM) ? yes() : no(); } },
    { entity: 'Inspection', action: 'completeNoBreeding', label: 'Complete – no breeding', from: ['Assigned'], to: 'Completed – No Breeding', form: true,
      who: function (u, r) { return R().BR025_canActOnInspection(u, r) ? yes() : no('Only the assigned officer can record this visit (BR-025).', u.role === ROLE.FO); } },
    { entity: 'Inspection', action: 'completeBreeding', label: 'Complete – breeding found', from: ['Assigned'], to: 'Completed – Breeding Found', form: true,
      who: function (u, r) { return R().BR025_canActOnInspection(u, r) ? yes() : no(); } },
    { entity: 'Inspection', action: 'noAccess', label: 'Record no access', from: ['Assigned'], to: 'No Access', form: true,
      who: function (u, r) { return R().BR025_canActOnInspection(u, r) ? yes() : no(); } },
    // ----- Larval Sample (workflow-larval-sample.md); simulated lab, D-036
    { entity: 'LarvalSample', action: 'recordLabResult', label: 'Record lab result', from: ['Pending Lab'], to: 'Positive | Negative', modal: 'lab',
      who: function (u, r) { return inspectionOf(r).assignedTo === u.id ? yes() : no('Only the inspecting officer enters lab results (D-036).', false); } },
    // ----- Notice (workflow-notice.md)
    { entity: 'Notice', action: 'submit', label: 'Submit for approval', style: 'primary', from: ['Draft'], to: 'Pending Approval', confirm: true,
      who: function (u, r) { return isDrafter(u, r) ? yes() : no(); } },
    { entity: 'Notice', action: 'approve', label: 'Approve', style: 'primary', from: ['Pending Approval'], to: 'Approved', confirm: true,
      who: function (u, r) {
        if (!hasRole(u, ROLE.AO)) return no();
        return R().BR010_canApprove(r, u) ? yes() : no('You drafted this notice, so another Approving Officer must approve or return it (BR-010).', true);
      } },
    { entity: 'Notice', action: 'return', label: 'Return', style: 'secondary', from: ['Pending Approval'], to: 'Returned', modal: 'reason',
      who: function (u, r) {
        if (!hasRole(u, ROLE.AO)) return no();
        return R().BR010_canApprove(r, u) ? yes() : no('You drafted this notice, so another Approving Officer must approve or return it (BR-010).', true);
      } },
    { entity: 'Notice', action: 'resubmit', label: 'Resubmit', style: 'primary', from: ['Returned'], to: 'Pending Approval', confirm: true,
      who: function (u, r) { return isDrafter(u, r) ? yes() : no(); } },
    { entity: 'Notice', action: 'serve', label: 'Record service', style: 'primary', from: ['Approved'], to: 'Served', modal: 'serve',
      who: function (u, r) { return (isDrafter(u, r) || hasRole(u, ROLE.FO)) ? yes() : no(); } },
    { entity: 'Notice', action: 'withdraw', label: 'Withdraw', style: 'danger', from: ['Draft', 'Returned', 'Approved'], to: 'Withdrawn', modal: 'reason',
      who: function (u, r) {
        if (r.status === 'Approved') return hasRole(u, ROLE.AO) ? yes() : no();
        return isDrafter(u, r) ? yes() : no();
      } },
    { entity: 'Notice', action: 'reissue', label: 'Reissue notice', style: 'primary', from: ['Withdrawn'], to: '(new) Draft', confirm: true,
      who: function (u, r) {
        var c = caseOf(r), latest = R().latestNotice(c.id);
        if (c.status !== 'Open' || !latest || latest.id !== r.id) return no();
        return (hasRole(u, ROLE.FO) && (isDrafter(u, r) || inspectionOf(c).assignedTo === u.id)) ? yes() : no();
      } },
    // ----- Enforcement Case (workflow-enforcement-case.md)
    { entity: 'EnforcementCase', action: 'recordPayment', label: 'Record payment', style: 'primary', from: ['Awaiting Payment'], to: 'Awaiting Re-inspection | Closed', modal: 'payment',
      who: function (u) { return hasRole(u, ROLE.OM) ? yes() : no(); } },
    { entity: 'EnforcementCase', action: 'cancelCase', label: 'Cancel case', style: 'danger', from: ['Open'], to: 'Cancelled', modal: 'reason',
      who: function (u, r) {
        if (!hasRole(u, ROLE.AO)) return no();
        return R().BR027_canCancelCase(r) ? yes() : no();
      } }
  ];

  var COLL = { Inspection: 'inspections', LarvalSample: 'larvalSamples', Notice: 'notices', EnforcementCase: 'enforcementCases' };

  function find(entity, action) { for (var i = 0; i < T.length; i++) if (T[i].entity === entity && T[i].action === action) return T[i]; return null; }

  // Returns {ok, reason, show}
  function canTransition(user, entity, record, action) {
    var t = find(entity, action);
    if (!t || t.from.indexOf(record.status) < 0) return no();
    return t.who(user, record);
  }
  // Every action the current user can see on a record (enabled, or disabled with a reason)
  function actionsFor(entity, record) {
    var u = S().currentUser();
    return T.filter(function (t) { return t.entity === entity && t.from.indexOf(record.status) >= 0; })
      .map(function (t) { var c = t.who(u, record); return { t: t, ok: c.ok, show: c.ok || c.show, reason: c.reason }; })
      .filter(function (x) { return x.show; });
  }

  // ---------------------------------------------------------------- execute
  function execute(entity, id, action, input) {
    var u = S().currentUser();
    var rec = id ? S().get(COLL[entity], id) : null;
    if (action !== 'assign') {
      var check = canTransition(u, entity, rec, action);
      if (!check.ok) return { ok: false, errors: [{ field: null, message: check.reason || 'This action is not allowed for your role or this status.' }] };
    }
    var fn = EFFECTS[entity + '.' + action];
    return fn(rec, input, u);
  }

  function fail(errors) { return { ok: false, errors: errors }; }

  // ---------------------------------------------------------------- side effects
  var EFFECTS = {
    // SCR-07: Assign inspection (Operations Manager)
    'Inspection.assign': function (_, inp, u) {
      if (u.role !== ROLE.OM) return fail([{ field: null, message: 'Only the Operations Manager assigns inspections.' }]);
      var e = [];
      if (!inp.premisesId) e.push({ field: 'premisesId', message: 'Choose the premises.' });
      if (!inp.assignedTo) e.push({ field: 'assignedTo', message: 'Choose the Field Officer.' });
      if (!inp.dueDate) e.push({ field: 'dueDate', message: 'Enter the due date.' });
      else if (inp.dueDate < R().today()) e.push({ field: 'dueDate', message: 'The due date cannot be before today (' + R().today() + ').' });
      if (e.length) return fail(e);
      var ins = S().create('inspections', { premisesId: inp.premisesId, assignedTo: inp.assignedTo, dueDate: inp.dueDate, status: 'Assigned', isReinspection: false, isRevisit: false });
      S().audit('Inspection', ins.id, 'Assign inspection', null, 'Assigned');
      S().notify(inp.assignedTo, 'Inspection ' + ins.id + ' assigned to you', 'Inspection', ins.id);
      return { ok: true, id: ins.id, message: 'Inspection ' + ins.id + ' assigned to ' + S().get('users', inp.assignedTo).name + '.' };
    },
    'Inspection.reassign': function (r, inp) {
      var e = [];
      if (!inp.assignedTo) e.push({ field: 'assignedTo', message: 'Choose the Field Officer.' });
      if (!inp.dueDate) e.push({ field: 'dueDate', message: 'Enter the due date.' });
      if (inp.assignedTo === r.assignedTo && inp.dueDate === r.dueDate) e.push({ field: 'assignedTo', message: 'Change the officer or the due date.' });
      if (e.length) return fail(e);
      var prev = r.assignedTo;
      S().update('inspections', r.id, { assignedTo: inp.assignedTo, dueDate: inp.dueDate });
      S().audit('Inspection', r.id, 'Reassign', 'Assigned', 'Assigned', 'To ' + S().get('users', inp.assignedTo).name + ', due ' + inp.dueDate);
      if (prev !== inp.assignedTo) {
        S().notify(inp.assignedTo, 'Inspection ' + r.id + ' assigned to you', 'Inspection', r.id);
        S().notify(prev, 'Inspection ' + r.id + ' reassigned to another officer', 'Inspection', r.id);
      }
      return { ok: true, message: 'Inspection ' + r.id + ' reassigned.' };
    },
    'Inspection.cancel': function (r, inp) {
      var e = R().BR024_validateReason(inp.reason);
      if (e.length) return fail(e);
      S().update('inspections', r.id, { status: 'Cancelled', cancelReason: inp.reason.trim() });
      S().audit('Inspection', r.id, 'Cancel', 'Assigned', 'Cancelled', inp.reason.trim());
      S().notify(r.assignedTo, 'Inspection ' + r.id + ' was cancelled', 'Inspection', r.id);
      return { ok: true, message: 'Inspection ' + r.id + ' cancelled.' };
    },
    'Inspection.completeNoBreeding': function (r, inp) { return completeVisit(r, inp, 'Completed – No Breeding', 'Complete – no breeding'); },
    'Inspection.completeBreeding': function (r, inp) { return completeVisit(r, inp, 'Completed – Breeding Found', 'Complete – breeding found'); },
    'Inspection.noAccess': function (r, inp) { return completeVisit(r, inp, 'No Access', 'Record no access'); },

    // Larval Sample: simulated lab result (D-036)
    'LarvalSample.recordLabResult': function (r, inp) {
      var e = [];
      if (inp.result !== 'Positive' && inp.result !== 'Negative') e.push({ field: 'result', message: 'Choose Positive or Negative.' });
      if (inp.result === 'Positive' && !inp.species) e.push({ field: 'species', message: 'Choose the species found (BR-009).' });
      if (e.length) return fail(e);
      var patch = { status: inp.result, labResultAt: S().now() };
      if (inp.result === 'Positive') patch.species = inp.species;
      S().update('larvalSamples', r.id, patch);
      S().audit('LarvalSample', r.id, 'Record lab result – ' + inp.result.toLowerCase(), 'Pending Lab', inp.result, inp.species || null);
      if (inp.result === 'Negative') return { ok: true, message: 'Sample ' + r.sampleNo + ' is negative. No enforcement (BR-009).' };
      return system.onPositive(r);
    },

    // Notice
    'Notice.submit': function (r) {
      if (!r.charges.length) return fail([{ field: null, message: 'The notice has no charges.' }]);
      var sub = S().now();
      S().update('notices', r.id, { status: 'Pending Approval', submittedAt: sub, approvalDueAt: R().BR020_approvalDue(sub) });
      S().audit('Notice', r.id, 'Submit for approval', 'Draft', 'Pending Approval', 'Approval due ' + R().BR020_approvalDue(sub) + ' (BR-020)');
      notifyApprovers(r, 'Notice ' + r.noticeNo + ' is waiting for approval');
      return { ok: true, message: 'Notice ' + r.noticeNo + ' submitted. Approval due ' + R().BR020_approvalDue(sub) + '.' };
    },
    'Notice.approve': function (r, _, u) {
      S().update('notices', r.id, { status: 'Approved', approvedBy: u.id, approvedAt: S().now() });
      S().audit('Notice', r.id, 'Approve', 'Pending Approval', 'Approved', 'Locked for editing (BR-012)');
      S().notify(r.draftedBy, 'Notice ' + r.noticeNo + ' approved: ready to serve', 'Notice', r.id);
      return { ok: true, message: 'Notice ' + r.noticeNo + ' approved.' };
    },
    'Notice.return': function (r, inp) {
      var e = R().BR011_validateReturnReason(inp.reason);
      if (e.length) return fail(e);
      S().update('notices', r.id, { status: 'Returned', returnReason: inp.reason.trim() });
      S().audit('Notice', r.id, 'Return', 'Pending Approval', 'Returned', inp.reason.trim());
      S().notify(r.draftedBy, 'Notice ' + r.noticeNo + ' returned: action needed', 'Notice', r.id);
      return { ok: true, message: 'Notice ' + r.noticeNo + ' returned to the drafter.' };
    },
    'Notice.resubmit': function (r) {
      var sub = S().now();
      S().update('notices', r.id, { status: 'Pending Approval', submittedAt: sub, approvalDueAt: R().BR020_approvalDue(sub), returnReason: undefined });
      S().audit('Notice', r.id, 'Resubmit', 'Returned', 'Pending Approval', 'SLA restarts; due ' + R().BR020_approvalDue(sub) + ' (BR-020)');
      notifyApprovers(r, 'Notice ' + r.noticeNo + ' was resubmitted for approval');
      return { ok: true, message: 'Notice ' + r.noticeNo + ' resubmitted.' };
    },
    'Notice.serve': function (r, inp) {
      var e = [];
      if (!inp.servedDate) e.push({ field: 'servedDate', message: 'Enter the date of service.' });
      else if (inp.servedDate > R().today()) e.push({ field: 'servedDate', message: 'The date of service cannot be after today (' + R().today() + ').' });
      else if (inp.servedDate < r.approvedAt.slice(0, 10)) e.push({ field: 'servedDate', message: 'The notice cannot be served before it was approved (' + r.approvedAt.slice(0, 10) + ').' });
      if (!inp.serviceMethod) e.push({ field: 'serviceMethod', message: 'Choose how the notice was served.' });
      if (e.length) return fail(e);
      var ts = at(inp.servedDate);
      S().update('notices', r.id, { status: 'Served', servedAt: ts, serviceMethod: inp.serviceMethod, filedAt: ts });
      S().audit('Notice', r.id, 'Record service', 'Approved', 'Served', inp.serviceMethod + '; e-filed (BR-004)');
      var msg = system.onServed(r, inp.servedDate);
      return { ok: true, message: 'Notice ' + r.noticeNo + ' served and e-filed. ' + msg };
    },
    'Notice.withdraw': function (r, inp, u) {
      var e = R().BR024_validateReason(inp.reason).map(function (x) { x.message = x.message.replace('BR-024', 'BR-012'); return x; });
      if (e.length) return fail(e);
      var from = r.status;
      S().update('notices', r.id, { status: 'Withdrawn', withdrawnAt: S().now(), withdrawReason: inp.reason.trim() });
      S().audit('Notice', r.id, 'Withdraw', from, 'Withdrawn', inp.reason.trim());
      if (u.id !== r.draftedBy) S().notify(r.draftedBy, 'Notice ' + r.noticeNo + ' was withdrawn: reissue or cancel the case', 'Notice', r.id);
      return { ok: true, message: 'Notice ' + r.noticeNo + ' withdrawn. Reissue it, or an Approving Officer can cancel the case (BR-027).' };
    },
    'Notice.reissue': function (r, _, u) {
      var c = caseOf(r);
      var n = system.newNotice(c, u.id, false, r.id);
      return { ok: true, id: n.id, message: 'Notice ' + n.noticeNo + ' drafted to replace ' + r.noticeNo + '.' };
    },

    // Enforcement Case
    'EnforcementCase.recordPayment': function (r) {
      if (R().BR021_isPaymentOverdue(r)) return fail([{ field: null, message: 'Payment was due ' + r.paymentDueAt + '. The case is referred for prosecution (BR-021).' }]);
      var done = R().BR023_reinspectionDone(r), ts = S().now();
      if (done) {
        S().update('enforcementCases', r.id, { status: 'Closed', paidAt: ts, closedAt: ts });
        S().audit('EnforcementCase', r.id, 'Record payment', 'Awaiting Payment', 'Closed', 'Re-inspection already completed (BR-023)');
        return { ok: true, message: 'Payment recorded. Re-inspection already done, so case ' + r.id + ' is closed (BR-023).' };
      }
      S().update('enforcementCases', r.id, { status: 'Awaiting Re-inspection', paidAt: ts });
      S().audit('EnforcementCase', r.id, 'Record payment', 'Awaiting Payment', 'Awaiting Re-inspection');
      return { ok: true, message: 'Payment recorded. Case ' + r.id + ' closes after the re-inspection (BR-023).' };
    },
    'EnforcementCase.cancelCase': function (r, inp) {
      var e = R().BR024_validateReason(inp.reason).map(function (x) { x.message = x.message.replace('BR-024', 'BR-027'); return x; });
      if (e.length) return fail(e);
      S().update('enforcementCases', r.id, { status: 'Cancelled', cancelReason: inp.reason.trim() });
      S().audit('EnforcementCase', r.id, 'Cancel case', 'Open', 'Cancelled', inp.reason.trim());
      return { ok: true, message: 'Case ' + r.id + ' cancelled. It no longer counts as an offence (BR-027).' };
    }
  };

  function notifyApprovers(n, msg) {
    users(ROLE.AO).forEach(function (a) { if (a.id !== n.draftedBy) S().notify(a.id, msg, 'Notice', n.id); });
  }

  function completeVisit(r, inp, toStatus, action) {
    var e = R().BR007_validateVisit({ outcome: toStatus, visitedAt: inp.visitedAt });
    if (toStatus === 'Completed – Breeding Found') e = e.concat(R().BR008_validateHabitats(inp.habitats || []));
    if (inp.remarks && inp.remarks.length > 500) e.push({ field: 'remarks', message: 'Remarks must be 500 characters or fewer.' });
    if (e.length) return fail(e);
    var patch = { status: toStatus, visitedAt: inp.visitedAt };
    if (inp.remarks) patch.remarks = inp.remarks.trim();
    S().update('inspections', r.id, patch);
    S().audit('Inspection', r.id, action, 'Assigned', toStatus, inp.remarks || null);
    var msg = 'Visit recorded for ' + r.id + '.';
    if (toStatus === 'Completed – Breeding Found') {
      (inp.habitats || []).forEach(function (h) {
        var s = S().create('larvalSamples', { inspectionId: r.id, sampleNo: h.sampleNo, habitatType: h.habitatType, habitatLocation: h.habitatLocation.trim(), isRemoved: true, status: 'Pending Lab' });
        S().audit('LarvalSample', s.id, 'Send sample to lab', null, 'Pending Lab', 'BR-008', true);
      });
      msg += ' ' + inp.habitats.length + ' larval sample(s) sent to the lab.';
    }
    if (toStatus === 'No Access') {
      var rv = S().create('inspections', {
        premisesId: r.premisesId, assignedTo: r.assignedTo, dueDate: R().BR026_revisitDue(inp.visitedAt), status: 'Assigned',
        isReinspection: !!r.isReinspection, isRevisit: true, previousInspectionId: r.id,
        createdBy: 'SYSTEM'
      });
      if (r.enforcementCaseId) S().update('inspections', rv.id, { enforcementCaseId: r.enforcementCaseId }, { system: true });
      S().audit('Inspection', rv.id, 'Schedule re-visit', null, 'Assigned', 'BR-026', true);
      S().notify(r.assignedTo, 'Re-visit ' + rv.id + ' scheduled for ' + rv.dueDate, 'Inspection', rv.id);
      msg += ' Re-visit ' + rv.id + ' scheduled for ' + rv.dueDate + ' (BR-026).';
    }
    if (r.isReinspection && r.enforcementCaseId && toStatus !== 'No Access') msg += ' ' + system.onReinspectionDone(r.enforcementCaseId);
    return { ok: true, message: msg };
  }

  // ---------------------------------------------------------------- automatic (SYSTEM) transitions
  var system = {
    // BR-002, BR-009, BR-015, BR-028: positive sample -> case + Draft Notice, or an extra Charge
    onPositive: function (sample) {
      var ins = inspectionOf(sample);
      var c = S().list('enforcementCases', function (x) { return x.inspectionId === ins.id; })[0];
      if (!c) {
        var offence = R().BR015_offenceCount(ins.premisesId, ins.visitedAt.slice(0, 10), ins.id);
        c = S().create('enforcementCases', { inspectionId: ins.id, premisesId: ins.premisesId, offenceCount: offence, status: 'Open', createdBy: 'SYSTEM' });
        S().audit('EnforcementCase', c.id, 'Open enforcement case', null, 'Open', 'BR-002; offence no. ' + offence, true);
        var n = system.newNotice(c, ins.assignedTo, true);
        S().notify(ins.assignedTo, 'Lab result in: Notice ' + n.noticeNo + ' drafted', 'Notice', n.id);
        return { ok: true, id: n.id, message: 'Breeding confirmed. Enforcement case ' + c.id + ' opened (offence no. ' + offence + ') and Notice ' + n.noticeNo + ' drafted.' };
      }
      if (c.status === 'Cancelled') return { ok: true, message: 'Breeding confirmed, but case ' + c.id + ' is cancelled. No charge added.' };
      var latest = R().latestNotice(c.id);
      if (latest && (latest.status === 'Draft' || latest.status === 'Returned')) {
        var charges = latest.charges.slice();
        charges.push({ chargeNo: charges.length + 1, larvalSampleId: sample.id, habitatType: sample.habitatType, fineAmount: finePerCharge(c) });
        S().update('notices', latest.id, { charges: charges, totalFine: R().BR028_total(charges) }, { system: true });
        S().audit('Notice', latest.id, 'Add charge', latest.status, latest.status, 'Charge ' + charges.length + ': ' + sample.habitatType + ' (BR-028)', true);
        return { ok: true, message: 'Breeding confirmed. Charge ' + charges.length + ' added to Notice ' + latest.noticeNo + ' (BR-028).' };
      }
      return { ok: true, warning: true, message: 'Breeding confirmed, but Notice ' + (latest ? latest.noticeNo : '') + ' is already ' + (latest ? latest.status : '') + '. Withdraw and reissue it to add this charge (BR-012).' };
    },
    newNotice: function (c, drafterId, bySystem, replacesId) {
      var ins = S().get('inspections', c.inspectionId);
      var positives = S().list('larvalSamples', function (s) { return s.inspectionId === ins.id && s.status === 'Positive'; });
      var charges = R().BR028_buildCharges(positives, finePerCharge(c));
      var rec = {
        noticeNo: nextNoticeNo(), enforcementCaseId: c.id, noticeType: R().BR014_noticeType(c.offenceCount), status: 'Draft',
        draftedBy: drafterId, charges: charges, totalFine: R().BR028_total(charges)
      };
      if (bySystem) rec.createdBy = 'SYSTEM';
      if (replacesId) rec.replacesNoticeId = replacesId;
      var n = S().create('notices', rec);
      S().audit('Notice', n.id, replacesId ? 'Reissue notice' : 'Draft notice', null, 'Draft',
        replacesId ? 'Replaces ' + S().get('notices', replacesId).noticeNo : charges.length + ' charge(s); BR-013, BR-028', !!bySystem);
      return n;
    },
    // BR-004, BR-021, BR-022, BR-014
    onServed: function (n, servedDate) {
      var c = caseOf(n), ins = inspectionOf(c), msg;
      if (n.noticeType === 'Notice of Offence') {
        var due = R().BR021_paymentDue(servedDate);
        S().update('enforcementCases', c.id, { status: 'Awaiting Payment', paymentDueAt: due }, { system: true });
        S().audit('EnforcementCase', c.id, 'Notice served', 'Open', 'Awaiting Payment', 'Payment due ' + due + ' (BR-021)', true);
        msg = 'Payment due ' + due + '.';
      } else {
        S().update('enforcementCases', c.id, { status: 'Referred for Prosecution', referralReason: '3rd+ offence' }, { system: true });
        S().audit('EnforcementCase', c.id, 'Notice served', 'Open', 'Referred for Prosecution', 'Notice to Abate (BR-014, D-032)', true);
        msg = 'Case referred for prosecution (BR-014).';
      }
      var re = S().create('inspections', {
        premisesId: c.premisesId, assignedTo: ins.assignedTo, dueDate: R().BR022_reinspectionDue(servedDate), status: 'Assigned',
        isReinspection: true, isRevisit: false, enforcementCaseId: c.id, createdBy: 'SYSTEM'
      });
      S().audit('Inspection', re.id, 'Schedule re-inspection', null, 'Assigned', 'BR-022', true);
      S().update('enforcementCases', c.id, { reinspectionId: re.id }, { system: true });
      S().notify(ins.assignedTo, 'Re-inspection ' + re.id + ' due ' + re.dueDate, 'Inspection', re.id);
      return msg + ' Re-inspection ' + re.id + ' due ' + re.dueDate + ' (BR-022).';
    },
    // BR-023 (D-033)
    onReinspectionDone: function (caseId) {
      var c = S().get('enforcementCases', caseId);
      if (c.status === 'Awaiting Re-inspection') {
        S().update('enforcementCases', c.id, { status: 'Closed', closedAt: S().now() }, { system: true });
        S().audit('EnforcementCase', c.id, 'Re-inspection completed', 'Awaiting Re-inspection', 'Closed', 'BR-023 (D-033)', true);
        return 'Case ' + c.id + ' closed (BR-023).';
      }
      if (c.status === 'Awaiting Payment') return 'Case ' + c.id + ' will close when the fine is paid (BR-023).';
      return '';
    },
    // Run on every page load: date-driven rules (BR-020, BR-021)
    sweep: function () {
      var changed = 0, t = R().today();
      S().list('enforcementCases', function (c) { return R().BR021_isPaymentOverdue(c); }).forEach(function (c) {
        S().update('enforcementCases', c.id, { status: 'Referred for Prosecution', referralReason: 'Fine unpaid' }, { system: true });
        S().audit('EnforcementCase', c.id, 'Payment overdue', 'Awaiting Payment', 'Referred for Prosecution', 'Due ' + c.paymentDueAt + ' (BR-021)', true);
        users(ROLE.OM).forEach(function (m) { S().notify(m.id, 'Case ' + c.id + ' referred: fine unpaid', 'EnforcementCase', c.id); });
        changed++;
      });
      S().list('notices', function (n) { return R().BR020_isApprovalOverdue(n); }).forEach(function (n) {
        var already = S().list('notifications', function (x) { return x.entityId === n.id && /Approval overdue/.test(x.message) && x.createdAt.slice(0, 10) >= n.approvalDueAt; }).length;
        if (!already) users(ROLE.AO).concat(users(ROLE.OM)).forEach(function (a) { S().notify(a.id, 'Approval overdue: Notice ' + n.noticeNo, 'Notice', n.id); });
      });
      return changed;
    }
  };

  function finePerCharge(c) { return R().BR013_finePerCharge(S().get('premises', c.premisesId).premisesType, c.offenceCount); }
  function nextNoticeNo() {
    var y = R().today().slice(0, 4), max = 0;
    S().list('notices').forEach(function (n) { var m = /^VC\/(\d{4})\/(\d{5})$/.exec(n.noticeNo); if (m && m[1] === y) max = Math.max(max, +m[2]); });
    return 'VC/' + y + '/' + String(max + 1).padStart(5, '0');
  }

  return { transitions: T, canTransition: canTransition, actionsFor: actionsFor, execute: execute, system: system, ROLE: ROLE };
})();
