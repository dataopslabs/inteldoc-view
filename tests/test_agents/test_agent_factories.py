"""Unit tests for Strands agent factory functions.

Validates Requirements 1.1–1.6:
- Each create_*_agent factory returns a Strands Agent with the correct
  system_prompt, tools list, and BedrockModel.
- _get_model_provider uses the default model ID when none is provided
  and a custom model ID when one is given.
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

CUSTOM_MODEL_ID = "anthropic.claude-3-sonnet-20240229-v1:0"
DEFAULT_MODEL_ID = "anthropic.claude-3-haiku-20240307-v1:0"
SYSTEM_PROMPT = "You are a helpful agent."


# ---------------------------------------------------------------------------
# _get_model_provider tests (Requirement 1.5)
# ---------------------------------------------------------------------------

class TestGetModelProvider:
    """Tests for the shared _get_model_provider helper."""

    @patch("services.workflow.agents.BedrockModel")
    def test_uses_default_model_id_when_none(self, mock_bedrock_cls):
        from services.workflow.agents import _get_model_provider, DEFAULT_MODEL_ID

        _get_model_provider(None)

        mock_bedrock_cls.assert_called_once()
        call_kwargs = mock_bedrock_cls.call_args[1]
        assert call_kwargs["model_id"] == DEFAULT_MODEL_ID

    @patch("services.workflow.agents.BedrockModel")
    def test_uses_custom_model_id_when_provided(self, mock_bedrock_cls):
        from services.workflow.agents import _get_model_provider

        _get_model_provider(CUSTOM_MODEL_ID)

        mock_bedrock_cls.assert_called_once()
        call_kwargs = mock_bedrock_cls.call_args[1]
        assert call_kwargs["model_id"] == CUSTOM_MODEL_ID

    @patch("services.workflow.agents.BedrockModel")
    def test_passes_region_name(self, mock_bedrock_cls):
        from services.workflow.agents import _get_model_provider

        _get_model_provider("some-model")

        call_kwargs = mock_bedrock_cls.call_args[1]
        assert "region_name" in call_kwargs


# ---------------------------------------------------------------------------
# Parsing Agent factory tests (Requirement 1.1, 1.5, 1.6)
# ---------------------------------------------------------------------------

class TestCreateParsingAgent:
    """Tests for create_parsing_agent."""

    @patch("services.workflow.agents.parsing.Agent")
    @patch("services.workflow.agents.parsing._get_model_provider")
    def test_returns_agent_with_correct_prompt(self, mock_model, mock_agent_cls):
        from services.workflow.agents.parsing import create_parsing_agent

        mock_model.return_value = MagicMock(name="bedrock_model")
        mock_agent_cls.return_value = MagicMock(name="agent_instance")

        agent = create_parsing_agent(SYSTEM_PROMPT)

        mock_agent_cls.assert_called_once()
        call_kwargs = mock_agent_cls.call_args[1]
        assert call_kwargs["system_prompt"] == SYSTEM_PROMPT

    @patch("services.workflow.agents.parsing.Agent")
    @patch("services.workflow.agents.parsing._get_model_provider")
    def test_tools_contain_parse_doc(self, mock_model, mock_agent_cls):
        from services.workflow.agents.parsing import create_parsing_agent, parse_doc

        mock_model.return_value = MagicMock(name="bedrock_model")
        mock_agent_cls.return_value = MagicMock(name="agent_instance")

        create_parsing_agent(SYSTEM_PROMPT)

        call_kwargs = mock_agent_cls.call_args[1]
        assert parse_doc in call_kwargs["tools"]

    @patch("services.workflow.agents.parsing.Agent")
    @patch("services.workflow.agents.parsing._get_model_provider")
    def test_model_passed_to_agent(self, mock_model, mock_agent_cls):
        from services.workflow.agents.parsing import create_parsing_agent

        sentinel_model = MagicMock(name="bedrock_model")
        mock_model.return_value = sentinel_model
        mock_agent_cls.return_value = MagicMock(name="agent_instance")

        create_parsing_agent(SYSTEM_PROMPT, model_id=CUSTOM_MODEL_ID)

        mock_model.assert_called_once_with(CUSTOM_MODEL_ID)
        call_kwargs = mock_agent_cls.call_args[1]
        assert call_kwargs["model"] is sentinel_model


# ---------------------------------------------------------------------------
# Extraction Agent factory tests (Requirement 1.2, 1.5, 1.6)
# ---------------------------------------------------------------------------

class TestCreateExtractionAgent:
    """Tests for create_extraction_agent."""

    @patch("services.workflow.agents.extraction.Agent")
    @patch("services.workflow.agents.extraction._get_model_provider")
    def test_returns_agent_with_correct_prompt(self, mock_model, mock_agent_cls):
        from services.workflow.agents.extraction import create_extraction_agent

        mock_model.return_value = MagicMock(name="bedrock_model")
        mock_agent_cls.return_value = MagicMock(name="agent_instance")

        create_extraction_agent(SYSTEM_PROMPT)

        call_kwargs = mock_agent_cls.call_args[1]
        assert call_kwargs["system_prompt"] == SYSTEM_PROMPT

    @patch("services.workflow.agents.extraction.Agent")
    @patch("services.workflow.agents.extraction._get_model_provider")
    def test_tools_contain_extract(self, mock_model, mock_agent_cls):
        from services.workflow.agents.extraction import create_extraction_agent, extract

        mock_model.return_value = MagicMock(name="bedrock_model")
        mock_agent_cls.return_value = MagicMock(name="agent_instance")

        create_extraction_agent(SYSTEM_PROMPT)

        call_kwargs = mock_agent_cls.call_args[1]
        assert extract in call_kwargs["tools"]

    @patch("services.workflow.agents.extraction.Agent")
    @patch("services.workflow.agents.extraction._get_model_provider")
    def test_model_passed_to_agent(self, mock_model, mock_agent_cls):
        from services.workflow.agents.extraction import create_extraction_agent

        sentinel_model = MagicMock(name="bedrock_model")
        mock_model.return_value = sentinel_model
        mock_agent_cls.return_value = MagicMock(name="agent_instance")

        create_extraction_agent(SYSTEM_PROMPT, model_id=CUSTOM_MODEL_ID)

        mock_model.assert_called_once_with(CUSTOM_MODEL_ID)
        call_kwargs = mock_agent_cls.call_args[1]
        assert call_kwargs["model"] is sentinel_model


# ---------------------------------------------------------------------------
# Validation Agent factory tests (Requirement 1.3, 1.5, 1.6)
# ---------------------------------------------------------------------------

class TestCreateValidationAgent:
    """Tests for create_validation_agent."""

    @patch("services.workflow.agents.validation.Agent")
    @patch("services.workflow.agents.validation._get_model_provider")
    def test_returns_agent_with_correct_prompt(self, mock_model, mock_agent_cls):
        from services.workflow.agents.validation import create_validation_agent

        mock_model.return_value = MagicMock(name="bedrock_model")
        mock_agent_cls.return_value = MagicMock(name="agent_instance")

        create_validation_agent(SYSTEM_PROMPT)

        call_kwargs = mock_agent_cls.call_args[1]
        assert call_kwargs["system_prompt"] == SYSTEM_PROMPT

    @patch("services.workflow.agents.validation.Agent")
    @patch("services.workflow.agents.validation._get_model_provider")
    def test_tools_contain_validate(self, mock_model, mock_agent_cls):
        from services.workflow.agents.validation import create_validation_agent, validate

        mock_model.return_value = MagicMock(name="bedrock_model")
        mock_agent_cls.return_value = MagicMock(name="agent_instance")

        create_validation_agent(SYSTEM_PROMPT)

        call_kwargs = mock_agent_cls.call_args[1]
        assert validate in call_kwargs["tools"]

    @patch("services.workflow.agents.validation.Agent")
    @patch("services.workflow.agents.validation._get_model_provider")
    def test_model_passed_to_agent(self, mock_model, mock_agent_cls):
        from services.workflow.agents.validation import create_validation_agent

        sentinel_model = MagicMock(name="bedrock_model")
        mock_model.return_value = sentinel_model
        mock_agent_cls.return_value = MagicMock(name="agent_instance")

        create_validation_agent(SYSTEM_PROMPT, model_id=CUSTOM_MODEL_ID)

        mock_model.assert_called_once_with(CUSTOM_MODEL_ID)
        call_kwargs = mock_agent_cls.call_args[1]
        assert call_kwargs["model"] is sentinel_model


# ---------------------------------------------------------------------------
# Reconciliation Agent factory tests (Requirement 1.4, 1.5, 1.6)
# ---------------------------------------------------------------------------

class TestCreateReconciliationAgent:
    """Tests for create_reconciliation_agent."""

    @patch("services.workflow.agents.reconciliation.Agent")
    @patch("services.workflow.agents.reconciliation._get_model_provider")
    def test_returns_agent_with_correct_prompt(self, mock_model, mock_agent_cls):
        from services.workflow.agents.reconciliation import create_reconciliation_agent

        mock_model.return_value = MagicMock(name="bedrock_model")
        mock_agent_cls.return_value = MagicMock(name="agent_instance")

        create_reconciliation_agent(SYSTEM_PROMPT)

        call_kwargs = mock_agent_cls.call_args[1]
        assert call_kwargs["system_prompt"] == SYSTEM_PROMPT

    @patch("services.workflow.agents.reconciliation.Agent")
    @patch("services.workflow.agents.reconciliation._get_model_provider")
    def test_tools_contain_reconcile_fields(self, mock_model, mock_agent_cls):
        from services.workflow.agents.reconciliation import (
            create_reconciliation_agent,
            reconcile_fields,
        )

        mock_model.return_value = MagicMock(name="bedrock_model")
        mock_agent_cls.return_value = MagicMock(name="agent_instance")

        create_reconciliation_agent(SYSTEM_PROMPT)

        call_kwargs = mock_agent_cls.call_args[1]
        assert reconcile_fields in call_kwargs["tools"]

    @patch("services.workflow.agents.reconciliation.Agent")
    @patch("services.workflow.agents.reconciliation._get_model_provider")
    def test_model_passed_to_agent(self, mock_model, mock_agent_cls):
        from services.workflow.agents.reconciliation import create_reconciliation_agent

        sentinel_model = MagicMock(name="bedrock_model")
        mock_model.return_value = sentinel_model
        mock_agent_cls.return_value = MagicMock(name="agent_instance")

        create_reconciliation_agent(SYSTEM_PROMPT, model_id=CUSTOM_MODEL_ID)

        mock_model.assert_called_once_with(CUSTOM_MODEL_ID)
        call_kwargs = mock_agent_cls.call_args[1]
        assert call_kwargs["model"] is sentinel_model
