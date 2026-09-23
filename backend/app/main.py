"""RefundShield API entry point.

    uvicorn app.main:app --reload --port 8000
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.investigation_routes import router as investigation_router
from .api.routes import router
from .config import SYNTHETIC_NOTICE

app = FastAPI(
    title="RefundShield",
    description=(
        "Investigation-prioritisation API for coordinated return abuse (CX0507). "
        + SYNTHETIC_NOTICE
    ),
    version="0.4.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173",
                   "http://localhost:4173", "http://127.0.0.1:4173"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
app.include_router(router, prefix="/api")
app.include_router(investigation_router, prefix="/api")


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "RefundShield", "docs": "/docs", "api": "/api",
            "notice": SYNTHETIC_NOTICE}
