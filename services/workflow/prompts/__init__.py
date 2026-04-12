"""Prompt Registry for versioned agent prompt templates.

Manages versioned prompt templates stored as text files in the prompts/ directory.
Each agent has a subdirectory containing {version}.txt files (e.g. prompts/parsing/1.0.0.txt).
"""
from __future__ import annotations

import logging
import os
import re
from pathlib import Path

logger = logging.getLogger(__name__)

# Regex matching a semver-style filename like "1.0.0.txt"
_VERSION_FILE_RE = re.compile(r"^(\d+(?:\.\d+)*)\.txt$")


def _parse_version_tuple(version: str) -> tuple[int, ...]:
    """Convert a dotted version string to a tuple of ints for comparison."""
    return tuple(int(part) for part in version.split("."))


class PromptRegistry:
    """Registry that loads versioned prompt templates from the filesystem.

    Directory layout::

        prompts/
        ├── parsing/
        │   └── 1.0.0.txt
        ├── extraction/
        │   ├── 1.0.0.txt
        │   └── 1.1.0.txt
        └── ...
    """

    def __init__(self, prompts_dir: str | None = None) -> None:
        if prompts_dir is None:
            prompts_dir = os.path.dirname(os.path.abspath(__file__))
        self._prompts_dir = Path(prompts_dir)

    def list_versions(self, agent_name: str) -> list[str]:
        """Return available prompt versions for *agent_name*, sorted by semver.

        Raises ``FileNotFoundError`` if the agent directory does not exist or
        contains no version files.
        """
        agent_dir = self._prompts_dir / agent_name
        if not agent_dir.is_dir():
            raise FileNotFoundError(
                f"No prompts directory for agent '{agent_name}' at {agent_dir}"
            )

        versions: list[str] = []
        for entry in agent_dir.iterdir():
            m = _VERSION_FILE_RE.match(entry.name)
            if m and entry.is_file():
                versions.append(m.group(1))

        if not versions:
            raise FileNotFoundError(
                f"No prompt versions found for agent '{agent_name}' in {agent_dir}"
            )

        versions.sort(key=_parse_version_tuple)
        return versions

    def get_prompt(self, agent_name: str, version: str) -> tuple[str, str]:
        """Load a prompt template for *agent_name* at *version*.

        Returns ``(prompt_text, actual_version)``.  If the requested version
        does not exist the latest available version is returned and a warning
        is logged.
        """
        versions = self.list_versions(agent_name)  # may raise FileNotFoundError

        if version in versions:
            actual_version = version
        else:
            actual_version = versions[-1]  # latest by semver
            logger.warning(
                "Prompt version '%s' not found for agent '%s'; "
                "falling back to latest version '%s'",
                version,
                agent_name,
                actual_version,
            )

        prompt_path = self._prompts_dir / agent_name / f"{actual_version}.txt"
        prompt_text = prompt_path.read_text(encoding="utf-8")
        return prompt_text, actual_version
