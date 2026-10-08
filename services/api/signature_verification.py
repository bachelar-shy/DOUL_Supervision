"""Trusted server-side adapters for legal signature verification.

This module does not verify signatures itself. A configured adapter must check
the stored original or provider receipt and return a normalized, bound receipt.
Client request fields are treated only as lookup inputs and are never trusted as
verification assertions.
"""

from copy import deepcopy
from dataclasses import dataclass
import hashlib
from typing import Any, Mapping, Protocol

from app.reference.documents import SIGNER_GROUPS
from app.reference.validation import ContractError, require


@dataclass(frozen=True)
class SignatureVerificationRequest:
    """Read-only inputs a trusted verifier needs to validate one signature."""

    document: Mapping[str, Any]
    rendered_bytes: bytes
    document_hash: str
    party_id: str
    role_assignment: Mapping[str, Any]
    signer_role: str
    method: str
    idempotency_key: str
    original_file_id: str | None = None
    original_file_bytes: bytes | None = None


class SignatureVerifier(Protocol):
    """A trusted integration that verifies provider/stored signature evidence."""

    def verify(
        self, request: SignatureVerificationRequest
    ) -> Mapping[str, Any]: ...


def _authorize_signing(documents, document, party_id, role_assignment):
    engine = documents.engine
    require(document["status"] in ["final", "signed"], "DOCUMENT_NOT_FINAL", "Draft cannot be signed")
    engine.authorize_read(document, party_id, role_assignment["id"])
    require(bool(document.get("primarySourceRef")), "DOCUMENT_SUBJECT_REQUIRED", "Legacy snapshot requires a new render with an explicit subject before signing")
    source = next(
        (
            item["record"]
            for item in document["sourcePayload"]["sources"]
            if item["ref"] == document["primarySourceRef"]
        ),
        None,
    )
    require(source is not None, "DOCUMENT_SUBJECT_REQUIRED", "Primary document source is unavailable")
    role = engine.authorize(source, "sign_legal_document", party_id, role_assignment["id"])
    return source, role


def _validate_signer_role(documents, document, role, signer_role, source):
    require(signer_role in document["sourcePayload"]["requiredSignatureRoles"], "SIGNATURE_ROLE_INVALID", signer_role)
    group, role_codes = SIGNER_GROUPS[signer_role]
    require(
        (group == "HUMAN" or group == role["actorGroup"])
        and (not role_codes or role["roleCode"] in role_codes),
        "SIGNATURE_ROLE_INVALID",
        "Stored assignment must match the required signer role",
    )
    if role["actorGroup"] in ["SUP", "CON", "DES"]:
        documents.engine._qualified(source, role)


def authorize_signing_request(
    documents,
    *,
    project_id: str,
    document_id: str,
    party_id: str,
    role_assignment: Mapping[str, Any],
    signer_role: str,
    method: str,
    document_hash: str,
):
    """Recheck current read/sign authority before cache replay or verification."""
    require(method in ["wet_original_verified", "approved_e_signature"], "SIGNATURE_METHOD_INVALID", method)
    require(isinstance(document_hash, str) and bool(document_hash), "DOCUMENT_HASH_REQUIRED", "Exact rendered document hash is required")
    document = documents.get(document_id)
    require(document["projectId"] == project_id, "PROJECT_MISMATCH", "Document project mismatch")
    require(document.get("renderHash") == document_hash, "DOCUMENT_HASH_MISMATCH", "Signer must confirm the current exact document hash")
    source, role = _authorize_signing(documents, document, party_id, role_assignment)
    _validate_signer_role(documents, document, role, signer_role, source)
    return deepcopy(document)


def load_verified_original_file(
    engine,
    *,
    project_id: str,
    party_id: str,
    role_assignment: Mapping[str, Any],
    original_file_id: str,
    blob_loader,
) -> bytes:
    """Load a visible, project-bound evidence original and verify its hash."""
    matches = [
        record
        for (kind, _), record in engine._records.items()
        if kind == "Evidence"
        and record.get("projectId") == project_id
        and record.get("fileId") == original_file_id
    ]
    require(len(matches) == 1, "SIGNATURE_ORIGINAL_REQUIRED", "Stored original evidence is unavailable")
    evidence = matches[0]
    require(evidence.get('sourceType') == 'original', 'SIGNATURE_ORIGINAL_REQUIRED', 'Legal original evidence must retain its original source provenance')
    engine.authorize_read(evidence, party_id, role_assignment["id"])
    try:
        content = blob_loader(original_file_id)
    except (KeyError, OSError):
        raise ContractError("SIGNATURE_ORIGINAL_REQUIRED", "Stored original evidence bytes are unavailable")
    require(isinstance(content, bytes), "SIGNATURE_ORIGINAL_REQUIRED", "Stored original evidence bytes are unavailable")
    require(
        hashlib.sha256(content).hexdigest() == evidence.get("fileHash"),
        "SIGNATURE_ORIGINAL_INTEGRITY_FAILED",
        "Stored original bytes do not match their preserved evidence hash",
    )
    return content


