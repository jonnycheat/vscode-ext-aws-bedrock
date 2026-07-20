import { describe, expect, it } from 'vitest';
import { DEFAULT_METADATA, MODEL_CATALOG, formatModelName, getModelMetadata, parseBedrockId } from './models';

describe('Bedrock model metadata', () => {
  it('parses regional model identifiers', () => {
    expect(parseBedrockId('us.anthropic.claude-sonnet-4-20250514-v1:0')).toMatchObject({
      region: 'US', provider: 'Anthropic', family: 'claude', model: 'Claude Sonnet 4',
    });
  });

  it('formats global model names', () => {
    expect(formatModelName(parseBedrockId('global.anthropic.claude-sonnet-4')))
      .toBe('Anthropic Claude Sonnet 4 [GLOBAL]');
  });

  it('matches model metadata and falls back safely', () => {
    expect(getModelMetadata('anthropic.claude-3-haiku')).toMatchObject({
      maxInputTokens: 200_000,
      supportsImages: true,
    });
    expect(getModelMetadata('unknown.provider.model')).toEqual(DEFAULT_METADATA);
    expect(MODEL_CATALOG.length).toBeGreaterThan(0);
  });
});