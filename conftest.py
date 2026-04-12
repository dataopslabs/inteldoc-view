# Root conftest — ensures the project root is on sys.path for imports.
import sys
import os

# Add repo root so `services.*` imports resolve from project root
_root = os.path.dirname(os.path.abspath(__file__))
if _root not in sys.path:
    sys.path.insert(0, _root)
