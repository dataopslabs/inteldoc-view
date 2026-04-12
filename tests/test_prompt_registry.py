"""Unit tests for the PromptRegistry class.

Feature: strands-workflow-engine
Validates: Requirements 5.1, 5.2, 5.3, 5.5
"""
from __future__ import annotations

import os
import tempfile

import pytest

from services.workflow.prompts import PromptRegistry


@pytest.fixture()
def prompts_dir():
    """Create a temporary prompts directory with sample version files."""
    tmpdir = tempfile.mkdtemp()
    # Create agent directories with version files
    for agent, versions in {
        "parsing": ["1.0.0"],
        "extraction": ["1.0.0", "1.1.0", "2.0.0"],
        "validation": ["1.0.0"],
    }.items():
        agent_dir = os.path.join(tmpdir, agent)
        os.makedirs(agent_dir)
        for v in versions:
            with open(os.path.join(agent_dir, f"{v}.txt"), "w") as f:
                f.write(f"System prompt for {agent} v{v}")
    return tmpdir


class TestListVersions:
    def test_single_version(self, prompts_dir: str) -> None:
        reg = PromptRegistry(prompts_dir=prompts_dir)
        assert reg.list_versions("parsing") == ["1.0.0"]

    def test_multiple_versions_sorted(self, prompts_dir: str) -> None:
        reg = PromptRegistry(prompts_dir=prompts_dir)
        assert reg.list_versions("extraction") == ["1.0.0", "1.1.0", "2.0.0"]

    def test_missing_agent_raises(self, prompts_dir: str) -> None:
        reg = PromptRegistry(prompts_dir=prompts_dir)
        with pytest.raises(FileNotFoundError, match="No prompts directory"):
            reg.list_versions("nonexistent")

    def test_empty_agent_dir_raises(self, prompts_dir: str) -> None:
        os.makedirs(os.path.join(prompts_dir, "empty_agent"))
        reg = PromptRegistry(prompts_dir=prompts_dir)
        with pytest.raises(FileNotFoundError, match="No prompt versions found"):
            reg.list_versions("empty_agent")


class TestGetPrompt:
    def test_exact_version(self, prompts_dir: str) -> None:
        reg = PromptRegistry(prompts_dir=prompts_dir)
        text, actual = reg.get_prompt("extraction", "1.1.0")
        assert actual == "1.1.0"
        assert text == "System prompt for extraction v1.1.0"

    def test_fallback_to_latest(self, prompts_dir: str) -> None:
        reg = PromptRegistry(prompts_dir=prompts_dir)
        text, actual = reg.get_prompt("extraction", "9.9.9")
        assert actual == "2.0.0"
        assert text == "System prompt for extraction v2.0.0"

    def test_fallback_logs_warning(self, prompts_dir: str, caplog) -> None:
        import logging

        reg = PromptRegistry(prompts_dir=prompts_dir)
        with caplog.at_level(logging.WARNING):
            reg.get_prompt("extraction", "9.9.9")
        assert "falling back to latest version" in caplog.text

    def test_missing_agent_raises(self, prompts_dir: str) -> None:
        reg = PromptRegistry(prompts_dir=prompts_dir)
        with pytest.raises(FileNotFoundError):
            reg.get_prompt("nonexistent", "1.0.0")

    def test_default_prompts_dir(self) -> None:
        """PromptRegistry defaults to the directory containing __init__.py."""
        reg = PromptRegistry()
        expected = os.path.dirname(
            os.path.abspath(
                os.path.join("services", "workflow", "prompts", "__init__.py")
            )
        )
        assert str(reg._prompts_dir) == expected


# ---------------------------------------------------------------------------
# Property-based tests (hypothesis)
# ---------------------------------------------------------------------------
from hypothesis import given, settings, assume
import hypothesis.strategies as st


def _semver_strategy():
    """Strategy that generates semver-like version strings 'X.Y.Z'."""
    return st.tuples(
        st.integers(min_value=0, max_value=20),
        st.integers(min_value=0, max_value=20),
        st.integers(min_value=0, max_value=20),
    ).map(lambda t: f"{t[0]}.{t[1]}.{t[2]}")


def _version_sort_key(v: str) -> tuple[int, ...]:
    return tuple(int(p) for p in v.split("."))


class TestPromptVersionFallbackProperty:
    """Property 8: Prompt registry falls back to latest version.

    **Validates: Requirements 5.2, 5.3**
    """

    @given(
        registered=st.lists(
            _semver_strategy(), min_size=1, max_size=8, unique=True
        ),
        requested=_semver_strategy(),
    )
    @settings(max_examples=200, deadline=None)
    def test_fallback_returns_latest_when_version_missing(
        self, registered: list[str], requested: str
    ) -> None:
        """For any set of registered versions, requesting a non-existent
        version returns the latest available version and actual_version
        differs from the requested version.
        """
        # Ensure the requested version is NOT in the registered set
        assume(requested not in registered)

        # Build a temporary prompts directory with the registered versions
        tmpdir = tempfile.mkdtemp()
        agent_name = "test_agent"
        agent_dir = os.path.join(tmpdir, agent_name)
        os.makedirs(agent_dir)
        for v in registered:
            with open(os.path.join(agent_dir, f"{v}.txt"), "w") as f:
                f.write(f"prompt {v}")

        registry = PromptRegistry(prompts_dir=tmpdir)

        # Call get_prompt with the non-existent version
        _text, actual_version = registry.get_prompt(agent_name, requested)

        # The latest version by semver sort
        expected_latest = sorted(registered, key=_version_sort_key)[-1]

        # Verify: actual_version is the latest registered version
        assert actual_version == expected_latest

        # Verify: actual_version differs from the requested version
        assert actual_version != requested
