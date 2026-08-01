# SPDX-License-Identifier: Apache-2.0
"""Shared fixtures. Every test here runs with no network and no keys.

Example::

    def test_something(fresh_state): ...
"""

from __future__ import annotations

from typing import Any

import pytest

from nanda_town_prava import reset_shared_state
from nanda_town_prava._simulator import SimulatedEngine
from nanda_town_prava.client import EngineTransportError

JsonDict = dict[str, Any]


@pytest.fixture(autouse=True)
def fresh_state() -> Any:
    """Drop the process-wide engine cache around every test."""
    reset_shared_state()
    yield
    reset_shared_state()


@pytest.fixture(autouse=True)
def no_ambient_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """No test may accidentally pick up a real engine or a real token."""
    for name in (
        "NANDA_PRAVA_MODE",
        "GMP_API",
        "ENGINE_API_TOKEN",
        "NANDA_PRAVA_AUTO_APPROVE_MOCK",
        "NANDA_PRAVA_AWAIT_SECONDS",
        "NANDA_PRAVA_TOLERANCE_BPS",
        "NANDA_PRAVA_CURRENCY",
        "NANDA_PRAVA_CREDIT_MINOR_UNITS",
    ):
        monkeypatch.delenv(name, raising=False)


class RailOverrideEngine(SimulatedEngine):
    """A simulator that forces a settlement rail, whatever the plugin asked for.

    Models an engine that downgraded to ``at_venue`` because the merchant is
    not reachable — the case where a receipt describes an agreement rather
    than a charge.

    Example::

        engine = RailOverrideEngine(rail="at_venue")
    """

    def __init__(self, *, rail: str) -> None:
        super().__init__()
        self._forced_rail = rail

    async def create_group(self, body: JsonDict) -> JsonDict:
        return await super().create_group({**body, "rail": self._forced_rail})


class StatusOverrideEngine(SimulatedEngine):
    """A simulator that reports a group status the plugin has never heard of.

    Example::

        engine = StatusOverrideEngine(status="quantum_superposition")
    """

    def __init__(self, *, status: str, member_status: str | None = None) -> None:
        super().__init__()
        self._forced_status = status
        self._forced_member_status = member_status

    async def get_group(self, group_id: str) -> JsonDict:
        view = await super().get_group(group_id)
        view["status"] = self._forced_status
        if self._forced_member_status is not None:
            for member in view["members"]:
                member["status"] = self._forced_member_status
        return view


class NoReceiptEngine(SimulatedEngine):
    """Terminal groups, but the signed receipt is never available.

    Example::

        engine = NoReceiptEngine()
    """

    async def get_receipt(self, group_id: str) -> JsonDict | None:
        return None


class UnreachableEngine(SimulatedEngine):
    """Reachable long enough to authorize, then gone.

    Example::

        engine = UnreachableEngine()
        engine.go_dark()
    """

    def __init__(self) -> None:
        super().__init__()
        self._dark = False

    def go_dark(self) -> None:
        self._dark = True

    async def get_group(self, group_id: str) -> JsonDict:
        if self._dark:
            msg = "GET /v1/groups did not complete: connection refused"
            raise EngineTransportError(msg)
        return await super().get_group(group_id)


class HostileEngine(SimulatedEngine):
    """An engine that tries to hand the plugin secret material.

    Example::

        engine = HostileEngine()
    """

    async def get_group(self, group_id: str) -> JsonDict:
        view = await super().get_group(group_id)
        view["api_key"] = "sk_" + "live_totally_real_key"
        view["debug"] = {"authorization": "Bearer abcdef123456", "wallet_secret": "hunter2"}
        return view
