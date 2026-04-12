# Implementation Plan: Strands Workflow Engine

## Overview

Replace the Phase 2 linear processor with a multi-agent orchestration system built on the Strands Agents SDK. Each pipeline stage becomes a Strands agent with its own system prompt, tools, model configuration, and per-step telemetry. Implementation proceeds bottom-up: data models → prompt registry → agent definitions → orchestrator → handler integration → tests.

## Tasks

- [x] 1. Create data models and update workspace model
  - [x] 1.1 Create `services/workflow/models.py` with AgentStep, AgentConfig, and WorkflowResult Pydantic models
    - Define `AgentStep` with fields: agent_name, model_id, prompt_version, input_tokens, output_tokens, latency_ms, status, error_message
    - Define `AgentConfig` with fields: agent_name, model_id (optional), prompt_version (optional)
    - Define `WorkflowResult` with fields: trace_id, workspace_id, status, workflow_state, confidence, tokens, latency_ms, fields, agent_steps, validation_errors, error
    - Implement `to_api_response()` on WorkflowResult returning Phase 2-compatible dict
    - _Requirements: 4.2–4.8, 6.4_

  - [x] 1.2 Update `services/models.py` to add `agents` and `secondary_model_id` fields to the Workspace model
    - Add `agents: list[str | dict] = Field(default_factory=list)` to Workspace
    - Add `secondary_model_id: str | None = None` to Workspace
    - _Requirements: 8.1, 8.4_

  - [x] 1.3 Write property test for WorkflowResult backward compatibility (Property 11)
    - **Property 11: Workflow result maintains backward compatibility with Phase 2**
    - Generate random WorkflowResults with hypothesis, verify `to_api_response()` contains all required keys (trace_id, workspace_id, status, confidence, tokens, latency_ms, fields) and status is one of "completed", "hitl_required", "failed"
    - **Validates: Requirements 6.4**

  - [x] 1.4 Write property test for AgentStep required fields (Property 3)
    - **Property 3: Agent step records contain all required fields**
    - Generate random AgentStep instances, verify non-empty agent_name, model_id string, prompt_version string, non-negative token counts, positive latency_ms, status in {"success", "error"}
    - **Validates: Requirements 4.2, 4.3, 4.4, 4.5, 4.6, 4.7**

  - [x] 1.5 Write property tests for token and latency totals (Properties 4 and 5)
    - **Property 4: Total tokens equals sum of agent step tokens**
    - **Property 5: Total latency equals sum of agent step latencies**
    - Generate random lists of AgentSteps, verify total tokens = sum(input_tokens + output_tokens) and total latency = sum(latency_ms)
    - **Validates: Requirements 4.9, 4.10**

- [x] 2. Implement Prompt Registry
  - [x] 2.1 Create `services/workflow/prompts/__init__.py` with PromptRegistry class
    - Implement `get_prompt(agent_name, version)` returning `(prompt_text, actual_version)`
    - Implement `list_versions(agent_name)` returning sorted semver list
    - Scan `prompts/{agent_name}/` directory for `{version}.txt` files
    - Fall back to latest version if requested version not found, log warning
    - _Requirements: 5.1, 5.2, 5.3, 5.5_

  - [x] 2.2 Create initial prompt template files
    - Create `services/workflow/prompts/parsing/1.0.0.txt`
    - Create `services/workflow/prompts/extraction/1.0.0.txt`
    - Create `services/workflow/prompts/validation/1.0.0.txt`
    - Create `services/workflow/prompts/reconciliation/1.0.0.txt`
    - _Requirements: 5.1, 5.5_

  - [x] 2.3 Write property test for prompt version fallback (Property 8)
    - **Property 8: Prompt registry falls back to latest version**
    - Generate random version strings and registered versions, verify requesting non-existent version returns latest available and actual_version differs from requested
    - **Validates: Requirements 5.2, 5.3**