def verify_and_sign(
    verifier: SignatureVerifier | None,
    documents,
    *,
    project_id: str,
    document_id: str,
    party_id: str,
    role_assignment: Mapping[str, Any],
    signer_role: str,
    method: str,
    document_hash: str,
    idempotency_key: str,
    original_file_id: str | None = None,
    original_file_loader=None,
):
    """Verify externally, then delegate persistence and qualification checks.

    The caller must invoke this function inside the persistence write
    transaction and must obtain role/document from the authenticated request.
    ``original_file_loader`` is a trusted server callback that enforces file
    project ownership and returns preserved bytes.
    """
    require(verifier is not None, "ADAPTER_NOT_CONFIGURED", "A trusted legal-signature verifier is required")
    require(bool(idempotency_key), "IDEMPOTENCY_REQUIRED", "Signature key required")
    require(method in ["wet_original_verified", "approved_e_signature"], "SIGNATURE_METHOD_INVALID", method)
    require(isinstance(document_hash, str) and bool(document_hash), "DOCUMENT_HASH_REQUIRED", "Exact rendered document hash is required")

    document = authorize_signing_request(
        documents,
        project_id=project_id,
        document_id=document_id,
        party_id=party_id,
        role_assignment=role_assignment,
        signer_role=signer_role,
        method=method,
        document_hash=document_hash,
    )
    rendered_bytes = documents.rerender(document_id)
    computed_hash = hashlib.sha256(rendered_bytes).hexdigest()
    require(computed_hash == document["renderHash"], "DOCUMENT_INTEGRITY_FAILED", "Preserved document bytes do not match the legal render hash")

    original_file_bytes = None
    original_file_hash = None
    if method == "wet_original_verified":
        require(bool(original_file_id), "SIGNATURE_ORIGINAL_REQUIRED", "Verified original file required")
        require(callable(original_file_loader), "ADAPTER_NOT_CONFIGURED", "Trusted original-file storage is not configured")
        original_file_bytes = original_file_loader(original_file_id)
        require(isinstance(original_file_bytes, bytes) and bool(original_file_bytes), "SIGNATURE_ORIGINAL_REQUIRED", "Stored original file is unavailable")
        original_file_hash = hashlib.sha256(original_file_bytes).hexdigest()

    verify_request = SignatureVerificationRequest(
        document=deepcopy(document),
        rendered_bytes=rendered_bytes,
        document_hash=computed_hash,
        party_id=party_id,
        role_assignment=deepcopy(role_assignment),
        signer_role=signer_role,
        method=method,
        idempotency_key=idempotency_key,
        original_file_id=original_file_id,
        original_file_bytes=original_file_bytes,
    )
    try:
        receipt = verifier.verify(verify_request)
    except ContractError:
        raise
    except Exception:
        raise ContractError("SIGNATURE_VERIFIER_FAILED", "Trusted signature verification failed")

    require(isinstance(receipt, Mapping), "SIGNATURE_UNVERIFIED", "Verifier did not return a trusted receipt")
    require(receipt.get("verified") is True, "SIGNATURE_UNVERIFIED", "Verifier did not verify the signature")
    require(receipt.get("partyId") == party_id, "SIGNATURE_UNVERIFIED", "Verifier receipt signer does not match the authenticated party")
    require(receipt.get("documentHash") == computed_hash, "SIGNATURE_UNVERIFIED", "Verifier receipt does not bind the exact document hash")
    require(receipt.get("method") == method, "SIGNATURE_UNVERIFIED", "Verifier receipt does not bind the signature method")
    require(receipt.get("signerRole") == signer_role, "SIGNATURE_UNVERIFIED", "Verifier receipt does not bind the required signer role")
    if method == "wet_original_verified":
        require(receipt.get("originalFileId") == original_file_id, "SIGNATURE_UNVERIFIED", "Verifier receipt does not bind the stored original")
        require(receipt.get("originalFileHash") == original_file_hash, "SIGNATURE_UNVERIFIED", "Verifier receipt does not bind the stored original hash")

    trusted_receipt = deepcopy(dict(receipt))
    return documents.sign(
        document_id,
        party_id,
        role_assignment["id"],
        signer_role,
        method,
        trusted_receipt,
        idempotency_key,
    )


