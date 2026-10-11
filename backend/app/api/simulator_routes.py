"""Routes for the independent synthetic-only simulator prototype."""
from fastapi import APIRouter, HTTPException

from app.simulator.catalog import get_catalog, simulate
from app.simulator.schemas import (
    SimulationRequest,
    SimulationResponse,
    SimulatorCatalog,
)

router = APIRouter(prefix="/simulator", tags=["simulator"])


@router.get("/scenarios", response_model=SimulatorCatalog)
async def simulator_scenarios() -> SimulatorCatalog:
    """List the fixed synthetic scenarios and questions available to the demo."""
    return get_catalog()


@router.post("/evaluate", response_model=SimulationResponse)
async def simulator_evaluate(req: SimulationRequest) -> SimulationResponse:
    """Return a static contract preview; this endpoint does not calculate RCS."""
    try:
        return simulate(req)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
