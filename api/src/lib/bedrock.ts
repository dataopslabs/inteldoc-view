import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'anthropic.claude-3-haiku-20240307-v1:0';

// T4-17: Raised from 1024 → 4096 to prevent LLM response truncation on long documents.
// Claude 3 Haiku supports up to 4096 output tokens; use the full budget.
const MAX_OUTPUT_TOKENS = 4096;

// T4-02: Retry configuration for Bedrock throttling
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
const JITTER_MS = 1000;

export interface InvokeResult {
  response: string;
  inputTokens: number;
  outputTokens: number;
}

export async function invokeModel(
  system: string,
  messages: Array<{ role: string; content: string }>
): Promise<InvokeResult> {
  const body = JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: MAX_OUTPUT_TOKENS,
    system,
    messages,
  });

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body,
  });

  let lastErr: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await client.send(command);
      const parsed = JSON.parse(new TextDecoder().decode(result.body));
      return {
        response: parsed.content?.[0]?.text ?? '',
        inputTokens: parsed.usage?.input_tokens ?? 0,
        outputTokens: parsed.usage?.output_tokens ?? 0,
      };
    } catch (err: unknown) {
      lastErr = err;

      if (!isThrottlingError(err)) {
        // Non-retryable error — rethrow immediately
        throw err;
      }

      // T4-02: Exponential backoff with full jitter on throttling.
      // delay = min(BASE * 2^attempt, MAX) + random(0, JITTER)
      // This avoids thundering-herd when many Lambda instances hit throttle at once.
      if (attempt < MAX_RETRIES - 1) {
        const exponential = Math.min(BASE_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
        const jitter = Math.floor(Math.random() * JITTER_MS);
        await sleep(exponential + jitter);
      }
    }
  }

  throw lastErr;
}

function isThrottlingError(err: unknown): boolean {
  const error = err as Record<string, unknown>;
  return (
    error?.name === 'ThrottlingException' ||
    (error?.$metadata as Record<string, unknown>)?.httpStatusCode === 429
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
