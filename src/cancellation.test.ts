import { describe, expect, it } from 'vitest';
import { createAbortController } from './cancellation';

describe('request cancellation', () => {
  it('aborts when the VS Code token is cancelled', () => {
    let handler: (() => void) | undefined;
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: (listener: () => void) => {
        handler = listener;
        return { dispose: () => { handler = undefined; } };
      },
    } as never;

    const controller = createAbortController(token);
    expect(controller.signal.aborted).toBe(false);
    handler?.();
    expect(controller.signal.aborted).toBe(true);
  });
});