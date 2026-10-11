"""Allowlisted synthetic scenarios and questions for the simulator prototype."""
from typing import Final

from app.simulator.schemas import (
    GovernancePreview,
    Question,
    Scenario,
    ScenarioId,
    SimulationRequest,
    SimulationResponse,
    SimulationResult,
    SimulatorCatalog,
)

_SCENARIOS: Final[dict[ScenarioId, Scenario]] = {
    "synthetic-baseline": Scenario(
        id="synthetic-baseline",
        title="Perfil sintético ilustrativo",
        description=(
            "Perfil fictício para demonstrar o contrato da API. Não representa "
            "uma amostra real nem uma avaliação de qualidade."
        ),
        example_context="Exemplo de demonstração; entradas canônicas não definidas.",
        question_ids=["prototype-scope", "rcs-status"],
    ),
    "synthetic-unknowns": Scenario(
        id="synthetic-unknowns",
        title="Perfil sintético com informações não especificadas",
        description=(
            "Perfil fictício que demonstra como a API comunica limites quando "
            "as regras e entradas normativas ainda não foram aprovadas."
        ),
        example_context="Exemplo de demonstração; nenhum valor é inferido.",
        question_ids=["rcs-status"],
    ),
}

_QUESTIONS: Final[dict[str, Question]] = {
    "prototype-scope": Question(
        id="prototype-scope",
        text="O que este protótipo demonstra?",
    ),
    "rcs-status": Question(
        id="rcs-status",
        text="Este cenário recebeu um cálculo ou classificação RCS?",
    ),
}

_DISCLAIMERS: Final[list[str]] = [
    "Simulação educacional exclusivamente com cenários sintéticos.",
    "Não é diagnóstico, decisão clínica, avaliação laboratorial ou certificação.",
    "O motor RCS não está implementado: regras, matriz e vetores aprovados ainda são necessários.",
    "Nenhuma entrada, pergunta ou resposta é persistida por este módulo.",
]


def get_catalog() -> SimulatorCatalog:
    """Return the fixed scenario and question allowlists."""
    return SimulatorCatalog(
        scenarios=list(_SCENARIOS.values()),
        questions=list(_QUESTIONS.values()),
        disclaimers=_DISCLAIMERS,
    )


def simulate(request: SimulationRequest) -> SimulationResponse:
    """Return a safe, deterministic contract preview without claiming an RCS result."""
    scenario = _SCENARIOS[request.scenario_id]
    if request.question_id not in scenario.question_ids:
        raise ValueError("A pergunta não está disponível para este cenário.")

    question = _QUESTIONS[request.question_id]
    if request.question_id == "prototype-scope":
        explanation = (
            "Este protótipo demonstra a seleção controlada de cenários sintéticos "
            "e o formato da resposta da API. Não executa regras SPREC nem calcula RCS."
        )
    else:
        explanation = (
            "Não. Nenhum score ou classificação RCS foi calculado. As regras "
            "normativas, a matriz e os vetores de referência ainda precisam ser aprovados."
        )

    return SimulationResponse(
        api_version="1",
        mode="contract_preview",
        scenario=scenario,
        question=question,
        governance=GovernancePreview(status="not_evaluated", evidence=[]),
        result=SimulationResult(
            status="not_calculated",
            rule_version=None,
            score=None,
            classification=None,
            matrix=None,
            axes=[],
        ),
        explanation=explanation,
        explanation_source="static_demo",
        disclaimers=_DISCLAIMERS,
    )
