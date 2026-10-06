"""Transactional outbox, bounded attempts and fenced media result commits.

Call register_job inside the SAME transaction as authorized AnalysisRun creation.
No domain state or authority is defined here: all mutations use application
commands and the existing Product engine. Redis deliveries are at-least-once.
"""
from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
import time
from uuid import uuid4

from app.reference.engine import canonical
from app.reference.validation import ContractError, require
from services.api.application import start_media_analysis, complete_media_analysis, fail_media_analysis

TERMINAL = {'succeeded', 'failed', 'cancelled'}
JOB_TERMINAL = {'done', 'dead', 'cancelled'}


def clock(store):
    """Use DB time for leases where supported, not different worker host clocks."""
    if hasattr(store, '_fetchone'):
        return float(store._fetchone('SELECT EXTRACT(EPOCH FROM clock_timestamp())')[0])
    return float(store.db.execute("SELECT julianday('now')").fetchone()[0] - 2440587.5) * 86400


def ledger(store):
    return store.meta.setdefault('workerJobs', {})


def register_job(store, run):
    job_id = sha256((run['projectId'] + '/' + run['id']).encode()).hexdigest()
    jobs = ledger(store)
    if job_id in jobs:
        return job_id
    config = store.meta.get('projectConfiguration', {})
    policy = config.get('mediaPolicy', {}).get('autoRetry', {'maxAttempts': 0, 'backoffSeconds': []})
    configured_attempts = policy['maxAttempts']
    require(type(configured_attempts) is int and 0 <= configured_attempts <= 21, 'INVALID_REQUEST', 'Attempt count must be bounded')
    # A positive cap includes the initial execution. Zero disables retries.
    retries = max(0, configured_attempts - 1)
    backoff = policy['backoffSeconds']
    require(isinstance(backoff, list) and len(backoff) >= retries and
            all(type(n) is int and 0 <= n <= 86400 for n in backoff),
            'INVALID_REQUEST', 'Every retry needs a bounded configured backoff')
    now = clock(store)
    jobs[job_id] = dict(
        jobId=job_id, projectId=run['projectId'], runId=run['id'], state='ready',
        createdAt=now, nextAt=now, leaseUntil=0, token=None, attempts=[],
        maxRetries=retries, backoffSeconds=list(backoff),
        configVersion=config.get('configVersion'), configuration=deepcopy(config),
        profile={k: deepcopy(run[k]) for k in ('model', 'promptVersion', 'policyVersion')},
        sources=[dict(id=e['id'], version=e['version'], fileHash=e['fileHash'])
                 for e in (store.engine.get('Evidence', eid) for eid in run['sourceEvidenceIds'])],
    )
    return job_id


