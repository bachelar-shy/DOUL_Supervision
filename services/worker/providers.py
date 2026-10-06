"""Provider boundary: no default model, no synthetic success in normal operation."""
from __future__ import annotations

from typing import Protocol
from app.reference.validation import ContractError, require


class ProviderPort(Protocol):
    def analyze(self, run, sources, blobs, config, timeout): ...


class UnconfiguredProvider:
    def analyze(self, run, sources, blobs, config, timeout):
        raise ContractError('ADAPTER_NOT_CONFIGURED', 'No approved analysis provider is configured')


class FixtureProvider:
    """Explicit synthetic integration fixture; never a real photo assessment."""
    def __init__(self, demo=False):
        if not demo:
            raise RuntimeError('Synthetic provider requires explicit demonstration mode')

    def analyze(self, run, sources, blobs, config, timeout):
        require(run['model']['provider'] == 'development-fixture' and run['mode'] == 'photo',
                'ANALYSIS_PROFILE_CHANGED', 'Fixture accepts only its synthetic photo profile')
        return dict(outputs=[dict(kind='candidate', sourceEvidenceId=s['id'], analysisRunId=run['id'],
            description='SYNTHETIC WORKER FIXTURE - not a site assessment', confidence=0.0,
            reviewFlags=['synthetic_fixture', 'human_confirmation_required'],
            grounding=[dict(evidenceId=s['id'], channel='visual', claimSupport='observed')]) for s in sources],
            coverage=dict(sources=[dict(sourceEvidenceId=s['id'], analyzedRanges=[], missingRanges=[],
                                       audioProcessedRanges=[], complete=True) for s in sources]))
