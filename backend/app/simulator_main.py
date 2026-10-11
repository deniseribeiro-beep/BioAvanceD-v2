"""Standalone FastAPI entry point for the synthetic simulator prototype."""
from fastapi import FastAPI

from app.api.simulator_routes import router as simulator_router

app = FastAPI(
    title="BioAvanceD AI Simulator Prototype",
    description=(
        "Educational API preview limited to predefined synthetic scenarios. "
        "It does not calculate RCS or make clinical decisions."
    ),
    version="0.1.0",
)
app.include_router(simulator_router, prefix="/api/v1")
