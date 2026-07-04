// Pricing and context limits per model family.
// Source: https://aws.amazon.com/bedrock/pricing/ (us-east-1, on-demand, per 1M tokens)
// The Bedrock API does not expose these values itself.

export interface ParsedBedrockId {
  model: string;
  region: string | null;
  family: string;
  provider: string;
}

const PROVIDER_MAP: Record<string, string> = {
  anthropic: 'Anthropic', amazon: 'Amazon', meta: 'Meta', mistral: 'Mistral',
  ai21: 'AI21', cohere: 'Cohere', openai: 'OpenAI', nvidia: 'NVIDIA',
  qwen: 'Qwen', writer: 'Writer', twelvelabs: 'TwelveLabs', zai: 'Zai',
  deepseek: 'DeepSeek',
};

export function parseBedrockId(bedrockId: string): ParsedBedrockId {
  // 1. Extract region prefix
  let region: string | null = null;
  let rest = bedrockId;
  const regionMatch = rest.match(/^(us|eu|ap)\./i);
  if (regionMatch) {
    region = regionMatch[1].toUpperCase();
    rest = rest.slice(regionMatch[0].length);
  } else if (/^global\./i.test(rest)) {
    region = 'GLOBAL';
    rest = rest.replace(/^global\./i, '');
  }

  // 2. Extract provider (first dot-segment)
  const dotIdx = rest.indexOf('.');
  let providerKey = '';
  let rawModel = rest;
  if (dotIdx !== -1) {
    providerKey = rest.slice(0, dotIdx).toLowerCase();
    rawModel = rest.slice(dotIdx + 1);
  }
  const provider = PROVIDER_MAP[providerKey] ?? (providerKey ? providerKey.charAt(0).toUpperCase() + providerKey.slice(1) : 'AWS');

  // 3. Strip version suffix and date
  rawModel = rawModel
    .replace(/-v\d+(?::\d+)?$/i, '')
    .replace(/:\d+[a-z]*$/i, '')
    .replace(/-(\d{8,}).*$/i, '');

  // 4. Format for display: convert version dashes to dots, then title case
  const model = rawModel
    .replace(/-(\d+)-(\d+)(?=-|$)/g, '-$1.$2')
    .replace(/(\d)\.(\d)/g, '$1~D~$2')
    .replace(/[-._]+/g, ' ')
    .replace(/~D~/g, '.')
    .trim()
    .replace(/\b\w+/g, w => {
      const l = w.toLowerCase();
      if (l === 'gpt' || l === 'oss' || l === 'glm' || l === 'vl') { return w.toUpperCase(); }
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    });

  // 5. Derive family
  const lower = rawModel.toLowerCase();
  let family = 'unknown';
  if (lower.includes('claude')) { family = 'claude'; }
  else if (lower.includes('nova')) { family = 'nova'; }
  else if (lower.includes('llama')) { family = 'llama'; }
  else if (lower.includes('mistral')) { family = 'mistral'; }
  else if (lower.includes('titan')) { family = 'titan'; }

  return { model, region, family, provider };
}

/** Build display name from parsed result: `<provider> <model> [region]` */
export function formatModelName(parsed: ParsedBedrockId): string {
  return parsed.region
    ? `${parsed.provider} ${parsed.model} [${parsed.region}]`
    : `${parsed.provider} ${parsed.model}`;
}

export interface ModelMetadata {
  maxInputTokens: number;
  maxOutputTokens: number;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  cacheCostPerMillion?: number;
  cacheWriteCostPerMillion?: number;
  supportsThinking: boolean;
  supportsImages: boolean;
}

export interface ModelDef extends ModelMetadata {
  id: string;
  name: string;
}

