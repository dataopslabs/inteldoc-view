import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { invokeModel } from '../lib/bedrock';

const bedrockMock = mockClient(BedrockRuntimeClient);

/** Helper: encode a Bedrock JSON response body as Uint8ArrayBlobAdapter */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function encodeBody(obj: unknown): any {
  return new TextEncoder().encode(JSON.stringify(obj));
}

beforeEach(() => {
  bedrockMock.reset();
  vi.useFakeTimers();
});

// ─── invokeModel ─────────────────────────────────────────────────────────────

describe('invokeModel', () => {
  it('returns parsed response and token counts on success', async () => {
    bedrockMock.on(InvokeModelCommand).resolves({
      body: encodeBody({
        content: [{ text: 'Hello from Claude' }],
        usage: { input_tokens: 150, output_tokens: 42 },
      }),
    });

    const result = await invokeModel('system prompt', [
      { role: 'user', content: 'Hi' },
    ]);

    expect(result.response).toBe('Hello from Claude');
    expect(result.inputTokens).toBe(150);
    expect(result.outputTokens).toBe(42);
  });

  it('retries once on ThrottlingException and returns success', async () => {
    const throttleError = new Error('Rate exceeded');
    throttleError.name = 'ThrottlingException';

    bedrockMock
      .on(InvokeModelCommand)
      .rejectsOnce(throttleError)
      .resolves({
        body: encodeBody({
          content: [{ text: 'Retry succeeded' }],
          usage: { input_tokens: 100, output_tokens: 20 },
        }),
      });

    const promise = invokeModel('system', [{ role: 'user', content: 'test' }]);

    // Advance past the 1-second sleep in the retry path
    await vi.advanceTimersByTimeAsync(1500);

    const result = await promise;

    expect(result.response).toBe('Retry succeeded');
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(20);
  });

  it('propagates error when both calls throw ThrottlingException', async () => {
    const throttleError1 = new Error('Rate exceeded');
    throttleError1.name = 'ThrottlingException';
    const throttleError2 = new Error('Rate exceeded');
    throttleError2.name = 'ThrottlingException';

    bedrockMock
      .on(InvokeModelCommand)
      .rejectsOnce(throttleError1)
      .rejectsOnce(throttleError2);

    // Catch the promise immediately to prevent unhandled rejection
    const promise = invokeModel('system', [{ role: 'user', content: 'test' }]).catch((e) => e);

    await vi.advanceTimersByTimeAsync(1500);

    const error = await promise;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe('ThrottlingException');
  });

  it('returns empty response string when content array is empty', async () => {
    bedrockMock.on(InvokeModelCommand).resolves({
      body: encodeBody({
        content: [],
        usage: { input_tokens: 50, output_tokens: 0 },
      }),
    });

    const result = await invokeModel('system', [{ role: 'user', content: 'test' }]);

    expect(result.response).toBe('');
    expect(result.inputTokens).toBe(50);
    expect(result.outputTokens).toBe(0);
  });
});