def dispatch(store, queue):
    """Replay the outbox after restart/Redis loss; only committed jobs are read."""
    with store.transaction():
        now = clock(store)
        due = [j['jobId'] for j in ledger(store).values()
               if j['state'] not in JOB_TERMINAL and j['nextAt'] <= now and j['leaseUntil'] <= now]
    # A lost publish or an ACK of a busy duplicate cannot strand a job: the DB
    # ledger is scanned again and a new generation is offered every 10 seconds.
    for job_id in due:
        queue.publish(job_id, int(now // 10))
    return len(due)


def _safe_error(exc):
    if isinstance(exc, ContractError):
        return exc.code
    return 'PROVIDER_TEMPORARY' if isinstance(exc, (TimeoutError, ConnectionError)) else 'PROVIDER_FAILURE'


def _domain_failed(store, job, code):
    run = store.engine.get('AnalysisRun', job['runId'])
    if run['status'] == 'running':
        try:
            fail_media_analysis(store.engine, run['id'], code,
                                store.meta['serviceActors']['SYSTEM'], job['jobId'] + ':failed')
        except ContractError as exc:
            # A revoked authority/stale prerequisite must not be bypassed merely
            # to make the queue look finished. Operational dead-letter is separate.
            job['domainFailureBlocked'] = exc.code
    job['state'] = 'dead'
    job['errorCode'] = code
    job['finishedAt'] = clock(store)
    job['leaseUntil'] = 0


def claim(store, job_id, lease_seconds=60):
    require(type(lease_seconds) is int and lease_seconds >= 5, 'INVALID_REQUEST', 'Invalid lease')
    with store.transaction(True):
        job = ledger(store).get(job_id)
        if job is None or job['state'] in JOB_TERMINAL:
            return None
        now = clock(store)
        if job['leaseUntil'] > now or job['nextAt'] > now:
            return None
        run = store.engine.get('AnalysisRun', job['runId'])
        require(run['projectId'] == job['projectId'], 'PROJECT_MISMATCH', 'Job project mismatch')
        if run['status'] in TERMINAL:
            job['state'] = 'cancelled' if run['status'] == 'cancelled' else 'done' if run['status'] == 'succeeded' else 'dead'
            job['finishedAt'] = now
            return None
        if job['state'] == 'running' and job['attempts']:
            job['attempts'][-1].update(status='lease_expired', finishedAt=now)
        if len(job['attempts']) >= 1 + job['maxRetries']:
            _domain_failed(store, job, 'ATTEMPTS_EXHAUSTED')
            return None
        # Domain/profile/source provenance is server-owned, not Redis payload.
        try:
            require(all(run[k] == job['profile'][k] for k in job['profile']),
                    'ANALYSIS_PROFILE_CHANGED', 'Queued analysis profile changed')
            for ref in job['sources']:
                source = store.engine.get('Evidence', ref['id'])
                require(source['projectId'] == job['projectId'] and source['version'] == ref['version'] and
                        source['fileHash'] == ref['fileHash'], 'EVIDENCE_INVALID', 'Queued source changed')
            if run['status'] == 'queued':
                start_media_analysis(store.engine, run['id'], store.meta['serviceActors']['SYSTEM'], job_id + ':start')
        except ContractError as exc:
            _domain_failed(store, job, exc.code)
            return None
        token = str(uuid4())
        job.update(state='running', token=token, leaseUntil=now + lease_seconds)
        job['attempts'].append(dict(token=token, startedAt=now, status='running'))
        return deepcopy(job)


def finish(store, job_id, token, result=None, error=None):
    """A single DB commit covers validated outputs, candidates, audit and job.done."""
    with store.transaction(True):
        job = ledger(store).get(job_id)
        now = clock(store)
        if not job or job['state'] != 'running' or job['token'] != token or job['leaseUntil'] <= now:
            return 'stale'
        run = store.engine.get('AnalysisRun', job['runId'])
        if run['status'] in TERMINAL:
            job.update(state='cancelled' if run['status'] == 'cancelled' else 'done' if run['status'] == 'succeeded' else 'dead',
                       finishedAt=now, leaseUntil=0)
            job['attempts'][-1].update(status=job['state'], finishedAt=now)
            return job['state']
        if error is not None:
            code = _safe_error(error)
            job['attempts'][-1].update(status='failed', finishedAt=now, errorCode=code)
            retryable = isinstance(error, (TimeoutError, ConnectionError))
            if retryable and len(job['attempts']) <= job['maxRetries']:
                delay = job['backoffSeconds'][len(job['attempts']) - 1]
                job.update(state='ready', nextAt=now + delay, leaseUntil=0)
            else:
                _domain_failed(store, job, code)
            return job['state']
        require(store.meta.get('projectConfiguration', {}).get('configVersion') == job['configVersion'],
                'PROJECT_CONFIGURATION_CHANGED', 'Configuration changed before result commit')
        require(all(run[k] == job['profile'][k] for k in job['profile']),
                'ANALYSIS_PROFILE_CHANGED', 'Profile changed before result commit')
        for ref in job['sources']:
            source = store.engine.get('Evidence', ref['id'])
            require(source['version'] == ref['version'] and source['fileHash'] == ref['fileHash'],
                    'EVIDENCE_INVALID', 'Source changed before result commit')
        require(isinstance(result, dict) and set(result) == {'outputs', 'coverage'},
                'ANALYSIS_OUTPUT_INVALID', 'Provider returns normalized outputs and coverage only')
        completed = complete_media_analysis(store.engine, run['id'], result['outputs'], result['coverage'],
                     store.engine.at(), store.meta['serviceActors']['SYSTEM'], store.meta['serviceActors']['AI'],
                     job_id + ':result')
        job.update(state='done', finishedAt=now, leaseUntil=0,
                   resultHash=sha256(canonical(result)).hexdigest(),
                   candidateIds=[x['id'] for x in completed['candidates']])
        job['attempts'][-1].update(status='done', finishedAt=now)
        return 'done'


def process_message(store, queue, provider, message, lease_seconds=60):
    message_id, fields = message
    job_id = fields.get('jobId') if isinstance(fields, dict) and set(fields) == {'jobId'} else None
    if not isinstance(job_id, str) or len(job_id) != 64:
        queue.acknowledge(message_id)
        return 'rejected'
    job = claim(store, job_id, lease_seconds)
    if job is None:
        queue.acknowledge(message_id)
        return 'ignored'
    try:
        with store.transaction():
            run = deepcopy(store.engine.get('AnalysisRun', job['runId']))
            sources = [deepcopy(store.engine.get('Evidence', r['id'])) for r in job['sources']]
            blobs = {s['id']: store.blob(s['fileId']) for s in sources}
            current_config = store.meta.get('projectConfiguration', {})
            require(current_config.get('configVersion') == job['configVersion'],
                    'PROJECT_CONFIGURATION_CHANGED', 'Execution configuration changed; create a new request')
            config = deepcopy(job['configuration'])
        require(all(sha256(blobs[s['id']]).hexdigest() == s['fileHash'] for s in sources),
                'EVIDENCE_INVALID', 'Source blob hash mismatch')
        result = provider.analyze(run, sources, blobs, config, timeout=max(1, lease_seconds - 5))
        state = finish(store, job_id, job['token'], result=result)
    except Exception as exc:
        # Failed output validation rolled the transaction back before this branch.
        state = finish(store, job_id, job['token'], error=exc)
    queue.acknowledge(message_id)
    return state
