# Requirements Document

## Introduction

Phase 3 of the DocOps Agentic Document Intelligence Platform replaces the linear processor Lambda from Phase 2 with a multi-agent orchestration system built on the Strands Agents SDK. Each pipeline stage (document parsing, field extraction, validation, reconciliation) becomes a dedicated Strands agent with its own prompt, model configuration, and step-level telemetry. The system supports dual-pipeline reconciliation (running extraction twice with different prompts or models and comparing results for higher confidence), configurable agent chains per workspace, prompt versioning per agent step, and detailed agent step recording in the trace's agent_steps array. The existing workflow state machine and Phase 2 service modules (docling_client, llm_reasoning, reconciliation, validation_service) are preserved and wrapped by Strands agent tool definitions.

## Glossary

- **Strands_SDK**: The Strands Agents SDK (`strands-agents` Python package) used to define agents with system prompts, tools, and model providers. Each agent encapsulates a pipeline stage.
- **Workflow_Orchestrator**: The top-level Python module (`services/workflow/orchestrator.py`) that loads the workspace agent chain configuration and executes agents in sequence, passing outputs between them.
- **Parsing_Agent**: A Strands agent that wraps the existing Docling_Client to parse uploaded documents into structured markdown and extracted fields.
- **Extraction_Agent**: A Strands agent that wraps the existing LLM_Reasoning_Service to extract structured fields from parsed document text using Amazon Bedrock.
- **Validation_Agent**: A Strands agent that wraps the existing validation_service to validate extracted fields against the workspace schema, performing type coercion and constraint checks.
- **Reconciliation_Agent**: A Strands agent that compares outputs from two extraction runs (dual-pipeline) and produces a reconciled result with per-field confidence scores.
- **Agent_Step**: A structured record stored in the trace's agent_steps array, containing the agent name, input summary, output summary, model ID, prompt version, token counts (input and output), latency in milliseconds, and status (success or error).
- **Agent_Chain**: An ordered list of agent names configured on a workspace (the workspace.agents[] field) that determines which agents run and in what order for that workspace's documents.
- **Dual_Pipeline**: A reconciliation strategy where the Extraction_Agent runs twice with different prompts or model IDs, and the Reconciliation_Agent compares both outputs to produce higher-confidence results.
- **Prompt_Registry**: A module that stores and retrieves versioned prompt templates per agent, keyed by agent name and version string.
- **Processor_Lambda**: The existing Python Lambda function (`docops-processor`) whose handler is updated to invoke the Workflow_Orchestrator instead of the Phase 2 linear pipeline.
- **Trace**: A DynamoDB record in the `docops-traces` table that tracks the lifecycle and results of a single document processing request, including the agent_steps array.
- **Workspace_Schema**: A JSON object defined on a Workspace that describes the fields to extract from documents.
- **HITL_Threshold**: A numeric value (0.0–1.0) configured per Workspace. When the overall extraction confidence falls below this threshold, the trace is flagged for human review.

## Requirements

### Requirement 1: Strands Agent Definitions

**User Story:** As a platform developer, I want each pipeline stage defined as a Strands agent with its own system prompt and tools, so that stages are independently configurable and testable.

#### Acceptance Criteria

1. THE Workflow_Orchestrator SHALL define a Parsing_Agent using the Strands_SDK Agent class with a system prompt describing document parsing responsibilities and a tool that invokes the existing Docling_Client parse_document function.
2. THE Workflow_Orchestrator SHALL define an Extraction_Agent using the Strands_SDK Agent class with a system prompt describing field extraction responsibilities and a tool that invokes the existing LLM_Reasoning_Service extract_fields function.
3. THE Workflow_Orchestrator SHALL define a Validation_Agent using the Strands_SDK Agent class with a system prompt describing schema validation responsibilities and a tool that invokes the existing validation_service validate_output function.
4. THE Workflow_Orchestrator SHALL define a Reconciliation_Agent using the Strands_SDK Agent class with a system prompt describing dual-pipeline reconciliation responsibilities and a tool that invokes the existing reconciliation reconcile function.
5. WHEN a Strands agent is instantiated, THE Workflow_Orchestrator SHALL configure the agent's model provider using the model ID specified in the workspace Agent_Chain configuration for that agent, defaulting to the BEDROCK_MODEL_ID environment variable.
6. WHEN a Strands agent is instantiated, THE Workflow_Orchestrator SHALL load the agent's system prompt from the Prompt_Registry using the agent name and the prompt version from the workspace configuration.

