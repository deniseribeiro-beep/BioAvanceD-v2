"""Typed request and response contracts for the synthetic simulator."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ScenarioId = Literal["synthetic-baseline", "synthetic-unknowns"]
QuestionId = Literal["prototype-scope", "rcs-status"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Scenario(StrictModel):
    id: ScenarioId
    title: str
    description: str
    example_context: str
    question_ids: list[QuestionId]


class Question(StrictModel):
    id: QuestionId
    text: str


class SimulatorCatalog(StrictModel):
    scenarios: list[Scenario]
    questions: list[Question]
    disclaimers: list[str]


class SimulationRequest(StrictModel):
    scenario_id: ScenarioId
    question_id: QuestionId


class GovernancePreview(StrictModel):
    status: Literal["not_evaluated"]
    evidence: list[str]


class SimulationResult(StrictModel):
    status: Literal["not_calculated"]
    rule_version: None
    score: None
    classification: None
    matrix: None
    axes: list[str] = Field(default_factory=list)


class SimulationResponse(StrictModel):
    api_version: Literal["1"]
    mode: Literal["contract_preview"]
    scenario: Scenario
    question: Question
    governance: GovernancePreview
    result: SimulationResult
    explanation: str
    explanation_source: Literal["static_demo"]
    disclaimers: list[str]