export const PRICING_TABLE: { pattern: RegExp; meta: ModelMetadata }[] = [
  // ── Claude 5 ──────────────────────────────────────────────────────────────
  { pattern: /claude-fable-5/, meta: { maxInputTokens: 200_000, maxOutputTokens: 32_000, inputCostPerMillion: 2.0, outputCostPerMillion: 50.0, cacheCostPerMillion: 1.00, cacheWriteCostPerMillion: 12.50, supportsThinking: true, supportsImages: true } },
  { pattern: /claude-sonnet-5/, meta: { maxInputTokens: 200_000, maxOutputTokens: 32_000, inputCostPerMillion: 2.0, outputCostPerMillion: 10.0, cacheCostPerMillion: 0.20, cacheWriteCostPerMillion: 4.00, supportsThinking: true, supportsImages: true } },


  // ── Claude 4 ──────────────────────────────────────────────────────────────
  { pattern: /claude-sonnet-4/, meta: { maxInputTokens: 200_000, maxOutputTokens: 64_000, inputCostPerMillion: 3.0, outputCostPerMillion: 15.0, cacheCostPerMillion: 0.30, cacheWriteCostPerMillion: 3.75, supportsThinking: true, supportsImages: true } },
  { pattern: /claude-opus-4/, meta: { maxInputTokens: 200_000, maxOutputTokens: 32_000, inputCostPerMillion: 5.0, outputCostPerMillion: 25.0, cacheCostPerMillion: 0.50, cacheWriteCostPerMillion: 6.25, supportsThinking: true, supportsImages: true } },
  { pattern: /claude-haiku-4/, meta: { maxInputTokens: 200_000, maxOutputTokens: 8_192, inputCostPerMillion: 1.0, outputCostPerMillion: 5.0, cacheCostPerMillion: 0.10, cacheWriteCostPerMillion: 1.25, supportsThinking: false, supportsImages: true } },

  // ── Claude 3.5 ────────────────────────────────────────────────────────────
  { pattern: /claude-3-5-sonnet-20241022/, meta: { maxInputTokens: 200_000, maxOutputTokens: 8_192, inputCostPerMillion: 3.0, outputCostPerMillion: 15.0, cacheCostPerMillion: 0.30, cacheWriteCostPerMillion: 3.75, supportsThinking: false, supportsImages: true } },
  { pattern: /claude-3-5-sonnet/, meta: { maxInputTokens: 200_000, maxOutputTokens: 8_192, inputCostPerMillion: 3.0, outputCostPerMillion: 15.0, cacheCostPerMillion: 0.30, cacheWriteCostPerMillion: 3.75, supportsThinking: false, supportsImages: true } },
  { pattern: /claude-3-5-haiku/, meta: { maxInputTokens: 200_000, maxOutputTokens: 8_192, inputCostPerMillion: 0.8, outputCostPerMillion: 4.0, cacheCostPerMillion: 0.08, cacheWriteCostPerMillion: 1.00, supportsThinking: false, supportsImages: true } },

  // ── Claude 3 ──────────────────────────────────────────────────────────────
  { pattern: /claude-3-opus/, meta: { maxInputTokens: 200_000, maxOutputTokens: 4_096, inputCostPerMillion: 15.0, outputCostPerMillion: 75.0, cacheCostPerMillion: 1.50, cacheWriteCostPerMillion: 18.75, supportsThinking: false, supportsImages: true } },
  { pattern: /claude-3-sonnet/, meta: { maxInputTokens: 200_000, maxOutputTokens: 4_096, inputCostPerMillion: 3.0, outputCostPerMillion: 15.0, cacheCostPerMillion: 0.30, cacheWriteCostPerMillion: 3.75, supportsThinking: false, supportsImages: true } },
  { pattern: /claude-3-haiku/, meta: { maxInputTokens: 200_000, maxOutputTokens: 4_096, inputCostPerMillion: 0.25, outputCostPerMillion: 1.25, cacheCostPerMillion: 0.03, cacheWriteCostPerMillion: 0.30, supportsThinking: false, supportsImages: true } },

  // ── Amazon Nova ───────────────────────────────────────────────────────────
  { pattern: /nova-2-lite|nova-lite-2/, meta: { maxInputTokens: 300_000, maxOutputTokens: 5_120, inputCostPerMillion: 0.30, outputCostPerMillion: 2.50, supportsThinking: false, supportsImages: true } },
  { pattern: /nova-2-pro|nova-pro-2/, meta: { maxInputTokens: 300_000, maxOutputTokens: 5_120, inputCostPerMillion: 1.25, outputCostPerMillion: 1.25, supportsThinking: false, supportsImages: true } },
  { pattern: /nova-pro/, meta: { maxInputTokens: 300_000, maxOutputTokens: 5_120, inputCostPerMillion: 0.80, outputCostPerMillion: 3.20, supportsThinking: false, supportsImages: true } },
  { pattern: /nova-lite/, meta: { maxInputTokens: 300_000, maxOutputTokens: 5_120, inputCostPerMillion: 0.06, outputCostPerMillion: 0.24, supportsThinking: false, supportsImages: true } },
  { pattern: /nova-micro/, meta: { maxInputTokens: 128_000, maxOutputTokens: 5_120, inputCostPerMillion: 0.035, outputCostPerMillion: 0.14, supportsThinking: false, supportsImages: false } },

  // ── Meta Llama 4 ──────────────────────────────────────────────────────────
  { pattern: /llama4.*maverick|llama-4.*maverick/, meta: { maxInputTokens: 1_000_000, maxOutputTokens: 8_192, inputCostPerMillion: 0.24, outputCostPerMillion: 0.97, supportsThinking: false, supportsImages: true } },
  { pattern: /llama4.*scout|llama-4.*scout/, meta: { maxInputTokens: 10_000_000, maxOutputTokens: 8_192, inputCostPerMillion: 0.17, outputCostPerMillion: 0.66, supportsThinking: false, supportsImages: true } },

  // ── Meta Llama 3.x ────────────────────────────────────────────────────────
  { pattern: /llama3-3|llama-3-3|llama3\.3|llama-3\.3/, meta: { maxInputTokens: 128_000, maxOutputTokens: 8_192, inputCostPerMillion: 0.72, outputCostPerMillion: 0.72, supportsThinking: false, supportsImages: false } },
  { pattern: /llama3-2.*90b|llama-3-2.*90b/, meta: { maxInputTokens: 128_000, maxOutputTokens: 8_192, inputCostPerMillion: 0.72, outputCostPerMillion: 0.72, supportsThinking: false, supportsImages: true } },
  { pattern: /llama3-2.*11b|llama-3-2.*11b/, meta: { maxInputTokens: 128_000, maxOutputTokens: 8_192, inputCostPerMillion: 0.16, outputCostPerMillion: 0.16, supportsThinking: false, supportsImages: true } },
  { pattern: /llama3-2.*3b|llama-3-2.*3b/, meta: { maxInputTokens: 128_000, maxOutputTokens: 8_192, inputCostPerMillion: 0.15, outputCostPerMillion: 0.15, supportsThinking: false, supportsImages: false } },
  { pattern: /llama3-2.*1b|llama-3-2.*1b/, meta: { maxInputTokens: 128_000, maxOutputTokens: 8_192, inputCostPerMillion: 0.10, outputCostPerMillion: 0.10, supportsThinking: false, supportsImages: false } },
  { pattern: /llama3-1.*405b|llama-3-1.*405b/, meta: { maxInputTokens: 128_000, maxOutputTokens: 8_192, inputCostPerMillion: 5.32, outputCostPerMillion: 16.0, supportsThinking: false, supportsImages: false } },
  { pattern: /llama3-1.*70b|llama-3-1.*70b/, meta: { maxInputTokens: 128_000, maxOutputTokens: 8_192, inputCostPerMillion: 0.99, outputCostPerMillion: 0.99, supportsThinking: false, supportsImages: false } },
  { pattern: /llama3-1.*8b|llama-3-1.*8b/, meta: { maxInputTokens: 128_000, maxOutputTokens: 8_192, inputCostPerMillion: 0.22, outputCostPerMillion: 0.22, supportsThinking: false, supportsImages: false } },

  // ── Mistral ───────────────────────────────────────────────────────────────
  { pattern: /mistral-large-3|mistral-large-2.*|mistral-large$/, meta: { maxInputTokens: 128_000, maxOutputTokens: 8_192, inputCostPerMillion: 0.50, outputCostPerMillion: 1.50, supportsThinking: false, supportsImages: false } },
  { pattern: /mistral-small|magistral-small/, meta: { maxInputTokens: 32_000, maxOutputTokens: 8_192, inputCostPerMillion: 0.10, outputCostPerMillion: 0.30, supportsThinking: false, supportsImages: false } },
  { pattern: /pixtral-large/, meta: { maxInputTokens: 128_000, maxOutputTokens: 8_192, inputCostPerMillion: 2.00, outputCostPerMillion: 6.00, supportsThinking: false, supportsImages: true } },
  { pattern: /mistral-7b|ministral/, meta: { maxInputTokens: 32_000, maxOutputTokens: 8_192, inputCostPerMillion: 0.15, outputCostPerMillion: 0.20, supportsThinking: false, supportsImages: false } },
  { pattern: /mixtral-8x7b/, meta: { maxInputTokens: 32_000, maxOutputTokens: 8_192, inputCostPerMillion: 0.45, outputCostPerMillion: 0.70, supportsThinking: false, supportsImages: false } },
];