### Requirement 2: Workflow Orchestrator and Agent Chaining

**User Story:** As a platform operator, I want the orchestrator to execute agents in the order defined by the workspace configuration, so that different workspaces can have different processing pipelines.

#### Acceptance Criteria

1. WHEN the Workflow_Orchestrator receives a processing event, THE Workflow_Orchestrator SHALL read the Agent_Chain from the workspace configuration to determine which agents to execute and in what order.
2. WHEN the workspace Agent_Chain is empty or not defined, THE Workflow_Orchestrator SHALL use the default chain: Parsing_Agent, Extraction_Agent, Reconciliation_Agent, Validation_Agent.
3. WHEN executing the Agent_Chain, THE Workflow_Orchestrator SHALL pass the output of each agent as input to the next agent in the chain.
4. WHEN executing the Agent_Chain, THE Workflow_Orchestrator SHALL update the workflow state machine to the corresponding state before each agent executes.
5. IF an agent in the chain raises an exception, THEN THE Workflow_Orchestrator SHALL record the error in the Agent_Step, transition the workflow to the failed state, and stop executing subsequent agents.
6. WHEN all agents in the chain complete successfully, THE Workflow_Orchestrator SHALL determine the final trace status based on the overall confidence score and the HITL_Threshold.

### Requirement 3: Dual-Pipeline Reconciliation

**User Story:** As a workspace owner, I want extraction to run twice with different configurations and have results compared, so that I get higher-confidence field extraction.

#### Acceptance Criteria

1. WHEN the workspace Agent_Chain includes the Reconciliation_Agent, THE Workflow_Orchestrator SHALL execute the Extraction_Agent twice: once with the primary prompt and model, and once with the secondary prompt and model configured on the workspace.
2. WHEN the dual extraction runs complete, THE Reconciliation_Agent SHALL compare the two sets of extracted fields using the existing reconcile function, producing per-field confidence scores.
3. WHEN both extraction runs produce the same value for a field, THE Reconciliation_Agent SHALL assign a confidence of 1.0 to that field.
4. WHEN the two extraction runs produce different values for a field, THE Reconciliation_Agent SHALL assign a reduced confidence score to that field and flag the field as a conflict.
5. WHEN only one extraction run produces a value for a field, THE Reconciliation_Agent SHALL assign a confidence of 0.7 to that field and use the available value.
6. IF the secondary extraction run fails, THEN THE Reconciliation_Agent SHALL proceed with only the primary extraction results and reduce overall confidence by 0.1.
7. WHEN the workspace Agent_Chain does not include the Reconciliation_Agent, THE Workflow_Orchestrator SHALL run the Extraction_Agent only once and skip reconciliation.

### Requirement 4: Agent Step Recording

**User Story:** As a platform operator, I want each agent's execution recorded with detailed metrics in the trace, so that I can monitor and debug the processing pipeline.

#### Acceptance Criteria

1. WHEN an agent completes execution (success or failure), THE Workflow_Orchestrator SHALL append an Agent_Step record to the trace's agent_steps array in DynamoDB.
2. THE Agent_Step record SHALL contain the agent_name field identifying which agent executed.
3. THE Agent_Step record SHALL contain the model_id field identifying which Bedrock model the agent used, or "none" for agents that do not invoke a model.
4. THE Agent_Step record SHALL contain the prompt_version field identifying which prompt version the agent used.
5. THE Agent_Step record SHALL contain the input_tokens and output_tokens fields with the token counts consumed by the agent, or 0 for agents that do not invoke a model.
6. THE Agent_Step record SHALL contain the latency_ms field with the agent's execution time in milliseconds.
7. THE Agent_Step record SHALL contain the status field with value "success" or "error".
8. IF the agent execution results in an error, THEN THE Agent_Step record SHALL contain an error_message field with the error description.
9. WHEN all agents complete, THE Workflow_Orchestrator SHALL compute the total tokens as the sum of all Agent_Step input_tokens and output_tokens, and store the total on the Trace record.
10. WHEN all agents complete, THE Workflow_Orchestrator SHALL compute the total latency as the sum of all Agent_Step latency_ms values, and store the total on the Trace record.