- [x] 3. Implement Strands Agent Definitions
  - [x] 3.1 Create `services/workflow/agents/__init__.py` with model provider helper
    - Implement `_get_model_provider(model_id)` returning `BedrockModel` instance
    - Use `BEDROCK_MODEL_ID` env var as default, `AWS_REGION_NAME` for region
    - _Requirements: 1.5_

  - [x] 3.2 Create `services/workflow/agents/parsing.py` with Parsing Agent
    - Define `parse_doc` tool wrapping `docling_client.parse_document`
    - Implement `create_parsing_agent(system_prompt, model_id)` factory
    - _Requirements: 1.1, 1.5, 1.6_

  - [x] 3.3 Create `services/workflow/agents/extraction.py` with Extraction Agent
    - Define `extract` tool wrapping `llm_reasoning.extract_fields`
    - Implement `create_extraction_agent(system_prompt, model_id)` factory
    - _Requirements: 1.2, 1.5, 1.6_

  - [x] 3.4 Create `services/workflow/agents/validation.py` with Validation Agent
    - Define `validate` tool wrapping `validation_service.validate_output`
    - Implement `create_validation_agent(system_prompt, model_id)` factory
    - _Requirements: 1.3, 1.5, 1.6_

  - [x] 3.5 Create `services/workflow/agents/reconciliation.py` with Reconciliation Agent
    - Define `reconcile_fields` tool wrapping `reconciliation.reconcile`
    - Implement `create_reconciliation_agent(system_prompt, model_id)` factory
    - _Requirements: 1.4, 1.5, 1.6_

  - [x] 3.6 Write unit tests for agent factory functions
    - Test each `create_*_agent` returns a Strands Agent with correct tools and model
    - Mock Strands SDK Agent class and BedrockModel
    - _Requirements: 1.1–1.6_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement Workflow Orchestrator
  - [x] 5.1 Create `services/workflow/orchestrator.py` with WorkflowOrchestrator class
    - Implement `__init__` accepting ProcessingEvent and workspace dict
    - Implement agent chain resolution: parse `workspace.agents` as list of strings or AgentConfig objects, fall back to default chain
    - Map agent names to factory functions (parsing → create_parsing_agent, etc.)
    - _Requirements: 2.1, 2.2, 8.2, 8.3_

  - [x] 5.2 Implement `_execute_agent` method with timing and metric collection
    - Wrap agent invocation with start/end timestamps for latency_ms
    - Extract input_tokens and output_tokens from Strands agent metrics
    - Record AgentStep with status "success" or "error"
    - On error, set error_message and re-raise
    - _Requirements: 4.1–4.8_

  - [x] 5.3 Implement `run()` method with sequential agent chain execution
    - Load prompts from PromptRegistry for each agent
    - Instantiate each agent via factory with prompt and model_id
    - Execute agents in chain order, passing output as next input
    - Update workflow state machine before each agent
    - Compute total tokens and latency from agent_steps
    - Determine final status based on confidence vs hitl_threshold
    - _Requirements: 2.1, 2.3, 2.4, 2.6, 4.9, 4.10_

  - [x] 5.4 Implement dual-pipeline logic in orchestrator
    - When "reconciliation" is in chain, run extraction twice before reconciliation
    - First run uses primary model_id, second uses workspace.secondary_model_id
    - Pass both extraction results to Reconciliation Agent
    - Handle secondary extraction failure: proceed with primary only, reduce confidence by 0.1
    - _Requirements: 3.1, 3.6, 3.7_

  - [x] 5.5 Implement error handling in orchestrator
    - Catch agent init errors (invalid model/prompt) → fail trace with config error message
    - Catch agent execution errors → record step, transition to failed, stop chain
    - Preserve prior agent steps on failure
    - Handle trace update failures → log both original and update errors
    - Record start timestamp for latency computation on failed traces
    - _Requirements: 2.5, 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 5.6 Write property test for agent chain execution order (Property 1)
    - **Property 1: Agent chain from workspace config determines execution order**
    - Generate random agent chain configs, verify agent_steps order matches config order
    - **Validates: Requirements 2.1, 2.3, 4.1, 4.2**

  - [x] 5.7 Write property test for default chain (Property 2)
    - **Property 2: Default agent chain is used when workspace agents is empty**
    - Generate random workspaces with empty/absent agents, verify default chain ["parsing", "extraction", "reconciliation", "validation"]
    - **Validates: Requirements 2.2**

  - [x] 5.8 Write property test for agent failure stops chain (Property 10)
    - **Property 10: Agent failure stops chain and preserves prior steps**
    - Generate random chain lengths and failure positions, verify agents after failure not executed, prior steps preserved, workflow state is failed
    - **Validates: Requirements 2.5, 7.1, 7.3**

  - [x] 5.9 Write property test for prompt version in agent step (Property 9)
    - **Property 9: Prompt version in agent step matches actual version used**
    - Generate agent executions with prompt fallback scenarios, verify AgentStep.prompt_version matches PromptRegistry actual_version
    - **Validates: Requirements 5.4**

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement Dual-Pipeline Reconciliation Logic
  - [x] 7.1 Implement reconciliation confidence rules in Reconciliation Agent tool
    - Both fields agree → confidence 1.0
    - Fields disagree → reduced confidence, flag as conflict
    - Only one field present → confidence 0.7, use available value
    - _Requirements: 3.2, 3.3, 3.4, 3.5_

  - [x] 7.2 Write property test for reconciliation confidence rules (Property 7)
    - **Property 7: Reconciliation confidence rules are consistent**
    - Generate random pairs of field dicts, verify: agreement → 1.0, disagreement → reduced, single value → 0.7
    - **Validates: Requirements 3.3, 3.4, 3.5**

  - [x] 7.3 Write property test for secondary extraction failure degradation (Property 12)
    - **Property 12: Secondary extraction failure degrades gracefully**
    - Generate random primary extraction results, simulate secondary failure, verify confidence reduced by 0.1
    - **Validates: Requirements 3.6**

  - [x] 7.4 Write unit tests for dual-pipeline orchestration
    - Test dual extraction with two different model IDs
    - Test secondary extraction timeout → reconciliation proceeds with primary only
    - Test chain without reconciliation → extraction runs once
    - _Requirements: 3.1, 3.6, 3.7_

