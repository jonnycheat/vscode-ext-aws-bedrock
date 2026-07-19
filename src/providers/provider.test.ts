import { describe, expect, it } from 'vitest';
import { extractMessageText } from '../text';

describe('shared provider helpers', () => {
  it('extracts only text values for approximate token counting', () => {
    expect(extractMessageText('hello')).toBe('hello');
    expect(extractMessageText({
      content: [{ value: 'hello' }, { data: new Uint8Array([1]), mimeType: 'image/png' }],
    })).toBe('hello');
  });
});