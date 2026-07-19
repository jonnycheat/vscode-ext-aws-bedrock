import { describe, expect, it } from 'vitest';
import { createProviderLogger } from './diagnostics';

describe('provider diagnostics', () => {
  it('does not serialize error details or secrets', () => {
    const messages: string[] = [];
    const output = {
      info: (message: string) => messages.push(message),
      warn: (message: string) => messages.push(message),
      error: (message: string) => messages.push(message),
    } as never;

    createProviderLogger(output).error('request failed', new Error('secret-api-key'));
    expect(messages).toEqual(['request failed (Error)']);
    expect(messages.join()).not.toContain('secret-api-key');
  });
});