- [x] 8. Update Handler and Lambda Integration
  - [x] 8.1 Update `services/workflow/handler.py` to delegate to WorkflowOrchestrator
    - Load workspace config from DynamoDB
    - Create ProcessingEvent from event payload
    - Instantiate WorkflowOrchestrator and call run()
    - Return `result.to_api_response()` for Phase 2 backward compatibility
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 8.2 Update `services/workflow/requirements.txt` with strands-agents dependencies
    - Add `strands-agents` and `strands-agents-bedrock` packages
    - Add `hypothesis` as dev dependency
    - _Requirements: 6.5_

  - [x] 8.3 Write unit tests for handler integration
    - Test handler delegates to orchestrator with correct event payload
    - Test response shape matches Phase 2 format
    - Mock DynamoDB workspace read and orchestrator
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 9. Workspace API Validation
  - [x] 9.1 Update workspace API handler to validate agent names in agents field
    - Validate that all agent_name values are recognized: parsing, extraction, validation, reconciliation
    - Return 400 error for unrecognized agent names
    - _Requirements: 8.5_

  - [x] 9.2 Write unit tests for workspace agent validation
    - Test valid agent names accepted
    - Test unrecognized agent name rejected with 400
    - Test mixed string/object agent configs parsed correctly
    - _Requirements: 8.2, 8.5_

- [ ] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The Phase 2 `runner.py` is kept for rollback but not modified
- All agent tools wrap existing Phase 2 service modules (docling_client, llm_reasoning, reconciliation, validation_service)