export const DEFAULT_METADATA: ModelMetadata = {
  maxInputTokens: 128_000,
  maxOutputTokens: 4_096,
  inputCostPerMillion: 1.0,
  outputCostPerMillion: 5.0,
  cacheCostPerMillion: 0.10,
  cacheWriteCostPerMillion: 1.25,
  supportsThinking: false,
  supportsImages: false,
};

export function getModelMetadata(bedrockId: string): ModelMetadata {
  const normalized = bedrockId
    .toLowerCase()
    .replace(/^(us|eu|ap)\./i, '')
    .replace(/\.?global\./i, '.')
    .replace(/^global\./i, '')
    .replace(/^[a-z0-9-]+\./, '')
    .replace(/^\./, '');
  return PRICING_TABLE.find(e => e.pattern.test(normalized))?.meta ?? DEFAULT_METADATA;
}

export const FALLBACK_MODELS: ModelDef[] = [
  { id: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0', name: 'Anthropic Claude Sonnet 4.5 [US]', ...getModelMetadata('us.anthropic.claude-sonnet-4-5-20250929-v1:0') },
  { id: 'us.anthropic.claude-sonnet-4-6-20251031-v1:0', name: 'Anthropic Claude Sonnet 4.6 [US]', ...getModelMetadata('us.anthropic.claude-sonnet-4-6-20251031-v1:0') },
];
