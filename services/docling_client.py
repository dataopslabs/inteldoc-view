"""Bridge module: re-exports DoclingClient from the docling-client package.

The hyphenated package name ``docling-client`` cannot be imported with the
standard Python import system, so this module loads it via SourceFileLoader
and re-exports the public API.
"""
from __future__ import annotations

import importlib.machinery
import importlib.util
import os
import types

_HERE = os.path.dirname(__file__)
_INIT_PATH = os.path.join(_HERE, "docling-client", "__init__.py")

_loader = importlib.machinery.SourceFileLoader("_docling_client_impl", _INIT_PATH)
_spec = importlib.util.spec_from_loader("_docling_client_impl", _loader)
_mod = types.ModuleType("_docling_client_impl")
_loader.exec_module(_mod)

DoclingClient = _mod.DoclingClient

__all__ = ["DoclingClient"]
