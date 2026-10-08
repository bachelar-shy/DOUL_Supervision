"""HTTP acceptance for the F-05 BOQ, measured quantity and payment workflow."""
from copy import deepcopy
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from app.reference.engine import uid
from services.api.main import create_app


BEFORE = "2026-01-01T00:00:00Z"
AT = "2026-10-04T12:00:00Z"


class MeasurementPaymentHttpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.temp.name) / "payment.db")
        self.app = create_app(self.path, demo=True)
        self.client = TestClient(self.app)
        self._prepare_payment_fixture()

    def _prepare_payment_fixture(self):
        self.store = self.app.state.store
        self.project = self.store.meta["projectId"]
        self.scope = deepcopy(self.store.meta["scope"])
        self.requirement_id = self.store.meta["requirementRef"]["objectId"]
        self.evidence_id = self.store.meta["evidenceId"]
        self.engine = self.store.engine
        self.login("SUP")
        self.payment_rule_id = uid()
        with self.store.transaction(True):
            self.engine.bootstrap(
                "Requirement",
                {
                "id": self.payment_rule_id,
                "projectId": self.project,
                "kind": "contract",
                "title": "F-05 payment calculation rule",
                "effectiveFrom": BEFORE,
                "status": "active",
                "applicability": {
                    "paymentCalculationRule": {
                        "formulaId": "verified-eligible-net-v1",
                        "baseComponents": [
                            "verifiedGrossAmount",
                            "eligibleVariationAmount",
                            "eligibleMaterialOnSiteAmount",
                        ],
                        "addComponents": ["taxAmount"],
                        "subtractComponents": [
                            "retentionAmount",
                            "advanceRecoveryAmount",
                            "otherDeductionAmount",
                        ],
                        "deductionTypeMap": {
                            "retention": "retentionAmount",
                            "advance_recovery": "advanceRecoveryAmount",
                            "other": "otherDeductionAmount",
                        },
                        "rounding": {"id": "vnd-whole-half-up-v1", "quantum": "1", "mode": "half_up"},
                    }
                },
                    **self.scope,
                },
            )

    def tearDown(self):
        self.client.close()
        self.store.close()
        self.temp.cleanup()

    def login(self, group):
        response = self.client.post("/dev/sessions", json={"actorGroup": group})
        self.assertEqual(response.status_code, 200, response.text)
        self.session = response.json()
        self.role = self.session["actor"]["roleAssignmentId"]
        self.headers = {
            "Authorization": "Bearer " + self.session["accessToken"],
            "X-Role-Assignment-Id": self.role,
        }

    def ref(self, object_type, object_id):
        record = self.engine.get(object_type, object_id)
        return {"objectType": object_type, "objectId": object_id, "version": record["version"]}

    def command(self, collection, record, command, payload=None, *, actor=None, evidence=None, key=None, version=None):
        if actor:
            self.login(actor)
        body = {
            "roleAssignmentId": self.role,
            "expectedVersion": record["version"] if version is None else version,
            "payload": payload or {},
            "evidenceIds": [self.evidence_id] if evidence is None else evidence,
        }
        response = self.client.post(
            f"/projects/{self.project}/{collection}/{record['id']}/{command.replace('_', '-')}",
            headers={**self.headers, "Idempotency-Key": key or uid()},
            json=body,
        )
        return response

    def create(self, collection, payload, *, actor):
        self.login(actor)
        response = self.client.post(
            f"/projects/{self.project}/{collection}",
            headers={**self.headers, "Idempotency-Key": uid()},
            json={"roleAssignmentId": self.role, "clientObjectId": uid(), "payload": payload},
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["record"]

    def expect_command(self, collection, record, command, payload=None, *, actor=None, evidence=None):
        response = self.command(collection, record, command, payload, actor=actor, evidence=evidence)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["record"]

    def owner_decision(self, target, object_type, title):
        decision_id = uid()
        with self.store.transaction(True):
            self.engine.bootstrap(
                "Decision",
                {
                "id": decision_id,
                "projectId": self.project,
                "status": "decided",
                "title": title,
                "targetRef": {"objectType": object_type, "objectId": target["id"], "version": target["version"]},
                "options": [{"id": "A"}],
                "impact": {"cost": "contractual"},
                "recommendation": "approved",
                "actionIds": [],
                "decision": "approved",
                "decisionReason": title,
                "decisionAt": AT,
                    **self.scope,
                },
            )
        return self.ref("Decision", decision_id)

    def activate_boq(self):
        boq = self.create(
            "contract-boqs",
            {
                **self.scope,
                "subtype": "ContractBOQ",
                "title": "Contract BOQ B0",
                "revision": "B0",
                "boq": {"boqNo": "BOQ-HTTP-001"},
            },
            actor="SUP",
        )
        boq = self.expect_command(
            "contract-boqs",
            boq,
            "submit_boq",
            {
                "currency": "VND",
                "contractRef": self.ref("Requirement", self.requirement_id),
                "effectiveFrom": BEFORE,
                "sourceFileRefs": [self.ref("Evidence", self.evidence_id)],
                "lineItems": [
                    {
                        "boqItemId": "ITEM-001",
                        "itemNo": "A.01",
                        "description": "Concrete work",
                        "unit": "m3",
                        "contractQuantity": "100",
                        "unitRate": "20",
                        "contractAmount": "2000",
                        "packageId": self.scope["packageId"],
                        "discipline": self.scope["discipline"],
                        "locationScope": [self.scope["locationId"]],
                        "measurementRuleRef": self.ref("Requirement", self.requirement_id),
                        "variationEligible": True,
                        "provisional": False,
                    }
                ],
                "provisionalSumRules": [],
                "measurementRulesRef": self.ref("Requirement", self.requirement_id),
                "roundingRule": "contract-currency-rule-v1",
                "revisionBasisRefs": [],
            },
            evidence=[self.evidence_id],
        )
        boq = self.expect_command("contract-boqs", boq, "start_boq_review", evidence=[])
        boq = self.expect_command("contract-boqs", boq, "request_boq_decision", evidence=[])
        decision = self.owner_decision(boq, "InformationItem", "Approve Contract BOQ")
        boq = self.expect_command(
            "contract-boqs", boq, "approve_boq", {"ownerDecisionRef": decision},
            actor="OWN", evidence=[self.evidence_id],
        )
        return self.expect_command("contract-boqs", boq, "activate_boq", actor="SUP", evidence=[])

    def verify_measurement(self, boq):
        inspection = next(
            record for (kind, _), record in self.engine._records.items()
            if kind == "Inspection" and record["projectId"] == self.project and record.get("resultStatus") == "pass"
        )
        # The demo sample is a passed hold point awaiting release. Seed this
        # test's upstream record as already accepted and released so this case
        # exercises the payment eligibility hand-off without duplicating the
        # separate inspection release acceptance suite.
        accepted_inspection = deepcopy(inspection)
        accepted_inspection.update(id=uid(), version=1, status="passed", nextWorkAllowed=True, holdPoint=False)
        with self.store.transaction(True):
            self.engine.bootstrap("Inspection", accepted_inspection)
        inspection = accepted_inspection
        measurement = self.create(
            "quantity-measurements",
            {**self.scope, "subtype": "QuantityMeasurement", "title": "Joint quantity measurement", "data": {"measurementNo": "QM-HTTP-001"}},
            actor="CON",
        )
        measurement = self.expect_command(
            "quantity-measurements", measurement, "submit_measurement",
            {
                "periodStart": "2026-09-01T00:00:00Z",
                "periodEnd": "2026-09-30T23:59:59Z",
                "measuredAt": AT,
                "boqRef": self.ref("InformationItem", boq["id"]),
                "boqItemRef": {"boqRef": self.ref("InformationItem", boq["id"]), "boqItemId": "ITEM-001"},
                "claimedQuantity": "80.125",
                "unit": "m3",
                "measurementMethod": "joint field measurement",
                "drawingRefs": [self.ref("InformationItem", self.store.meta["drawingRef"]["objectId"])],
                "inspectionRefs": [self.ref("Inspection", inspection["id"])],
                "testRefs": [],
                "materialLotRefs": [],
                "changeRefs": [],
                "variationRefs": [],
                "previousCertifiedQuantity": "0",
            },
            actor="CON", evidence=[self.evidence_id],
        )
        measurement = self.expect_command("quantity-measurements", measurement, "receive_measurement", actor="SUP", evidence=[])
        measurement = self.expect_command("quantity-measurements", measurement, "start_field_verification", actor="SUP", evidence=[])
        measurement = self.expect_command("quantity-measurements", measurement, "start_technical_verification", actor="SUP", evidence=[self.evidence_id])
        return self.expect_command(
            "quantity-measurements", measurement, "verify_quantity", {"verifiedQuantity": "70.125"},
            actor="SUP", evidence=[self.evidence_id],
        )

    def submit_and_recommend(self, boq, measurement):
        claim = self.create(
            "payment-claims",
            {**self.scope, "subtype": "PaymentClaim", "title": "IPC-HTTP-001", "data": {"paymentClaimNo": "IPC-HTTP-001"}},
            actor="CON",
        )
        claim = self.expect_command(
            "payment-claims", claim, "submit_payment_claim",
            {
                "periodStart": "2026-09-01T00:00:00Z",
                "periodEnd": "2026-09-30T23:59:59Z",
                "contractRef": self.ref("Requirement", self.requirement_id),
                "boqRef": self.ref("InformationItem", boq["id"]),
                "currency": "VND",
                "quantityMeasurementRefs": [self.ref("WorkItem", measurement["id"])],
                "claimedGrossAmount": "1000.00",
                "variationComponents": [],
                "previousCertifiedAmount": "0",
                "previousPaidAmount": "0",
            },
            actor="CON", evidence=[self.evidence_id],
        )
        claim = self.expect_command("payment-claims", claim, "receive_payment_claim", actor="SUP", evidence=[])
        claim = self.expect_command("payment-claims", claim, "start_quantity_review", actor="SUP", evidence=[])
        claim = self.expect_command(
            "payment-claims", claim, "start_valuation_review",
            {"verifiedGrossAmount": "900", "disputedAmount": "100"}, actor="SUP", evidence=[self.evidence_id],
        )
        self.assertEqual(claim["data"]["claimedGrossAmount"], "1000.00")
        self.assertEqual(claim["data"]["verifiedGrossAmount"], "900")
        claim = self.expect_command(
            "payment-claims", claim, "prepare_recommendation",
            {
                "eligibleVariationAmount": "0",
                "eligibleMaterialOnSiteAmount": "0",
                "retentionAmount": "50",
                "advanceRecoveryAmount": "0",
                "otherDeductionAmount": "0",
                "taxAmount": "0",
                "recommendedNetAmount": "850",
                "deductionComponents": [{
                    "type": "retention", "basis": "contract payment rule", "amount": "50",
                    "currency": "VND", "contractClauseRef": self.ref("Requirement", self.requirement_id),
                }],
                "calculationRuleRef": self.ref("Requirement", self.payment_rule_id),
                "reservationComment": "Verified eligible work only",
            },
            actor="SUP", evidence=[],
        )
        return self.expect_command("payment-claims", claim, "recommend_payment", actor="SUP", evidence=[self.evidence_id])

    def test_http_full_workflow_owner_adjustment_and_append_only_payment_corrections(self):
        boq = self.activate_boq()
        measurement = self.verify_measurement(boq)
        self.assertEqual(measurement["status"], "verified")
        self.assertEqual(measurement["data"]["claimedQuantity"], "80.125")
        self.assertEqual(measurement["data"]["verifiedQuantity"], "70.125")
        self.assertTrue(measurement["data"]["paymentEligible"])

        claim = self.submit_and_recommend(boq, measurement)
        self.assertEqual(claim["status"], "recommended")
        self.assertEqual(claim["data"]["recommendedNetAmount"], "850")
        snapshot = claim["data"]["recommendationSnapshot"]
        self.assertEqual(snapshot["claimBasisRef"]["version"], claim["version"] - 1)
        self.assertEqual(snapshot["calculationTrace"]["formulaId"], "verified-eligible-net-v1")

        claim = self.expect_command("payment-claims", claim, "submit_owner_review", actor="SUP", evidence=[])
        decision = self.owner_decision(claim, "WorkItem", "Owner adjusts interim payment")
        claim = self.expect_command(
            "payment-claims", claim, "adjust_payment",
            {"ownerApprovedAmount": "800", "adjustmentReason": "Owner commercial adjustment", "decisionRefs": [decision]},
            actor="OWN", evidence=[self.evidence_id],
        )
        self.assertEqual(claim["status"], "owner_adjusted")
        self.assertEqual(claim["data"]["recommendedNetAmount"], "850")
        self.assertEqual(claim["data"]["ownerApprovedAmount"], "800")

        self.login("ADM")
        payment_key = "same-payment-request"
        payment_payload = {"paymentAmount": "500", "paidAt": AT, "paymentReference": "BANK-HTTP-001", "externalSystemRef": "ERP-HTTP-001"}
        payment_response = self.command(
            "payment-claims", claim, "record_payment", payment_payload,
            evidence=[self.evidence_id], key=payment_key,
        )
        self.assertEqual(payment_response.status_code, 200, payment_response.text)
        claim = payment_response.json()["record"]
        self.assertEqual(claim["data"]["paidAmount"], "500")
        self.assertEqual(claim["data"]["unpaidBalance"], "300")
        self.assertEqual(claim["data"]["ownerApprovedAmount"], "800")
        original = deepcopy(claim["data"]["paymentRecords"][0])

        # The identical HTTP retry returns the same official record and does not append again.
        body = {
            "roleAssignmentId": self.role,
            "expectedVersion": claim["version"] - 1,
            "payload": payment_payload,
            "evidenceIds": [self.evidence_id],
        }
        retry = self.client.post(
            f"/projects/{self.project}/payment-claims/{claim['id']}/record-payment",
            headers={**self.headers, "Idempotency-Key": payment_key}, json=body,
        )
        self.assertEqual(retry.status_code, 200, retry.text)
        self.assertEqual(retry.json(), payment_response.json())
        self.assertEqual(len(retry.json()["record"]["data"]["paymentRecords"]), 1)
        # A stale expected version with a new key is rejected atomically.
        stale = self.command(
            "payment-claims", claim, "record_payment",
            {"paymentAmount": "100", "paidAt": AT, "paymentReference": "BANK-STALE", "externalSystemRef": "ERP-STALE"},
            evidence=[self.evidence_id], key="stale-payment-version", version=claim["version"] - 1,
        )
        self.assertEqual(stale.status_code, 409, stale.text)
        self.assertEqual(stale.json()["code"], "VERSION_CONFLICT")
        claim = self.client.get(f"/projects/{self.project}/payment-claims/{claim['id']}", headers=self.headers).json()
        self.assertEqual(len(claim["data"]["paymentRecords"]), 1)

        # Correct the first payment, cancel that correction, then record the final balance.
        claim = self.expect_command(
            "payment-claims", claim, "correct_payment_record",
            {
                "supersedesPaymentRecordId": original["recordId"],
                "paymentAmount": "450",
                "paidAt": AT,
                "paymentReference": "BANK-HTTP-CORR-001",
                "correctionReason": "Bank advice corrected the first transfer",
            }, actor="ADM", evidence=[self.evidence_id],
        )
        correction_id = claim["data"]["paymentRecords"][-1]["recordId"]
        self.assertEqual(claim["data"]["paidAmount"], "450")
        claim = self.expect_command(
            "payment-claims", claim, "cancel_payment_record",
            {
                "supersedesPaymentRecordId": correction_id,
                "paidAt": AT,
                "paymentReference": "BANK-HTTP-CANCEL-001",
                "correctionReason": "Correction entry was voided",
            }, actor="ADM", evidence=[self.evidence_id],
        )
        self.assertEqual(claim["data"]["paidAmount"], "0")
        claim = self.expect_command(
            "payment-claims", claim, "record_additional_payment",
            {"paymentAmount": "800", "paidAt": AT, "paymentReference": "BANK-HTTP-002", "externalSystemRef": "ERP-HTTP-002"},
            actor="ADM", evidence=[self.evidence_id],
        )
        self.assertEqual(claim["data"]["paidAmount"], "800")
        self.assertEqual(claim["data"]["ownerApprovedAmount"], "800")
        self.assertEqual(len(claim["data"]["paymentRecords"]), 4)
        self.assertEqual(claim["data"]["paymentRecords"][0], original)
        self.assertEqual(claim["data"]["paymentRecords"][1]["kind"], "correction")
        self.assertEqual(claim["data"]["paymentRecords"][2]["kind"], "cancellation")
        self.assertEqual(claim["data"]["paymentRecords"][3]["kind"], "payment")

        claim = self.expect_command("payment-claims", claim, "close_payment_claim", actor="SUP", evidence=[])
        self.assertEqual(claim["status"], "closed")
        self.assertEqual(claim["data"]["cumulativeCertifiedAmount"], "800")
        self.assertEqual(claim["data"]["cumulativePaidAmount"], "800")

    def test_http_machine_authority_and_exact_owner_decision_are_enforced(self):
        boq = self.activate_boq()
        measurement = self.verify_measurement(boq)
        claim = self.create(
            "payment-claims",
            {**self.scope, "subtype": "PaymentClaim", "title": "IPC-HTTP-AUTH", "data": {"paymentClaimNo": "IPC-HTTP-AUTH"}},
            actor="CON",
        )
        denied = self.command(
            "payment-claims", claim, "submit_payment_claim",
            {
                "periodStart": "2026-09-01T00:00:00Z",
                "periodEnd": "2026-09-30T23:59:59Z",
                "contractRef": self.ref("Requirement", self.requirement_id),
                "boqRef": self.ref("InformationItem", boq["id"]),
                "currency": "VND",
                "quantityMeasurementRefs": [self.ref("WorkItem", measurement["id"])],
                "claimedGrossAmount": "1000",
                "variationComponents": [],
                "previousCertifiedAmount": "0",
                "previousPaidAmount": "0",
            }, actor="ADM", evidence=[self.evidence_id],
        )
        self.assertEqual(denied.status_code, 403, denied.text)
        self.assertEqual(self.client.get(f"/projects/{self.project}/payment-claims/{claim['id']}", headers=self.headers).json()["version"], claim["version"])

        claim = self.submit_and_recommend(boq, measurement)
        claim = self.expect_command("payment-claims", claim, "submit_owner_review", actor="SUP", evidence=[])
        stale_target = deepcopy(claim)
        stale_target["version"] -= 1
        wrong_decision = self.owner_decision(stale_target, "WorkItem", "Stale target decision")
        rejected = self.command(
            "payment-claims", claim, "approve_payment",
            {"ownerApprovedAmount": "850", "decisionRefs": [wrong_decision]}, actor="OWN", evidence=[self.evidence_id],
        )
        self.assertEqual(rejected.status_code, 409, rejected.text)
        self.assertEqual(rejected.json()["code"], "PAYMENT_OWNER_DECISION_REQUIRED")
        unchanged = self.client.get(f"/projects/{self.project}/payment-claims/{claim['id']}", headers=self.headers).json()
        self.assertEqual(unchanged["status"], "owner_review")
        self.assertEqual(unchanged["version"], claim["version"])


if __name__ == "__main__":
    unittest.main()
