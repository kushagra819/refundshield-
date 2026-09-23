"""Vercel serverless entry point for the RefundShield API.

Vercel rewrites every `/api/*` request to this module (see `vercel.json`) and
serves the built React app for everything else, so the deployed site runs the
real FastAPI engines rather than a mocked copy of them.

The FastAPI application itself lives in `backend/app`, unchanged, so the test
suite and `uvicorn app.main:app` keep working exactly as documented in README.
"""
from __future__ import annotations

import os
import sys

# `backend/` is bundled alongside this file (vercel.json -> includeFiles), but it
# is not on the import path by default. Add it before importing the app package.
_BACKEND = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend")
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

from app.main import app  # noqa: E402  (path shim must run first)

# Vercel's Python runtime looks for a module-level ASGI callable named `app`.
__all__ = ["app"]
