import { describe, expect, it } from 'vitest';
import { extractContentPartText, extractMessageText, extractToolResultText } from '../text';

describe('shared provider helpers', () => {
  it('extracts only text values for approximate token counting', () => {
    expect(extractMessageText('hello')).toBe('hello');
    expect(extractMessageText({
      content: [{ value: 'hello' }, { data: new Uint8Array([1]), mimeType: 'image/png' }],
    })).toBe('hello');
  });

  it('shares content-part and tool-result text extraction', () => {
    expect(extractContentPartText({ value: ' hello '})).toBe('hello');
    expect(extractToolResultText({ content: [{ value: 'one' }, { value: 'two' }] })).toBe('onetwo');
    expect(extractToolResultText({ content: [{ data: new Uint8Array([1]) }] })).toBe('');
  });
});