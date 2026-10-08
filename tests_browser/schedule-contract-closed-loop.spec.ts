import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { commands, fields } from '../apps/web/src/labels';

type Role = 'CON' | 'SUP' | 'OWN';
type Ref = { objectType: string; objectId: string; version: number };
type RecordData = { id: string; version: number; status: string; title: string; schedule?: any; data?: any };
type Session = { projectId: string; accessToken: string; actor: { partyId: string; roleAssignmentId: string } };
const ref = (record: RecordData, objectType = record.schedule ? 'InformationItem' : 'WorkItem'): Ref =>
  ({ objectType, objectId: record.id, version: record.version });
const quality = Object.fromEntries(['contractDatesAligned', 'wbsComplete', 'activityIdsUnique', 'calendarsDefined',
  'logicComplete', 'openEndsIdentified', 'constraintsReviewed', 'durationOutliersReviewed', 'criticalPathComputable',
  'floatOutliersReviewed', 'interfacesReviewed', 'sourceFilePreserved'].map(key => [key, true]));

// Source files and approvals are created through the public development API.
// No direct DB writes, bootstrap-approved records, mocks or intercepted responses.
test('AC-SCH-01: live UI schedule → recovery → Owner EOT decision → approved baseline revision', async ({ page, request }) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(10_000);
  const sessions = {} as Record<Role, Session>;
  for (const actorGroup of ['CON', 'SUP', 'OWN'] as Role[]) {
    const response = await request.post('/api/dev/sessions', { data: { actorGroup } });
    expect(response.status()).toBe(200);
    sessions[actorGroup] = await response.json();
  }
  const project = sessions.CON.projectId;
  const headers = (role: Role, key?: string) => ({ Authorization: `Bearer ${sessions[role].accessToken}`,
    'X-RoleAssignment-Id': sessions[role].actor.roleAssignmentId, ...(key ? { 'Idempotency-Key': key } : {}) });
  async function post(path: string, role: Role, data: unknown, expected = 200, key = randomUUID()) {
    const response = await request.post(`/api/projects/${project}/${path}`, { headers: headers(role, key), data });
    expect(response.status(), `${path}: ${await response.text()}`).toBe(expected);
    return response.json();
  }
  async function read(collection: string, id: string) {
    const response = await request.get(`/api/projects/${project}/${collection}/${id}`, { headers: headers('SUP') });
    expect(response.status()).toBe(200);
    return await response.json() as RecordData;
  }
  const workspace = await (await request.get(`/api/projects/${project}/workspace`, { headers: headers('CON') })).json();
  const { scope, evidenceId, requirementRef } = workspace.context;
  const issuedReport = workspace.items.find((item: any) => item.machine === 'report' && item.record.status === 'issued').record;
  const suffix = randomUUID().slice(0, 8);
  const at = new Date(Date.now() - 60_000).toISOString();
  const due = new Date(Date.now() + 86_400_000).toISOString();
  const finish = '2026-12-31T00:00:00Z';
  const revisedFinish = '2027-01-10T00:00:00Z';
  async function create(collection: string, role: Role, payload: any): Promise<RecordData> {
    return (await post(collection, role, { roleAssignmentId: sessions[role].actor.roleAssignmentId,
      clientObjectId: randomUUID(), payload: { ...scope, ...payload } }, 201)).record;
  }
  async function command(collection: string, record: RecordData, name: string, role: Role,
    payload: any = {}, evidenceIds: string[] = [], expected = 200, key?: string) {
    return post(`${collection}/${record.id}/${name.replaceAll('_', '-')}`, role,
      { roleAssignmentId: sessions[role].actor.roleAssignmentId, expectedVersion: record.version, payload, evidenceIds }, expected, key);
  }
  async function importSource(kind: string, revision: string, extra: any = {}): Promise<RecordData> {
    const schedule: any = { scheduleNo: `AC-SCH-${suffix}-${revision}`, scheduleKind: kind, revision,
      sourceFormat: 'normalized_json', sourceFileVersion: revision, dataDate: at,
      forecastCompletionAt: finish, milestoneSet: [{ milestoneId: 'M1', name: 'Completion', forecastAt: revisedFinish }], ...extra };
    if (kind === 'baseline') Object.assign(schedule, { projectStartAt: '2026-01-01T00:00:00Z',
      contractualCompletionAt: extra.contractualCompletionAt ?? finish,
      calendars: [{ calendarId: 'STD', name: 'Standard', timezone: 'Asia/Ho_Chi_Minh', workingDays: [1,2,3,4,5], hoursPerDay: 8 }],
      wbsVersion: '1', milestoneSet: [{ milestoneId: 'M1', name: 'Completion', plannedAt: finish, contractualAt: finish }],
      scheduleQualitySummary: quality });
    const activity = { data: { activityId: 'A1', wbsPath: '1', activityName: 'Critical work', critical: true },
      predecessorActivityIds: [], successorActivityIds: [] };
    const content = Buffer.from(JSON.stringify({ schedule, activities: [activity], criticalActivityId: 'A1' }));
    const checksum = createHash('sha256').update(content).digest('hex');
    const upload = await post('uploads', 'CON', { roleAssignmentId: sessions.CON.actor.roleAssignmentId,
      captureId: randomUUID(), fileName: `${revision}.json`, mimeType: 'application/json', byteCount: content.length,
      expectedHash: checksum, sourcePartyId: sessions.CON.actor.partyId, mediaType: 'document',
      discipline: scope.discipline, packageId: scope.packageId, locationId: scope.locationId }, 201);
    const chunk = await request.put(`/api/projects/${project}/uploads/${upload.id}/chunks`, {
      headers: { ...headers('CON', randomUUID()), 'Upload-Offset': '0', 'Content-Type': 'application/octet-stream' }, data: content });
    expect(chunk.status(), await chunk.text()).toBe(200);
    const evidence = await post(`uploads/${upload.id}/complete`, 'CON', {
      roleAssignmentId: sessions.CON.actor.roleAssignmentId, expectedHash: checksum }, 201);
    const imported = await post('schedule-source-imports', 'CON', {
      roleAssignmentId: sessions.CON.actor.roleAssignmentId, clientObjectId: randomUUID(),
      scope: { packageId: scope.packageId, locationId: scope.locationId, discipline: scope.discipline,
        responsibleOrganizationId: scope.responsibleOrganizationId }, title: `AC-SCH ${suffix} ${revision}`,
      sourceEvidenceRef: { objectType: 'Evidence', objectId: evidence.id, version: evidence.version },
      inputMode: 'normalized_json', parserVersion: 'doul-normalized-json-v1',
      schedule: { ...schedule, sourceFileRef: upload.id, sourceFileHash: checksum },
      activities: [{ clientObjectId: randomUUID(), ...activity }], criticalActivityId: 'A1' }, 201);
    expect(imported.activityRefs).toHaveLength(1);
    return imported.record;
  }
  let lastUIKey = "";
  let lastUIResponse: any;
  async function uiCommand(collection: string, record: RecordData, name: string, role: Role, payload: any = {}) {
    const contract = ['contract-notices', 'eot-requests'].includes(collection);
    await page.goto(contract ? '/#/contract' : '/#/schedule');
    const picker = page.getByRole('combobox', { name: '개발 역할 선택' });
    await expect(picker).toBeVisible();
    await picker.selectOption(role);
    await expect(page.getByText({ CON: '시공사 작업공간', SUP: '감리 작업공간', OWN: '발주처 작업공간' }[role], { exact: true })).toBeVisible();
    await page.goto(contract ? '/#/contract' : '/#/schedule');
    await page.getByRole('button', { name: '새로고침', exact: true }).click();
    const tab: Record<string, string> = { 'schedule-baselines': '기준공정', 'schedule-progress-updates': '진도기록',
      'delay-events': '지연사건', 'recovery-plans': '회복계획', 'contract-notices': '계약통지', 'eot-requests': '공기연장(EOT)' };
    await page.getByRole('tab', { name: tab[collection], exact: true }).click();
    await page.getByRole('button').filter({ hasText: record.title }).first().click();
    await expect(page.locator('.detail-head')).toContainText(record.title);
    await page.getByRole('button', { name: commands[name] || name, exact: true }).click();
    const dialog = page.getByRole('dialog');
    for (const [field, value] of Object.entries(payload)) {
      const label = fields[field] || field;
      const input = dialog.getByRole('combobox', { name: label, exact: true })
        .or(dialog.getByRole('listbox', { name: label, exact: true }))
        .or(dialog.getByRole('textbox', { name: label, exact: true }));
      if (await input.evaluate(el => el.tagName === 'SELECT')) {
        await input.selectOption(Array.isArray(value) ? value.map(v => JSON.stringify(v))
          : typeof value === 'object' ? JSON.stringify(value) : String(value));
      } else await input.fill(typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
    const evidence = dialog.getByLabel('명령 증빙 ID', { exact: true });
    if (await evidence.count()) await evidence.fill(evidenceId);
    const response = page.waitForResponse(r => r.url().endsWith(`/${record.id}/${name.replaceAll('_', '-')}`)
      && r.request().method() === 'POST');
    await dialog.getByRole('button', { name: '확인 후 실행', exact: true }).click();
    const result = await response;
    expect(result.status(), await result.text()).toBe(200);
    expect(result.request().postDataJSON().expectedVersion).toBe(record.version);
    expect(result.request().headers()['idempotency-key']).toBeTruthy();
    await expect(dialog).toHaveCount(0);
    lastUIKey = result.request().headers()['idempotency-key'];
    lastUIResponse = await result.json();
    return lastUIResponse.record as RecordData;
  }
  async function activate(record: RecordData) {
    for (const [name, role] of [['submit_baseline','CON'], ['receive_baseline','SUP'],
      ['start_baseline_review','SUP'], ['request_baseline_decision','SUP']] as [string, Role][]) {
      record = await uiCommand('schedule-baselines', record, name, role);
    }
    let approval = await create('approvals', 'CON', { targetRef: ref(record),
      requestedBy: sessions.CON.actor.partyId, approvalKind: 'technical' });
    approval = (await command('approvals', approval, 'review', 'SUP')).record;
    approval = (await command('approvals', approval, 'approve', 'SUP')).record;
    record = await uiCommand('schedule-baselines', record, 'approve_baseline', 'SUP', { approvalRef: ref(approval, 'Approval') });
    return uiCommand('schedule-baselines', record, 'activate_baseline', 'SUP');
  }
  async function decide(target: Ref, outcome = 'approved') {
    let decision = await create('owner-decisions', 'SUP', { title: `AC-SCH Owner decision ${suffix}`,
      targetRef: target, reportId: issuedReport.id, options: [{ id: 'A' }], impact: { schedule: 'assessed' },
      recommendation: 'A', actionIds: [], dueAt: due });
    decision = (await command('owner-decisions', decision, 'report', 'SUP')).record;
    decision = (await command('owner-decisions', decision, 'acknowledge', 'OWN')).record;
    decision = (await command('owner-decisions', decision, 'decide', 'OWN', {
      decision: outcome, decisionReason: 'Assessed time entitlement', selectedOption: 'A', decisionAt: at })).record;
    return decision;
  }

  const baseline = await activate(await importSource('baseline', 'B0'));
  expect(baseline.status).toBe('effective');
  const originalSchedule = structuredClone(baseline.schedule);
  let progress = await importSource('progress_update', 'U1', { baselineScheduleRef: ref(baseline), forecastCompletionAt: '2027-01-15T00:00:00Z' });
  for (const name of ['receive_progress', 'start_progress_verification']) progress = await uiCommand('schedule-progress-updates', progress, name, 'SUP');
  progress = await uiCommand('schedule-progress-updates', progress, 'accept_progress_for_reporting', 'SUP', {
    actualsVerified: true, forecastVerified: true, criticalPathReviewed: true, varianceExplained: true });
  progress = await uiCommand('schedule-progress-updates', progress, 'freeze_progress', 'SUP');
  expect(progress.status).toBe('frozen');
  let delay = await create('delay-events', 'SUP', { title: `AC-SCH delay ${suffix}`, evidenceIds: [evidenceId], data: {
    delayEventNo: `DE-${suffix}`, eventType: 'forecast_delay', observedAt: at, knownAt: at, description: 'Forecast completion variance',
    baselineScheduleRef: ref(baseline), currentScheduleRef: ref(progress) } });
  delay = await uiCommand('delay-events', delay, 'notify', 'SUP');
  const recoverySchedule = await importSource('recovery', 'R1');
  let recovery = await create('recovery-plans', 'SUP', { title: `AC-SCH recovery ${suffix}`, evidenceIds: [evidenceId],
    data: { triggerDelayEventRefs: [ref(delay)] } });
  recovery = await uiCommand('recovery-plans', recovery, 'begin_recovery_draft', 'CON');
  recovery = await uiCommand('recovery-plans', recovery, 'submit_recovery', 'CON', {
    recoveryPlanNo: `RP-${suffix}`, targetMilestoneIds: ['M1'], targetCompletionAt: finish,
    currentForecastCompletionAt: '2027-01-15T00:00:00Z', proposedForecastCompletionAt: finish,
    strategy: 'Resequence critical work', qualityImpact: 'none', safetyImpact: 'none', costImpact: 'separate review',
    contractImpact: 'separate entitlement', qualityStandardsRelaxed: false, safetyStandardsRelaxed: false,
    recoveryScheduleRef: ref(recoverySchedule), ownerDecisionRequired: false, monitoringPeriod: 'weekly', monitoringKpis: ['forecast'] });
  for (const name of ['receive_recovery', 'start_recovery_review', 'accept_recovery']) recovery = await uiCommand('recovery-plans', recovery, name, 'SUP');
  expect(recovery.status).toBe('accepted_for_execution');
  expect((await read('schedule-baselines', baseline.id)).schedule).toEqual(originalSchedule);
  let notice = await create('contract-notices', 'CON', { title: `AC-SCH notice ${suffix}`, data: {
    noticeNo: `NT-${suffix}`, eventRef: ref(delay), clauseRef: requirementRef, contractRuleRef: requirementRef,
    awareAt: at, eventAt: at, senderPartyId: sessions.CON.actor.partyId, recipientPartyId: sessions.SUP.actor.partyId,
    subject: 'Reservation of time entitlement' } });
  notice = await uiCommand('contract-notices', notice, 'calculate_notice_due', 'SUP', { noticeDueAt: due });
  notice = await uiCommand('contract-notices', notice, 'submit_notice', 'CON');
  let approved: RecordData | undefined;
  for (const outcome of ['rejected', 'partially_approved', 'approved']) {
    let eot = await create('eot-requests', 'CON', { title: `AC-SCH EOT ${outcome} ${suffix}`, data: { eotNo: `EOT-${outcome}-${suffix}` } });
    const submission = { delayEventRefs: [ref(delay)], noticeRefs: [ref(notice)], baselineScheduleRef: ref(baseline),
      impactAnalysisRefs: [{ objectType: 'Evidence', objectId: evidenceId, version: 1 }], daysClaimed: 10,
      concurrentDelayAssessment: 'No concurrent delay' };
    if (outcome === 'rejected') {
      await command('eot-requests', eot, 'submit_eot', 'CON', { ...submission, noticeRefs: [] }, [evidenceId], 422);
      expect((await read('eot-requests', eot.id)).status).toBe('draft');
    }
    eot = await uiCommand('eot-requests', eot, 'submit_eot', 'CON', submission);
    eot = await uiCommand('eot-requests', eot, 'receive_eot', 'SUP');
    eot = await uiCommand('eot-requests', eot, 'start_time_impact_review', 'SUP', {
      timeImpactAssessment: 'Critical-path impact verified', daysAssessed: 10, assessedCompletionDate: revisedFinish });
    eot = await uiCommand('eot-requests', eot, 'start_eot_entitlement_review', 'SUP', { entitlementAssessment: 'Time entitlement supported' });
    eot = await uiCommand('eot-requests', eot, 'request_eot_decision', 'SUP', { recommendation: 'Approve assessed time only' });
    const approvePayload = { daysApproved: 10, revisedCompletionDate: revisedFinish };
    if (outcome === 'approved') {
      for (const target of [ref(delay), { ...ref(eot), version: eot.version - 1 }]) {
        const wrong = await decide(target);
        const denied = await command('eot-requests', eot, 'approve_eot', 'OWN', {
          ...approvePayload, decisionRef: ref(wrong, 'Decision') }, [evidenceId], 409);
        expect(denied.code).toBe('CONTRACT_DECISION_TARGET_INVALID');
      }
    }
    const decision = await decide(ref(eot), outcome === 'rejected' ? 'rejected' : 'approved');
    const name = outcome === 'rejected' ? 'reject_eot' : outcome === 'partially_approved' ? 'partially_approve_eot' : 'approve_eot';
    const payload = outcome === 'rejected' ? { decisionRef: ref(decision, 'Decision') }
      : { ...approvePayload, daysApproved: outcome === 'partially_approved' ? 5 : 10,
        revisedCompletionDate: outcome === 'partially_approved' ? '2027-01-05T00:00:00Z' : revisedFinish,
        decisionRef: ref(decision, 'Decision') };
    const stale = eot;
    eot = await uiCommand('eot-requests', eot, name, 'OWN', payload);
    expect(eot.status).toBe(outcome);
    expect((await read('schedule-baselines', baseline.id)).schedule).toEqual(originalSchedule);
    if (outcome === 'approved') {
      const conflict = await command('eot-requests', stale, name, 'OWN', payload, [evidenceId], 409);
      expect(conflict.code).toBe('VERSION_CONFLICT');
      approved = eot;
    }
  }
  expect(approved).toBeTruthy();
  const exactApproved = ref(approved!);
  const pending = await uiCommand('eot-requests', approved!, 'request_baseline_update', 'SUP');
  expect(pending.data.baselineRevisionBasisRef).toEqual(exactApproved);
  const replay = await command('eot-requests', approved!, 'request_baseline_update', 'SUP', {}, [], 200, lastUIKey);
  expect(replay).toEqual(lastUIResponse);
  const revised = await activate(await importSource('baseline', 'B1', {
    revisionBasisRef: exactApproved, contractualCompletionAt: revisedFinish, forecastCompletionAt: revisedFinish }));
  expect(revised.status).toBe('effective');
  const previous = await read('schedule-baselines', baseline.id);
  expect(previous.status).toBe('superseded');
  expect(previous.schedule.contractualCompletionAt).toBe(finish);
  expect(revised.schedule.supersedesRef.objectId).toBe(baseline.id);
  const closed = await uiCommand('eot-requests', pending, 'confirm_baseline_update', 'SUP', { baselineRevisionRef: ref(revised) });
  expect(closed.status).toBe('closed');
  expect(closed.data.baselineRevisionBasisRef).toEqual(exactApproved);
  expect(closed.data.baselineRevisionRef).toEqual(ref(revised));
  await page.reload();
  await page.getByRole('tab', { name: '공기연장(EOT)', exact: true }).click();
  await page.getByRole('button').filter({ hasText: closed.title }).first().click();
  await expect(page.locator('.detail-head .badge')).toContainText('종결');
});
