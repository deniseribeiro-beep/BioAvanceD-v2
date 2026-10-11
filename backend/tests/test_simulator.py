import unittest
import asyncio

from fastapi import HTTPException
from pydantic import ValidationError

from app.api.simulator_routes import simulator_evaluate, simulator_scenarios
from app.simulator.catalog import get_catalog, simulate
from app.simulator.schemas import SimulationRequest


class SimulatorTestCase(unittest.TestCase):
    def test_catalog_contains_only_fixed_synthetic_options(self) -> None:
        catalog = get_catalog()
        self.assertEqual(
            {scenario.id for scenario in catalog.scenarios},
            {"synthetic-baseline", "synthetic-unknowns"},
        )
        self.assertTrue(all(scenario.question_ids for scenario in catalog.scenarios))

    def test_simulation_preview_never_claims_an_rcs_result(self) -> None:
        response = simulate(
            SimulationRequest(
                scenario_id="synthetic-baseline",
                question_id="rcs-status",
            )
        )
        self.assertEqual(response.result.status, "not_calculated")
        self.assertIsNone(response.result.score)
        self.assertIsNone(response.result.classification)
        self.assertEqual(response.governance.status, "not_evaluated")
        self.assertEqual(response.explanation_source, "static_demo")

    def test_request_rejects_free_text_and_unknown_ids(self) -> None:
        with self.assertRaises(ValidationError):
            SimulationRequest.model_validate(
                {
                    "scenario_id": "patient-provided",
                    "question_id": "any-free-text",
                }
            )
        with self.assertRaises(ValidationError):
            SimulationRequest.model_validate(
                {
                    "scenario_id": "synthetic-baseline",
                    "question_id": "rcs-status",
                    "clinical_text": "texto livre",
                }
            )

    def test_scenario_question_mismatch_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            simulate(
                SimulationRequest(
                    scenario_id="synthetic-unknowns",
                    question_id="prototype-scope",
                )
            )

    def test_api_handlers_return_catalog_and_safe_preview(self) -> None:
        catalog = asyncio.run(simulator_scenarios())
        self.assertEqual(len(catalog.scenarios), 2)

        response = asyncio.run(
            simulator_evaluate(
                SimulationRequest(
                    scenario_id="synthetic-baseline",
                    question_id="rcs-status",
                )
            )
        )
        self.assertEqual(response.mode, "contract_preview")
        self.assertEqual(response.result.status, "not_calculated")

    def test_api_handler_reports_scenario_question_mismatch(self) -> None:
        with self.assertRaises(HTTPException) as context:
            asyncio.run(
                simulator_evaluate(
                    SimulationRequest(
                        scenario_id="synthetic-unknowns",
                        question_id="prototype-scope",
                    )
                )
            )
        self.assertEqual(context.exception.status_code, 422)


if __name__ == "__main__":
    unittest.main()
