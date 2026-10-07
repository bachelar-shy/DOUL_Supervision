import json
import unittest
from pathlib import Path

from app.reference.engine import uid
from app.reference.validation import ContractError
from tests.fixtures import AT, BEFORE, Fixture

ROOT = Path(__file__).resolve().parents[1]


def load(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


class MeasurementPaymentExecutionContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.execution = load("app/schema/measurement_payment_execution_contract_v1.json")
        cls.machines = load("app/schema/state_machines_v1.json")["machines"]
        cls.policies = load("app/schema/authority_matrix_v1.json")["policies"]
        cls.schemas = load("app/schema/domain_schemas_v2.json")["components"]["schemas"]

    def setUp(self):
        self.f = Fixture()

    def decision(
        self,
        target,
        object_type,
        outcome="approved",
        title="Owner decision",
        **scope_changes,
    ):
        oid = uid()
        scope = self.f.scope()
        scope.update(scope_changes)
        self.f.engine.bootstrap(
            "Decision",
            {
                "id": oid,
                "projectId": self.f.project,
                "status": "decided",
                "title": title,
                "targetRef": {"objectType": object_type, "objectId": target["id"], "version": target["version"]},
                "options": [{"id": "A"}],
                "impact": {"cost": "contractual"},
                "recommendation": outcome,
                "actionIds": [],
                "decision": outcome,
                "decisionReason": title,
                "decisionAt": AT,
                **scope,
            },
        )
        return self.f.engine.get("Decision", oid)

    def create_boq(self, number="BOQ-001", revision="B0", quantity="100", rate="20", amount="2000"):
        return self.f.create(
            "contract_boq",
            {
                "title": f"Contract BOQ {revision}",
                "revision": revision,
                "boq": {"boqNo": number},
            },
            "SUP",
        )

    def activate_boq(self, boq, quantity="100", rate="20", amount="2000"):
        line = {
            "boqItemId": "ITEM-001",
            "itemNo": "A.01",
            "description": "Concrete work",
            "unit": "m3",
            "contractQuantity": quantity,
            "unitRate": rate,
            "contractAmount": amount,
            "packageId": self.f.package,
            "discipline": "architecture",
            "locationScope": [self.f.location],
            "measurementRuleRef": self.f.ref("Requirement", self.f.requirement),
            "variationEligible": True,
            "provisional": False,
        }
        boq = self.f.command(
            "contract_boq",
            boq,
            "submit_boq",
            {
                "currency": "VND",
                "contractRef": self.f.ref("Requirement", self.f.requirement),
                "effectiveFrom": BEFORE,
                "sourceFileRefs": [self.f.ref("Evidence", self.f.evidence)],
                "lineItems": [line],
                "provisionalSumRules": [],
                "measurementRulesRef": self.f.ref("Requirement", self.f.requirement),
                "roundingRule": "contract-currency-rule-v1",
                "revisionBasisRefs": [],
            },
            actor="SUP",
            evidence=[self.f.evidence],
        )
        boq = self.f.command("contract_boq", boq, "start_boq_review", actor="SUP", evidence=[])
        boq = self.f.command("contract_boq", boq, "request_boq_decision", actor="SUP", evidence=[])
        decision = self.decision(boq, "InformationItem", "approved", "Approve Contract BOQ")
        boq = self.f.command(
            "contract_boq",
            boq,
            "approve_boq",
            {"ownerDecisionRef": self.f.ref("Decision", decision["id"])},
            actor="OWN",
            evidence=[self.f.evidence],
        )
        return self.f.command("contract_boq", boq, "activate_boq", actor="SUP", evidence=[])

    def accepted_inspection(self):
        inspection = self.f.inspect(self.f.inspection())
        return self.f.finish(inspection)

    def variation(self, status="proposed"):
        oid = uid()
        self.f.engine.bootstrap(
            "WorkItem",
            {
                "id": oid,
                "projectId": self.f.project,
                "subtype": "Variation",
                "title": f"Variation {status}",
                "status": status,
                "data": {},
                **self.f.scope(),
            },
        )
        return self.f.engine.get("WorkItem", oid)

    def measurement(self, boq, *, variation=None, inspection=None, claimed="80", verified="70"):
        measurement = self.f.create(
            "quantity_measurement",
            {"title": "Joint quantity measurement", "data": {"measurementNo": f"QM-{uid()[:8]}"}},
            "CON",
        )
        refs = [self.f.ref("WorkItem", variation["id"])] if variation else []
        inspections = [self.f.ref("Inspection", inspection["id"])] if inspection else []
        measurement = self.f.command(
            "quantity_measurement",
            measurement,
            "submit_measurement",
            {
                "periodStart": "2026-09-01T00:00:00Z",
                "periodEnd": "2026-09-30T23:59:59Z",
                "measuredAt": AT,
                "boqRef": self.f.ref("InformationItem", boq["id"]),
                "boqItemRef": {
                    "boqRef": self.f.ref("InformationItem", boq["id"]),
                    "boqItemId": "ITEM-001",
                },
                "claimedQuantity": claimed,
                "unit": "m3",
                "measurementMethod": "joint field measurement",
                "drawingRefs": [self.f.ref("InformationItem", self.f.drawing)],
                "inspectionRefs": inspections,
                "testRefs": [],
                "materialLotRefs": [],
                "changeRefs": [],
                "variationRefs": refs,
                "previousCertifiedQuantity": "0",
            },
            actor="CON",
            evidence=[self.f.evidence],
        )
        measurement = self.f.command("quantity_measurement", measurement, "receive_measurement", actor="SUP", evidence=[])
        measurement = self.f.command("quantity_measurement", measurement, "start_field_verification", actor="SUP", evidence=[])
        measurement = self.f.command(
            "quantity_measurement",
            measurement,
            "start_technical_verification",
            actor="SUP",
            evidence=[self.f.evidence],
        )
        return self.f.command(
            "quantity_measurement",
            measurement,
            "verify_quantity",
            {"verifiedQuantity": verified},
            actor="SUP",
            evidence=[self.f.evidence],
        )

    def payment_draft(self, number=None):
        return self.f.create(
            "payment_claim",
            {"title": "Interim payment claim", "data": {"paymentClaimNo": number or f"IPC-{uid()[:8]}"}},
            "CON",
        )

    def submit_payment(self, payment, boq, measurements, *, variation_components=None):
        return self.f.command(
            "payment_claim",
            payment,
            "submit_payment_claim",
            {
                "periodStart": "2026-09-01T00:00:00Z",
                "periodEnd": "2026-09-30T23:59:59Z",
                "contractRef": self.f.ref("Requirement", self.f.requirement),
                "boqRef": self.f.ref("InformationItem", boq["id"]),
                "currency": "VND",
                "quantityMeasurementRefs": [self.f.ref("WorkItem", x["id"]) for x in measurements],
                "claimedGrossAmount": "1000",
                "variationComponents": variation_components or [],
                "previousCertifiedAmount": "0",
                "previousPaidAmount": "0",
            },
            actor="CON",
            evidence=[self.f.evidence],
        )

    def advance_payment_to_recommendation(self, payment):
        payment = self.f.command("payment_claim", payment, "receive_payment_claim", actor="SUP", evidence=[])
        payment = self.f.command("payment_claim", payment, "start_quantity_review", actor="SUP", evidence=[])
        payment = self.f.command(
            "payment_claim",
            payment,
            "start_valuation_review",
            {"verifiedGrossAmount": "900", "disputedAmount": "100"},
            actor="SUP",
            evidence=[self.f.evidence],
        )
        payment = self.f.command(
            "payment_claim",
            payment,
            "prepare_recommendation",
            {
                "eligibleVariationAmount": "0",
                "eligibleMaterialOnSiteAmount": "0",
                "retentionAmount": "50",
                "advanceRecoveryAmount": "0",
                "otherDeductionAmount": "0",
                "taxAmount": "0",
                "recommendedNetAmount": "850",
                "deductionComponents": [],
                "calculationRuleRef": self.f.ref("Requirement", self.f.requirement),
                "reservationComment": "Verified eligible work only",
            },
            actor="SUP",
            evidence=[],
        )
        return self.f.command(
            "payment_claim",
            payment,
            "recommend_payment",
            actor="SUP",
            evidence=[self.f.evidence],
        )

    def test_f05_contract_is_typed_and_human_authorized(self):
        expected = {
            "contract_boq": ("InformationItem", "ContractBOQ"),
            "quantity_measurement": ("WorkItem", "QuantityMeasurement"),
            "payment_claim": ("WorkItem", "PaymentClaim"),
        }
        for name, (kind, subtype) in expected.items():
            self.assertEqual(self.machines[name]["object_type"], kind)
            self.assertEqual(self.machines[name]["subtype"], subtype)

        for authority, policy in self.policies.items():
            if authority.startswith("payment."):
                self.assertTrue(policy["official"])
                self.assertFalse({"AI", "SYSTEM", "INTEGRATION"} & set(policy["actor_groups"]))

        self.assertEqual(
            self.schemas["NonNegativeDecimalString"]["type"],
            "string",
        )
        self.assertFalse(self.execution["decimalContract"]["binaryFloatAuthoritative"])
        self.assertTrue(
            self.execution["boundaries"][
                "claimedVerifiedRecommendedOwnerApprovedPaidRemainSeparate"
            ]
        )

    def test_contract_boq_activation_supersedes_without_rewriting_history(self):
        first = self.activate_boq(self.create_boq("BOQ-001", "B0"))
        first_ref = self.f.ref("InformationItem", first["id"])
        second = self.activate_boq(self.create_boq("BOQ-002", "B1", amount="2400"), amount="2400")

        current_first = self.f.engine.get("InformationItem", first["id"])
        self.assertEqual(current_first["status"], "superseded")
        self.assertEqual(second["status"], "effective")
        self.assertEqual(second["boq"]["supersedesRef"], first_ref)
        historical = self.f.engine.resolve(first_ref, self.f.project)
        self.assertEqual(historical["status"], "effective")
        self.assertEqual(historical["boq"]["revision"], "B0")

    def test_verified_measurement_can_remain_payment_blocked(self):
        boq = self.activate_boq(self.create_boq())
        inspection = self.accepted_inspection()
        variation = self.variation("proposed")
        measurement = self.measurement(boq, variation=variation, inspection=inspection)

        self.assertEqual(measurement["status"], "verified")
        self.assertFalse(measurement["data"]["paymentEligible"])
        self.assertEqual(measurement["data"]["eligibilityStatus"], "blocked")
        self.assertIn("UNAPPROVED_VARIATION", measurement["data"]["blockedReasons"])
        self.assertEqual(measurement["data"]["claimedQuantity"], "80")
        self.assertEqual(measurement["data"]["verifiedQuantity"], "70")

    def test_duplicate_verified_measurement_cannot_be_claimed_twice(self):
        boq = self.activate_boq(self.create_boq())
        measurement = self.measurement(boq, inspection=self.accepted_inspection())
        first = self.submit_payment(self.payment_draft("IPC-001"), boq, [measurement])
        self.assertEqual(first["status"], "submitted")

        second = self.payment_draft("IPC-002")
        with self.assertRaises(ContractError) as error:
            self.submit_payment(second, boq, [measurement])
        self.assertEqual(error.exception.code, "DUPLICATE_CLAIM")

    def test_unapproved_variation_is_preserved_but_excluded_from_recommendation(self):
        boq = self.activate_boq(self.create_boq())
        measurement = self.measurement(boq, inspection=self.accepted_inspection())
        variation = self.variation("proposed")
        components = [
            {
                "variationRef": self.f.ref("WorkItem", variation["id"]),
                "claimedAmount": "100",
                "eligibleAmount": "0",
                "currency": "VND",
            }
        ]
        payment = self.submit_payment(self.payment_draft(), boq, [measurement], variation_components=components)
        payment = self.f.command("payment_claim", payment, "receive_payment_claim", actor="SUP", evidence=[])
        payment = self.f.command("payment_claim", payment, "start_quantity_review", actor="SUP", evidence=[])
        payment = self.f.command(
            "payment_claim",
            payment,
            "start_valuation_review",
            {"verifiedGrossAmount": "900", "disputedAmount": "100"},
            actor="SUP",
            evidence=[self.f.evidence],
        )
        self.assertEqual(payment["data"]["unapprovedVariationAmount"], "100")
        self.assertIn("UNAPPROVED_VARIATION", payment["data"]["blockedReasons"])

        payment = self.f.command(
            "payment_claim",
            payment,
            "prepare_recommendation",
            {
                "eligibleVariationAmount": "0",
                "eligibleMaterialOnSiteAmount": "0",
                "retentionAmount": "50",
                "advanceRecoveryAmount": "0",
                "otherDeductionAmount": "0",
                "taxAmount": "0",
                "recommendedNetAmount": "850",
                "deductionComponents": [],
                "calculationRuleRef": self.f.ref("Requirement", self.f.requirement),
            },
            actor="SUP",
            evidence=[],
        )
        self.assertEqual(payment["data"]["eligibleVariationAmount"], "0")
        self.assertEqual(payment["data"]["unapprovedVariationAmount"], "100")

    def test_owner_adjustment_and_partial_payment_preserve_all_amount_states(self):
        boq = self.activate_boq(self.create_boq())
        measurement = self.measurement(boq, inspection=self.accepted_inspection())
        payment = self.advance_payment_to_recommendation(
            self.submit_payment(self.payment_draft(), boq, [measurement])
        )
        self.assertEqual(payment["status"], "recommended")
        snapshot = payment["data"]["recommendationSnapshot"]
        self.assertEqual(snapshot["recommendedNetAmount"], "850")
        self.assertEqual(
            snapshot["claimBasisRef"]["version"],
            payment["version"] - 1,
        )

        payment = self.f.command("payment_claim", payment, "submit_owner_review", actor="SUP", evidence=[])
        decision = self.decision(payment, "WorkItem", "approved", "Owner adjusts certified amount")
        payment = self.f.command(
            "payment_claim",
            payment,
            "adjust_payment",
            {
                "ownerApprovedAmount": "800",
                "adjustmentReason": "Owner commercial adjustment",
                "decisionRefs": [self.f.ref("Decision", decision["id"])],
            },
            actor="OWN",
            evidence=[self.f.evidence],
        )
        self.assertEqual(payment["status"], "owner_adjusted")
        self.assertEqual(payment["data"]["claimedGrossAmount"], "1000")
        self.assertEqual(payment["data"]["verifiedGrossAmount"], "900")
        self.assertEqual(payment["data"]["recommendedNetAmount"], "850")
        self.assertEqual(payment["data"]["ownerApprovedAmount"], "800")

        payment = self.f.command(
            "payment_claim",
            payment,
            "record_payment",
            {
                "paidAmount": "500",
                "paidAt": AT,
                "paymentReference": "BANK-001",
                "externalSystemRef": "ERP-001",
            },
            actor="ADM",
            evidence=[self.f.evidence],
        )
        self.assertEqual(payment["status"], "payment_recorded")
        self.assertEqual(payment["data"]["paidAmount"], "500")
        self.assertEqual(payment["data"]["unpaidBalance"], "300")
        self.assertEqual(payment["data"]["ownerApprovedAmount"], "800")

        with self.assertRaises(ContractError) as close_error:
            self.f.command("payment_claim", payment, "close_payment_claim", actor="SUP", evidence=[])
        self.assertEqual(close_error.exception.code, "PAYMENT_CLOSE_READY")

        payment = self.f.command(
            "payment_claim",
            payment,
            "record_additional_payment",
            {
                "paidAmount": "800",
                "paidAt": AT,
                "paymentReference": "BANK-002",
                "externalSystemRef": "ERP-002",
            },
            actor="ADM",
            evidence=[self.f.evidence],
        )
        self.assertEqual(payment["data"]["ownerApprovedAmount"], "800")
        self.assertEqual(payment["data"]["paidAmount"], "800")
        self.assertEqual(payment["data"]["unpaidBalance"], "0")
        payment = self.f.command("payment_claim", payment, "close_payment_claim", actor="SUP", evidence=[])
        self.assertEqual(payment["status"], "closed")
        self.assertEqual(payment["data"]["cumulativeCertifiedAmount"], "800")
        self.assertEqual(payment["data"]["cumulativePaidAmount"], "800")

    def test_owner_decision_must_target_exact_current_payment_version(self):
        boq = self.activate_boq(self.create_boq())
        measurement = self.measurement(boq, inspection=self.accepted_inspection())
        payment = self.advance_payment_to_recommendation(
            self.submit_payment(self.payment_draft(), boq, [measurement])
        )
        payment = self.f.command("payment_claim", payment, "submit_owner_review", actor="SUP", evidence=[])

        wrong_scope = self.decision(
            payment,
            "WorkItem",
            "approved",
            "Wrong-scope payment decision",
            locationId=uid(),
        )
        with self.assertRaises(ContractError) as scope_error:
            self.f.command(
                "payment_claim",
                payment,
                "approve_payment",
                {
                    "ownerApprovedAmount": "850",
                    "decisionRefs": [self.f.ref("Decision", wrong_scope["id"])],
                },
                actor="OWN",
                evidence=[self.f.evidence],
            )
        self.assertEqual(scope_error.exception.code, "PAYMENT_OWNER_DECISION_REQUIRED")

        stale_target = dict(payment)
        stale_target["version"] -= 1
        decision = self.decision(stale_target, "WorkItem", "approved", "Stale payment decision")
        with self.assertRaises(ContractError) as error:
            self.f.command(
                "payment_claim",
                payment,
                "approve_payment",
                {
                    "ownerApprovedAmount": "850",
                    "decisionRefs": [self.f.ref("Decision", decision["id"])],
                },
                actor="OWN",
                evidence=[self.f.evidence],
            )
        self.assertEqual(error.exception.code, "PAYMENT_OWNER_DECISION_REQUIRED")

    def test_over_contract_quantity_is_verified_but_payment_blocked(self):
        boq = self.activate_boq(self.create_boq(quantity="100"))
        measurement = self.measurement(
            boq,
            inspection=self.accepted_inspection(),
            claimed="120",
            verified="120",
        )
        self.assertEqual(measurement["status"], "verified")
        self.assertFalse(measurement["data"]["paymentEligible"])
        self.assertIn(
            "EXCEEDS_CONTRACT_QUANTITY",
            measurement["data"]["blockedReasons"],
        )
        self.assertEqual(measurement["data"]["claimedQuantity"], "120")
        self.assertEqual(measurement["data"]["verifiedQuantity"], "120")

    def test_new_measurement_cannot_use_superseded_boq_version(self):
        first = self.activate_boq(self.create_boq("BOQ-001", "B0"))
        self.activate_boq(self.create_boq("BOQ-002", "B1"))
        draft = self.f.create(
            "quantity_measurement",
            {
                "title": "Stale BOQ measurement",
                "data": {"measurementNo": f"QM-{uid()[:8]}"},
            },
            "CON",
        )
        with self.assertRaises(ContractError) as error:
            self.f.command(
                "quantity_measurement",
                draft,
                "submit_measurement",
                {
                    "periodStart": "2026-09-01T00:00:00Z",
                    "periodEnd": "2026-09-30T23:59:59Z",
                    "measuredAt": AT,
                    "boqRef": self.f.ref("InformationItem", first["id"]),
                    "boqItemRef": {
                        "boqRef": self.f.ref("InformationItem", first["id"]),
                        "boqItemId": "ITEM-001",
                    },
                    "claimedQuantity": "10",
                    "unit": "m3",
                    "measurementMethod": "joint field measurement",
                    "drawingRefs": [self.f.ref("InformationItem", self.f.drawing)],
                    "inspectionRefs": [],
                    "testRefs": [],
                    "materialLotRefs": [],
                    "changeRefs": [],
                    "variationRefs": [],
                    "previousCertifiedQuantity": "0",
                },
                actor="CON",
                evidence=[self.f.evidence],
            )
        self.assertIn(
            error.exception.code,
            {"REFERENCE_STALE", "BOQ_STATUS_INVALID"},
        )

    def test_measurement_unit_must_match_exact_boq_line(self):
        boq = self.activate_boq(self.create_boq())
        draft = self.f.create(
            "quantity_measurement",
            {
                "title": "Wrong unit measurement",
                "data": {"measurementNo": f"QM-{uid()[:8]}"},
            },
            "CON",
        )
        with self.assertRaises(ContractError) as error:
            self.f.command(
                "quantity_measurement",
                draft,
                "submit_measurement",
                {
                    "periodStart": "2026-09-01T00:00:00Z",
                    "periodEnd": "2026-09-30T23:59:59Z",
                    "measuredAt": AT,
                    "boqRef": self.f.ref("InformationItem", boq["id"]),
                    "boqItemRef": {
                        "boqRef": self.f.ref("InformationItem", boq["id"]),
                        "boqItemId": "ITEM-001",
                    },
                    "claimedQuantity": "10",
                    "unit": "m2",
                    "measurementMethod": "joint field measurement",
                    "drawingRefs": [self.f.ref("InformationItem", self.f.drawing)],
                    "inspectionRefs": [],
                    "testRefs": [],
                    "materialLotRefs": [],
                    "changeRefs": [],
                    "variationRefs": [],
                    "previousCertifiedQuantity": "0",
                },
                actor="CON",
                evidence=[self.f.evidence],
            )
        self.assertEqual(error.exception.code, "UNIT_MISMATCH")

    def test_adm_cannot_exercise_technical_measurement_or_recommendation_authority(self):
        boq = self.activate_boq(self.create_boq())
        measurement = self.f.create(
            "quantity_measurement",
            {
                "title": "Authority boundary measurement",
                "data": {"measurementNo": f"QM-{uid()[:8]}"},
            },
            "CON",
        )
        measurement = self.f.command(
            "quantity_measurement",
            measurement,
            "submit_measurement",
            {
                "periodStart": "2026-09-01T00:00:00Z",
                "periodEnd": "2026-09-30T23:59:59Z",
                "measuredAt": AT,
                "boqRef": self.f.ref("InformationItem", boq["id"]),
                "boqItemRef": {
                    "boqRef": self.f.ref("InformationItem", boq["id"]),
                    "boqItemId": "ITEM-001",
                },
                "claimedQuantity": "10",
                "unit": "m3",
                "measurementMethod": "joint field measurement",
                "drawingRefs": [self.f.ref("InformationItem", self.f.drawing)],
                "inspectionRefs": [],
                "testRefs": [],
                "materialLotRefs": [],
                "changeRefs": [],
                "variationRefs": [],
                "previousCertifiedQuantity": "0",
            },
            actor="CON",
            evidence=[self.f.evidence],
        )
        measurement = self.f.command(
            "quantity_measurement",
            measurement,
            "receive_measurement",
            actor="SUP",
            evidence=[],
        )
        measurement = self.f.command(
            "quantity_measurement",
            measurement,
            "start_field_verification",
            actor="SUP",
            evidence=[],
        )
        measurement = self.f.command(
            "quantity_measurement",
            measurement,
            "start_technical_verification",
            actor="SUP",
            evidence=[self.f.evidence],
        )
        with self.assertRaises(ContractError) as verify_error:
            self.f.command(
                "quantity_measurement",
                measurement,
                "verify_quantity",
                {"verifiedQuantity": "10"},
                actor="ADM",
                evidence=[self.f.evidence],
            )
        self.assertEqual(verify_error.exception.code, "NOT_AUTHORIZED")

        verified = self.f.command(
            "quantity_measurement",
            measurement,
            "verify_quantity",
            {"verifiedQuantity": "10"},
            actor="SUP",
            evidence=[self.f.evidence],
        )
        payment = self.submit_payment(self.payment_draft(), boq, [verified])
        payment = self.f.command(
            "payment_claim",
            payment,
            "receive_payment_claim",
            actor="ADM",
            evidence=[],
        )
        payment = self.f.command(
            "payment_claim",
            payment,
            "start_quantity_review",
            actor="SUP",
            evidence=[],
        )
        payment = self.f.command(
            "payment_claim",
            payment,
            "start_valuation_review",
            {"verifiedGrossAmount": "900", "disputedAmount": "100"},
            actor="SUP",
            evidence=[self.f.evidence],
        )
        payment = self.f.command(
            "payment_claim",
            payment,
            "prepare_recommendation",
            {
                "eligibleVariationAmount": "0",
                "eligibleMaterialOnSiteAmount": "0",
                "retentionAmount": "50",
                "advanceRecoveryAmount": "0",
                "otherDeductionAmount": "0",
                "taxAmount": "0",
                "recommendedNetAmount": "850",
                "deductionComponents": [],
                "calculationRuleRef": self.f.ref("Requirement", self.f.requirement),
            },
            actor="SUP",
            evidence=[],
        )
        with self.assertRaises(ContractError) as recommend_error:
            self.f.command(
                "payment_claim",
                payment,
                "recommend_payment",
                actor="ADM",
                evidence=[self.f.evidence],
            )
        self.assertEqual(recommend_error.exception.code, "NOT_AUTHORIZED")

    def test_paid_amount_cannot_exceed_owner_approved_amount(self):
        boq = self.activate_boq(self.create_boq())
        measurement = self.measurement(boq, inspection=self.accepted_inspection())
        payment = self.advance_payment_to_recommendation(
            self.submit_payment(self.payment_draft(), boq, [measurement])
        )
        payment = self.f.command(
            "payment_claim",
            payment,
            "submit_owner_review",
            actor="SUP",
            evidence=[],
        )
        decision = self.decision(payment, "WorkItem", "approved", "Approve payment")
        payment = self.f.command(
            "payment_claim",
            payment,
            "approve_payment",
            {
                "ownerApprovedAmount": "850",
                "decisionRefs": [self.f.ref("Decision", decision["id"])],
            },
            actor="OWN",
            evidence=[self.f.evidence],
        )
        with self.assertRaises(ContractError) as error:
            self.f.command(
                "payment_claim",
                payment,
                "record_payment",
                {
                    "paidAmount": "851",
                    "paidAt": AT,
                    "paymentReference": "BANK-OVERPAY",
                    "externalSystemRef": "ERP-OVERPAY",
                },
                actor="ADM",
                evidence=[self.f.evidence],
            )
        self.assertEqual(error.exception.code, "PAYMENT_RECORD_READY")

    def test_decimal_schema_rejects_noncanonical_commercial_values(self):
        pattern = self.schemas["NonNegativeDecimalString"]["pattern"]
        import re

        self.assertIsNotNone(re.fullmatch(pattern, "0"))
        self.assertIsNotNone(re.fullmatch(pattern, "1250000.00"))
        self.assertIsNone(re.fullmatch(pattern, "01"))
        self.assertIsNone(re.fullmatch(pattern, "-1"))
        self.assertIsNone(re.fullmatch(pattern, "1e3"))
        self.assertIsNone(re.fullmatch(pattern, "NaN"))


if __name__ == "__main__":
    unittest.main()
