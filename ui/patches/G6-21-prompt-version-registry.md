# G6-21: Prompt Version Registry in llm_reasoning.py

## File: `services/processor/llm_reasoning.py`

### Problem
`prompt_version` field is stored in workspace config but ignored during LLM calls.
All prompts use a single hardcoded template regardless of version.

### Solution: Add `PROMPT_REGISTRY` dict and use version in `extract_fields()`

---

## Complete replacement for prompt management section:

```python
# ── Prompt Version Registry ─────────────────────────────────────────────────

PROMPT_REGISTRY: dict[str, dict] = {
    "1.0.0": {
        "version": "1.0.0",
        "description": "Initial production prompt — structured extraction",
        "system_prompt": """You are an expert document analyst specializing in structured data extraction.
Your task is to extract specific fields from the provided document content with high accuracy.

Guidelines:
- Extract only information explicitly stated in the document
- Use null for fields that cannot be found
- Preserve original formatting for dates, amounts, and identifiers
- Flag low-confidence extractions in the confidence_scores object""",
        "user_template": """Extract the following fields from this document:

Fields to extract: {fields}

Document content:
{content}

Return a JSON object with:
- "extracted_fields": object with field names as keys
- "confidence_scores": object with field names and confidence (0.0-1.0)
- "extraction_notes": array of any ambiguities or issues found""",
        "max_tokens": 2048,
        "temperature": 0.1,
    },
    "1.1.0": {
        "version": "1.1.0",
        "description": "Improved prompt with chain-of-thought reasoning",
        "system_prompt": """You are an expert document analyst with deep expertise in structured information extraction.
Think step by step before extracting each field.

Guidelines:
- First identify document type and structure
- Then locate each requested field systematically
- Use null for absent fields; never guess
- For each field, cite the source text in extraction_notes
- Confidence should reflect certainty, not optimism""",
        "user_template": """Analyze this document and extract the requested fields using chain-of-thought reasoning.

Document type detection: First identify what type of document this is.
Fields to extract: {fields}

Document content:
{content}

Step 1: Identify document type and layout
Step 2: Locate each field
Step 3: Extract with confidence scores

Return JSON:
{{
  "document_type": "string",
  "extracted_fields": {{}},
  "confidence_scores": {{}},
  "extraction_notes": [],
  "reasoning_summary": "string"
}}""",
        "max_tokens": 4096,
        "temperature": 0.05,
    },
    "2.0.0": {
        "version": "2.0.0",
        "description": "Multi-pass extraction with table support",
        "system_prompt": """You are an expert document analyst. You specialize in:
1. Text extraction with semantic understanding
2. Table data extraction and normalization
3. Cross-referencing data points for validation
4. Financial document analysis (invoices, statements, contracts)

Always validate extracted data against document context.""",
        "user_template": """Perform comprehensive extraction from this document.

Fields requested: {fields}
Tables detected: {table_count}

Document content:
{content}

Table data (if any):
{table_data}

Return comprehensive JSON with all extracted fields, table summaries, and validation notes.""",
        "max_tokens": 8192,
        "temperature": 0.0,
        "requires_table_data": True,
    },
}

LATEST_PROMPT_VERSION = "1.1.0"  # current default


def get_prompt(version: str | None = None) -> dict:
    """
    Retrieve prompt config by version. Falls back to latest if version not found.

    Args:
        version: Semantic version string (e.g. "1.0.0"). None → use latest.

    Returns:
        Prompt configuration dict.
    """
    resolved = version or LATEST_PROMPT_VERSION

    if resolved in PROMPT_REGISTRY:
        return PROMPT_REGISTRY[resolved]

    # Try major.minor match (e.g. "1.1" matches "1.1.0")
    for registered_version, config in PROMPT_REGISTRY.items():
        if registered_version.startswith(resolved):
            return config

    # Fall back to latest with a warning
    import logging
    logging.warning(
        f"Prompt version '{resolved}' not found in registry. "
        f"Falling back to latest ({LATEST_PROMPT_VERSION}). "
        f"Available versions: {list(PROMPT_REGISTRY.keys())}"
    )
    return PROMPT_REGISTRY[LATEST_PROMPT_VERSION]
```

---

## Update `extract_fields()` to use registry:

```python
async def extract_fields(
    content: str,
    fields: list[str],
    workspace_config: dict | None = None,
    table_data: list[dict] | None = None,
) -> dict:
    """
    Extract structured fields from document content using versioned prompts.

    Args:
        content: Raw document text content
        fields: List of field names to extract
        workspace_config: Workspace config dict (contains prompt_version)
        table_data: Optional structured table data from Docling

    Returns:
        Extraction result dict with extracted_fields, confidence_scores, etc.
    """
    # Resolve prompt version from workspace config
    prompt_version = (workspace_config or {}).get("prompt_version") or LATEST_PROMPT_VERSION
    prompt_config = get_prompt(prompt_version)

    # Format the user prompt
    table_count = len(table_data) if table_data else 0
    table_str = ""
    if table_data and prompt_config.get("requires_table_data"):
        import json
        table_str = json.dumps(table_data, indent=2)[:4000]  # cap table data size

    user_message = prompt_config["user_template"].format(
        fields=", ".join(fields),
        content=content[:12000],  # cap content to avoid token overflow
        table_count=table_count,
        table_data=table_str or "No tables detected",
    )

    # Call Bedrock with versioned config
    response = await call_bedrock(
        system_prompt=prompt_config["system_prompt"],
        user_message=user_message,
        max_tokens=prompt_config.get("max_tokens", 2048),
        temperature=prompt_config.get("temperature", 0.1),
    )

    # Parse and validate response
    result = parse_llm_response(response)
    result["prompt_version_used"] = prompt_config["version"]

    return result
```

---

## Update `call_bedrock()` to accept system + user messages:

```python
async def call_bedrock(
    system_prompt: str,
    user_message: str,
    max_tokens: int = 2048,
    temperature: float = 0.1,
) -> str:
    """Call AWS Bedrock Claude with given prompts."""
    import boto3
    import json

    client = boto3.client("bedrock-runtime", region_name=os.environ.get("AWS_REGION", "us-east-1"))
    model_id = os.environ.get("BEDROCK_MODEL_ID", "anthropic.claude-3-haiku-20240307-v1:0")

    body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": max_tokens,
        "temperature": temperature,
        "system": system_prompt,
        "messages": [
            {"role": "user", "content": user_message}
        ],
    }

    response = client.invoke_model(
        modelId=model_id,
        body=json.dumps(body),
        contentType="application/json",
        accept="application/json",
    )

    response_body = json.loads(response["body"].read())
    return response_body["content"][0]["text"]
```

---

## Store `prompt_version_used` in trace result:

In the processor Lambda that writes to DynamoDB, ensure the trace result includes:
```python
trace_update = {
    "status": "completed",
    "result": {
        "extracted_fields": result.get("extracted_fields", {}),
        "confidence_scores": result.get("confidence_scores", {}),
        "extraction_notes": result.get("extraction_notes", []),
        "prompt_version_used": result.get("prompt_version_used", LATEST_PROMPT_VERSION),
        "document_type": result.get("document_type"),
    },
    "updated_at": datetime.utcnow().isoformat(),
}
```
