"""Bridge module: re-exports LLMReasoningService from the llm-reasoning package.

The hyphenated package name ``llm-reasoning`` cannot be imported with the
standard Python import system, so this module loads it via SourceFileLoader
and re-exports the public API.
"""
from __future__ import annotations

import importlib.machinery
import importlib.util
import os
import types

_HERE = os.path.dirname(__file__)
_INIT_PATH = os.path.join(_HERE, "llm-reasoning", "__init__.py")

_loader = importlib.machinery.SourceFileLoader("_llm_reasoning_impl", _INIT_PATH)
_spec = importlib.util.spec_from_loader("_llm_reasoning_impl", _loader)
_mod = types.ModuleType("_llm_reasoning_impl")
_loader.exec_module(_mod)

LLMReasoningService = _mod.LLMReasoningService

__all__ = ["LLMReasoningService"]