### Requirement 5: Prompt Versioning

**User Story:** As a platform developer, I want each agent step to record which prompt version was used, so that I can track prompt changes and their impact on extraction quality.

#### Acceptance Criteria

1. THE Prompt_Registry SHALL store prompt templates keyed by agent name and version string.
2. WHEN the Workflow_Orchestrator instantiates an agent, THE Prompt_Registry SHALL return the prompt template matching the agent name and the prompt_version from the workspace configuration.
3. IF the requested prompt version does not exist in the Prompt_Registry, THEN THE Prompt_Registry SHALL return the latest available version for that agent and log a warning.
4. THE Agent_Step record SHALL include the actual prompt_version used, which may differ from the requested version if a fallback occurred.
5. THE Prompt_Registry SHALL support registering new prompt versions without redeploying the Lambda function, by reading prompt templates from a prompts directory bundled with the Lambda code.

### Requirement 6: Processor Lambda Integration

**User Story:** As a platform operator, I want the existing processor Lambda to use the Strands workflow instead of the Phase 2 linear pipeline, so that the upgrade is seamless.

#### Acceptance Criteria

1. WHEN the Processor_Lambda receives an invocation event, THE Processor_Lambda SHALL delegate processing to the Workflow_Orchestrator instead of the Phase 2 linear handler.
2. THE Processor_Lambda SHALL pass the same event payload (trace_id, workspace_id, s3_key, filename, schema, hitl_threshold, prompt_version) to the Workflow_Orchestrator.
3. THE Workflow_Orchestrator SHALL read the workspace record from DynamoDB to obtain the Agent_Chain and any agent-specific configuration.
4. WHEN the Workflow_Orchestrator completes, THE Processor_Lambda SHALL return the same response shape as the Phase 2 handler (trace_id, workspace_id, status, confidence, tokens, latency_ms, fields).
5. THE ProcessingStack CDK handler path SHALL reference the workflow module handler (`workflow.handler.handler`).

### Requirement 7: Error Handling and Resilience

**User Story:** As a platform operator, I want the agent-based pipeline to handle failures gracefully at each agent step, so that partial results are preserved and errors are diagnosable.

#### Acceptance Criteria

1. IF an agent raises an exception during execution, THEN THE Workflow_Orchestrator SHALL catch the exception, record the error in the Agent_Step, and transition the workflow state to failed.
2. IF the trace status update fails during error handling, THEN THE Workflow_Orchestrator SHALL log both the original error and the update failure to CloudWatch Logs.
3. WHEN an agent fails, THE Workflow_Orchestrator SHALL preserve any Agent_Step records from previously completed agents on the trace record.
4. IF the Strands_SDK agent initialization fails (invalid model ID or prompt), THEN THE Workflow_Orchestrator SHALL update the Trace status to failed with an error message indicating the agent configuration error.
5. WHEN the Workflow_Orchestrator starts processing, THE Workflow_Orchestrator SHALL record the start timestamp so that total latency can be computed even for failed traces.

### Requirement 8: Workspace Agent Configuration

**User Story:** As a workspace owner, I want to configure which agents run and with what models for my workspace, so that I can customize the processing pipeline.

#### Acceptance Criteria

1. THE Workspace model SHALL support an agents field containing a list of agent configuration objects, each with agent_name, model_id (optional), and prompt_version (optional).
2. WHEN the agents field contains simple string values (agent names only), THE Workflow_Orchestrator SHALL treat each string as an agent_name with default model_id and prompt_version.
3. WHEN the agents field is empty or absent, THE Workflow_Orchestrator SHALL use the default Agent_Chain.
4. THE Workspace model SHALL support a secondary_model_id field used by the Reconciliation_Agent for the second extraction run in dual-pipeline mode.
5. WHEN a workspace update changes the agents field, THE API SHALL validate that all agent_name values in the list are recognized agent names.
