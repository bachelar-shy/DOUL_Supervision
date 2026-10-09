"""Test-only actual FastAPI fixture for connected Quality browser acceptance.

Run with ``python -m tests_browser.support.quality_api_fixture``. The fixture
uses demo project inputs in an isolated SQLite file; its signature verifier is
an explicit test double and cannot establish legal-provider acceptance.
"""

import argparse
import os

import uvicorn
from fastapi.responses import JSONResponse

from services.api.main import create_app


class MockTrustedVerifier:
    """TEST ONLY: deterministic signature boundary double."""

    def __init__(self):
        self.calls = []

    def verify(self, request):
        self.calls.append(request)
        return {
            "verified": True,
            "partyId": request.party_id,
            "documentHash": request.document_hash,
            "method": request.method,
            "signerRole": request.signer_role,
            "mockAdapter": True,
        }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.getenv("DOUL_QUALITY_FIXTURE_PORT", "8799")))
    parser.add_argument("--database", default=os.getenv("DOUL_QUALITY_FIXTURE_DB", ".local/quality-browser.sqlite3"))
    args = parser.parse_args()
    os.makedirs(os.path.dirname(os.path.abspath(args.database)), exist_ok=True)
    verifier = MockTrustedVerifier()
    app = create_app(args.database, demo=True, signature_verifier=verifier)

    async def verifier_calls():
        return JSONResponse({
            "testOnly": True,
            "verifier": "MockTrustedVerifier",
            "calls": [{
                "partyId": call.party_id,
                "documentHash": call.document_hash,
                "method": call.method,
                "signerRole": call.signer_role,
            } for call in verifier.calls],
        })

    app.add_api_route("/_test/signature-verifications", verifier_calls, methods=["GET"])
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
