import * as vscode from 'vscode';
import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  type Message,
  type SystemContentBlock,
  type ContentBlock,
  type ConverseStreamCommandInput,
  type Tool,
  type ImageBlock,
  type ImageSource,
  ImageFormat,
} from '@aws-sdk/client-bedrock-runtime';
import {
  BedrockClient,
  ListFoundationModelsCommand,
  ListInferenceProfilesCommand,
} from '@aws-sdk/client-bedrock';

const VENDOR = 'bedrock';
const SECRET_KEY = 'awsBedrock.apiKey';
const COST_STATE_KEY = 'awsBedrock.totalCostUSD';
const MODEL_CACHE_TTL = 30 * 60 * 1000;

// Pricing and context limits per model family.
// Source: https://aws.amazon.com/bedrock/pricing/ (us-east-1, on-demand, per 1M tokens)
// The Bedrock API does not expose these values itself.
interface ModelMetadata {
  maxInputTokens: number;
  maxOutputTokens: number;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  cacheCostPerMillion?: number;
  cacheWriteCostPerMillion?: number;
  supportsThinking: boolean;
  supportsImages: boolean;
}

interface ModelDef extends ModelMetadata {
  id: string;
  name: string;
  bedrockId: string;
}

const PRICING_TABLE: { pattern: RegExp; meta: ModelMetadata }[] = [
  { pattern: /claude-sonnet-4/, meta: { maxInputTokens: 200_000, maxOutputTokens: 64_000, inputCostPerMillion: 3.0,  outputCostPerMillion: 15.0,  cacheCostPerMillion: 0.30, cacheWriteCostPerMillion: 3.75,  supportsThinking: true,  supportsImages: true  } },
  { pattern: /claude-opus-4/, meta: { maxInputTokens: 200_000, maxOutputTokens: 32_000, inputCostPerMillion: 5.0,  outputCostPerMillion: 25.0,  cacheCostPerMillion: 0.50, cacheWriteCostPerMillion: 6.25,  supportsThinking: true,  supportsImages: true  } },
  { pattern: /claude-haiku-4/, meta: { maxInputTokens: 200_000, maxOutputTokens: 8_192,  inputCostPerMillion: 1.0,  outputCostPerMillion: 5.0,   cacheCostPerMillion: 0.10, cacheWriteCostPerMillion: 1.25,  supportsThinking: false, supportsImages: true  } },
  { pattern: /claude-fable-5/, meta: { maxInputTokens: 200_000, maxOutputTokens: 32_000, inputCostPerMillion: 10.0, outputCostPerMillion: 50.0,  cacheCostPerMillion: 1.0,  cacheWriteCostPerMillion: 12.50, supportsThinking: true,  supportsImages: true  } },
  { pattern: /claude-3-5-sonnet-20241022/, meta: { maxInputTokens: 200_000, maxOutputTokens: 8_192, inputCostPerMillion: 3.0, outputCostPerMillion: 15.0, cacheCostPerMillion: 0.30, cacheWriteCostPerMillion: 3.75, supportsThinking: false, supportsImages: true } },
  { pattern: /claude-3-5-sonnet/, meta: { maxInputTokens: 200_000, maxOutputTokens: 8_192,  inputCostPerMillion: 3.0,  outputCostPerMillion: 15.0,  cacheCostPerMillion: 0.30, cacheWriteCostPerMillion: 3.75,  supportsThinking: false, supportsImages: true  } },
  { pattern: /claude-3-5-haiku/, meta: { maxInputTokens: 200_000, maxOutputTokens: 8_192,  inputCostPerMillion: 0.8,  outputCostPerMillion: 4.0,   cacheCostPerMillion: 0.08, cacheWriteCostPerMillion: 1.0,   supportsThinking: false, supportsImages: true  } },
  { pattern: /claude-3-opus/, meta: { maxInputTokens: 200_000, maxOutputTokens: 4_096,  inputCostPerMillion: 15.0, outputCostPerMillion: 75.0,  cacheCostPerMillion: 1.50, cacheWriteCostPerMillion: 18.75, supportsThinking: false, supportsImages: true  } },
  { pattern: /claude-3-sonnet/, meta: { maxInputTokens: 200_000, maxOutputTokens: 4_096,  inputCostPerMillion: 3.0,  outputCostPerMillion: 15.0,  cacheCostPerMillion: 0.30, cacheWriteCostPerMillion: 3.75,  supportsThinking: false, supportsImages: true  } },
  { pattern: /claude-3-haiku/, meta: { maxInputTokens: 200_000, maxOutputTokens: 4_096,  inputCostPerMillion: 0.25, outputCostPerMillion: 1.25,  cacheCostPerMillion: 0.03, cacheWriteCostPerMillion: 0.30,  supportsThinking: false, supportsImages: true  } },
  { pattern: /nova-2-lite|nova-lite-2/,meta: { maxInputTokens: 300_000, maxOutputTokens: 5_120,  inputCostPerMillion: 0.30, outputCostPerMillion: 2.50,  supportsThinking: false, supportsImages: true  } },
  { pattern: /nova-2-pro|nova-pro-2/,  meta: { maxInputTokens: 300_000, maxOutputTokens: 5_120,  inputCostPerMillion: 1.25, outputCostPerMillion: 1.25,  supportsThinking: false, supportsImages: true  } },
  { pattern: /nova-pro/, meta: { maxInputTokens: 300_000, maxOutputTokens: 5_120,  inputCostPerMillion: 0.80, outputCostPerMillion: 3.20,  supportsThinking: false, supportsImages: true  } },
  { pattern: /nova-lite/, meta: { maxInputTokens: 300_000, maxOutputTokens: 5_120,  inputCostPerMillion: 0.06, outputCostPerMillion: 0.24,  supportsThinking: false, supportsImages: true  } },
  { pattern: /nova-micro/, meta: { maxInputTokens: 128_000, maxOutputTokens: 5_120,  inputCostPerMillion: 0.035,outputCostPerMillion: 0.14,  supportsThinking: false, supportsImages: false } },
  { pattern: /llama4.*maverick|llama-4.*maverick/, meta: { maxInputTokens: 1_000_000,  maxOutputTokens: 8_192, inputCostPerMillion: 0.24, outputCostPerMillion: 0.97, supportsThinking: false, supportsImages: true  } },
  { pattern: /llama4.*scout|llama-4.*scout/, meta: { maxInputTokens: 10_000_000, maxOutputTokens: 8_192, inputCostPerMillion: 0.17, outputCostPerMillion: 0.66, supportsThinking: false, supportsImages: true  } },
  { pattern: /llama3-3|llama-3-3|llama3\.3|llama-3\.3/, meta: { maxInputTokens: 128_000, maxOutputTokens: 8_192, inputCostPerMillion: 0.72, outputCostPerMillion: 0.72, supportsThinking: false, supportsImages: false } },
  { pattern: /llama3-2.*90b|llama-3-2.*90b/, meta: { maxInputTokens: 128_000, maxOutputTokens: 8_192, inputCostPerMillion: 0.72, outputCostPerMillion: 0.72, supportsThinking: false, supportsImages: true  } },
  { pattern: /llama3-2.*11b|llama-3-2.*11b/, meta: { maxInputTokens: 128_000, maxOutputTokens: 8_192, inputCostPerMillion: 0.16, outputCostPerMillion: 0.16, supportsThinking: false, supportsImages: true  } },
  { pattern: /llama3-2.*3b|llama-3-2.*3b/, meta: { maxInputTokens: 128_000, maxOutputTokens: 8_192, inputCostPerMillion: 0.15, outputCostPerMillion: 0.15, supportsThinking: false, supportsImages: false } },
  { pattern: /llama3-2.*1b|llama-3-2.*1b/, meta: { maxInputTokens: 128_000, maxOutputTokens: 8_192, inputCostPerMillion: 0.10, outputCostPerMillion: 0.10, supportsThinking: false, supportsImages: false } },
  { pattern: /llama3-1.*405b|llama-3-1.*405b/, meta: { maxInputTokens: 128_000, maxOutputTokens: 8_192, inputCostPerMillion: 5.32, outputCostPerMillion: 16.0, supportsThinking: false, supportsImages: false } },
  { pattern: /llama3-1.*70b|llama-3-1.*70b/, meta: { maxInputTokens: 128_000, maxOutputTokens: 8_192, inputCostPerMillion: 0.99, outputCostPerMillion: 0.99, supportsThinking: false, supportsImages: false } },
  { pattern: /llama3-1.*8b|llama-3-1.*8b/, meta: { maxInputTokens: 128_000, maxOutputTokens: 8_192, inputCostPerMillion: 0.22, outputCostPerMillion: 0.22, supportsThinking: false, supportsImages: false } },
  { pattern: /mistral-large-3|mistral-large-2.*|mistral-large$/, meta: { maxInputTokens: 128_000, maxOutputTokens: 8_192, inputCostPerMillion: 0.50, outputCostPerMillion: 1.50, supportsThinking: false, supportsImages: false } },
  { pattern: /mistral-small|magistral-small/, meta: { maxInputTokens: 32_000, maxOutputTokens: 8_192, inputCostPerMillion: 0.10, outputCostPerMillion: 0.30, supportsThinking: false, supportsImages: false } },
  { pattern: /pixtral-large/, meta: { maxInputTokens: 128_000, maxOutputTokens: 8_192,  inputCostPerMillion: 2.0,  outputCostPerMillion: 6.0,   supportsThinking: false, supportsImages: true  } },
  { pattern: /mistral-7b|ministral/, meta: { maxInputTokens: 32_000,  maxOutputTokens: 8_192,  inputCostPerMillion: 0.15, outputCostPerMillion: 0.20,  supportsThinking: false, supportsImages: false } },
  { pattern: /mixtral-8x7b/, meta: { maxInputTokens: 32_000,  maxOutputTokens: 8_192,  inputCostPerMillion: 0.45, outputCostPerMillion: 0.70,  supportsThinking: false, supportsImages: false } },
];

const DEFAULT_METADATA: ModelMetadata = {
  maxInputTokens: 128_000, maxOutputTokens: 4_096,
  inputCostPerMillion: 1.0, outputCostPerMillion: 5.0,
  cacheCostPerMillion: 0.10, cacheWriteCostPerMillion: 1.25,
  supportsThinking: false, supportsImages: false,
};

function getModelMetadata(bedrockId: string): ModelMetadata {
  return PRICING_TABLE.find(e => e.pattern.test(bedrockId.toLowerCase()))?.meta ?? DEFAULT_METADATA;
}

const FALLBACK_MODELS: ModelDef[] = [
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5 (Bedrock)', bedrockId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0', ...getModelMetadata('claude-sonnet-4-5') },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Bedrock)', bedrockId: 'us.anthropic.claude-sonnet-4-6-20251031-v1:0', ...getModelMetadata('claude-sonnet-4-6') },
];

let cachedModels: ModelDef[] = FALLBACK_MODELS;
let modelCacheTime = 0;

function getRegion(): string {
  return vscode.workspace.getConfiguration('awsBedrock').get<string>('region') ?? 'us-east-1';
}

function injectBearerToken(stack: any, apiKey: string): void {
  stack.add(
    (next: any) => async (args: any) => {
      const req = (args as { request: { headers: Record<string, string> } }).request;
      if (req?.headers) {
        delete req.headers['authorization'];
        delete req.headers['Authorization'];
        delete req.headers['x-amz-date'];
        delete req.headers['x-amz-security-token'];
        delete req.headers['x-amz-content-sha256'];
        req.headers['authorization'] = `Bearer ${apiKey}`;
      }
      return next(args);
    },
    { step: 'finalizeRequest', name: 'bearerAuth', priority: 'low' }
  );
}

function cleanModelId(bedrockId: string): string {
  return bedrockId.replace(/^(us|eu|ap)\./, '').replace(/(-v\d+:\d+|-v\d+)$/, '');
}

async function fetchModels(apiKey: string): Promise<ModelDef[]> {
  const client = new BedrockClient({
    region: 'us-east-1',
    credentials: { accessKeyId: 'unused', secretAccessKey: 'unused' },
  });
  injectBearerToken(client.middlewareStack, apiKey);

  const models: ModelDef[] = [];
  const seen = new Set<string>();

  try {
    const resp = await client.send(new ListInferenceProfilesCommand({ typeEquals: 'SYSTEM_DEFINED' }));
    for (const p of resp.inferenceProfileSummaries ?? []) {
      const { inferenceProfileId: bedrockId, inferenceProfileName: rawName } = p;
      if (!bedrockId || !rawName) { continue; }
      const lower = bedrockId.toLowerCase();
      if (!lower.includes('claude') && !lower.includes('nova') && !lower.includes('llama') && !lower.includes('mistral')) { continue; }
      const id = cleanModelId(bedrockId);
      if (seen.has(id)) { continue; }
      seen.add(id);
      models.push({ id, name: rawName, bedrockId, ...getModelMetadata(bedrockId) });
    }
  } catch { /* fall through to foundation models */ }

  try {
    const resp = await client.send(new ListFoundationModelsCommand({ byOutputModality: 'TEXT' }));
    for (const fm of resp.modelSummaries ?? []) {
      const { modelId: bedrockId, modelName: rawName } = fm;
      if (!bedrockId || !rawName || !fm.responseStreamingSupported) { continue; }
      const id = cleanModelId(bedrockId);
      if (seen.has(id)) { continue; }
      seen.add(id);
      models.push({ id, name: `${rawName} (${fm.providerName ?? 'AWS'})`, bedrockId, ...getModelMetadata(bedrockId) });
    }
  } catch { /* ignore */ }

  return models.length > 0 ? models : FALLBACK_MODELS;
}

async function getModels(secrets: vscode.SecretStorage): Promise<ModelDef[]> {
  if (cachedModels.length > 0 && Date.now() - modelCacheTime < MODEL_CACHE_TTL) {
    return cachedModels;
  }
  const apiKey = await secrets.get(SECRET_KEY);
  if (!apiKey) { return FALLBACK_MODELS; }
  try {
    cachedModels = await fetchModels(apiKey);
    modelCacheTime = Date.now();
  } catch { /* keep existing cache */ }
  return cachedModels;
}

class CostTracker {
  private totalCost: number;
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private state: vscode.Memento) {
    this.totalCost = state.get<number>(COST_STATE_KEY) ?? 0;
  }

  get total(): number { return this.totalCost; }

  add(inputTokens: number, outputTokens: number, meta: ModelMetadata): void {
    this.totalCost +=
      (inputTokens / 1_000_000) * meta.inputCostPerMillion +
      (outputTokens / 1_000_000) * meta.outputCostPerMillion;
    this.state.update(COST_STATE_KEY, this.totalCost);
    this._onDidChange.fire();
  }

  reset(): void {
    this.totalCost = 0;
    this.state.update(COST_STATE_KEY, 0);
    this._onDidChange.fire();
  }

  formatTotal(): string {
    return `$${this.totalCost.toFixed(2)}`;
  }
}

function deriveFamily(bedrockId: string): string {
  const lower = bedrockId.toLowerCase();
  if (lower.includes('claude'))  { return 'claude'; }
  if (lower.includes('nova'))    { return 'nova'; }
  if (lower.includes('llama'))   { return 'llama'; }
  if (lower.includes('mistral')) { return 'mistral'; }
  if (lower.includes('titan'))   { return 'titan'; }
  return 'unknown';
}

function mimeToBedrockFormat(mime: string): typeof ImageFormat[keyof typeof ImageFormat] | null {
  switch (mime.toLowerCase()) {
    case 'image/jpeg': case 'image/jpg': return ImageFormat.JPEG;
    case 'image/png':  return ImageFormat.PNG;
    case 'image/gif':  return ImageFormat.GIF;
    case 'image/webp': return ImageFormat.WEBP;
    default:           return null;
  }
}

function extractText(msg: vscode.LanguageModelChatRequestMessage): string {
  if (!Array.isArray(msg.content)) { return ''; }
  return msg.content
    .map((p: unknown) => {
      const cp = p as Record<string, unknown>;
      return typeof cp?.['value'] === 'string' ? cp['value'] as string : '';
    })
    .join('');
}

function convertMessageContent(
  msg: vscode.LanguageModelChatRequestMessage
): { role: 'user' | 'assistant'; content: ContentBlock[] } | { system: true; text: string } | null {
  const role =
    msg.role === vscode.LanguageModelChatMessageRole.User      ? 'user' :
    msg.role === vscode.LanguageModelChatMessageRole.Assistant ? 'assistant' : 'system';

  const content: ContentBlock[] = [];

  if (!Array.isArray(msg.content)) {
    const text = typeof (msg.content as unknown) === 'string' ? (msg.content as unknown as string).trim() : '';
    if (!text) { return null; }
    if (role === 'system') { return { system: true, text }; }
    return { role, content: [{ text }] };
  }

  for (const part of msg.content) {
    // Duck-typing: parts come from VS Code core with a different prototype chain.
    const p = part as Record<string, unknown>;

    if (typeof p?.['value'] === 'string' && !('callId' in p)) {
      const text = (p['value'] as string).trim();
      if (text) { content.push({ text }); }

    } else if (p && 'data' in p && 'mimeType' in p) {
      const mimeType = p['mimeType'] as string;
      if (mimeType.startsWith('image/')) {
        const fmt = mimeToBedrockFormat(mimeType);
        if (fmt) {
          const imageSource: ImageSource = { bytes: p['data'] as Uint8Array };
          const imageBlock: ImageBlock = { format: fmt, source: imageSource };
          content.push({ image: imageBlock });
        }
      }

    } else if (p && 'callId' in p && 'name' in p && 'input' in p) {
      content.push({
        toolUse: {
          toolUseId: p['callId'] as string,
          name: p['name'] as string,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          input: p['input'] as any,
        },
      });

    } else if (p && 'callId' in p && 'content' in p && Array.isArray(p['content'])) {
      const resultText = (p['content'] as unknown[])
        .map((c: unknown) => {
          const cp = c as Record<string, unknown>;
          return typeof cp?.['value'] === 'string' ? cp['value'] as string : '';
        })
        .join('');
      content.push({ toolResult: { toolUseId: p['callId'] as string, content: [{ text: resultText }] } });
    }
  }

  if (content.length === 0) { return null; }
  if (role === 'system') {
    const texts = content.filter((c): c is { text: string } => 'text' in c).map(c => c.text).join('\n');
    return texts ? { system: true, text: texts } : null;
  }
  return { role: role as 'user' | 'assistant', content };
}

function convertMessages(
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  options: vscode.ProvideLanguageModelChatResponseOptions
) {
  const system: SystemContentBlock[] = [];
  const turns: Array<{ role: 'user' | 'assistant'; content: ContentBlock[] }> = [];

  for (const msg of messages) {
    const result = convertMessageContent(msg);
    if (!result) { continue; }
    if ('system' in result) {
      system.push({ text: result.text });
    } else {
      turns.push(result);
    }
  }

  const merged: Array<{ role: 'user' | 'assistant'; content: ContentBlock[] }> = [];
  for (const t of turns) {
    const last = merged[merged.length - 1];
    if (last && last.role === t.role) {
      last.content.push(...t.content);
    } else {
      merged.push({ role: t.role, content: [...t.content] });
    }
  }

  if (merged.length > 0 && merged[0].role === 'assistant') {
    merged.unshift({ role: 'user', content: [{ text: '(continued)' }] });
  }

  const bedrockMessages: Message[] = merged.map(m => ({ role: m.role, content: m.content }));

  const tools: Tool[] = (options.tools ?? []).map(tool => ({
    toolSpec: {
      name: tool.name,
      description: tool.description,
      inputSchema: {
        json: (tool.inputSchema as any) ?? { type: 'object', properties: {} },
      },
    },
  } satisfies Tool));

  return { bedrockMessages, system, tools };
}

class BedrockProvider implements vscode.LanguageModelChatProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation = this._onDidChange.event;

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly costTracker: CostTracker,
  ) {}

  async refresh(): Promise<void> {
    modelCacheTime = 0;
    await getModels(this.secrets);
    this._onDidChange.fire();
  }

  async provideLanguageModelChatInformation(
    _options: { silent: boolean },
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    const models = await getModels(this.secrets);
    return models.map(m => {
      const ctxK = Math.round(m.maxInputTokens / 1000);
      const inCost = m.inputCostPerMillion;
      const outCost = m.outputCostPerMillion;

      const tooltipParts = [
        `Context: ${ctxK}k tokens`,
        `Input: $${inCost} / Output: $${outCost} per 1M tokens`,
        m.cacheCostPerMillion && m.cacheWriteCostPerMillion
          ? `Cache: $${m.cacheCostPerMillion} read / $${m.cacheWriteCostPerMillion} write per 1M tokens`
          : '',
        m.supportsImages   ? 'Supports image input'      : 'Text only',
        m.supportsThinking ? 'Supports extended thinking' : '',
      ].filter(Boolean);

      const info: vscode.LanguageModelChatInformation & Record<string, unknown> = {
        id: m.id,
        name: m.name,
        family: deriveFamily(m.bedrockId),
        version: '1.0.0',
        maxInputTokens: m.maxInputTokens,
        maxOutputTokens: m.maxOutputTokens,
        detail: `${ctxK}k ctx · $${inCost}/$${outCost}`,
        tooltip: tooltipParts.join('\n'),
        capabilities: { toolCalling: true, imageInput: m.supportsImages } as vscode.LanguageModelChatCapabilities,
        pricing: `In: $${inCost} · Out: $${outCost} per 1M tokens`,
        inputCost: inCost,
        outputCost: outCost,
        cacheCost: m.cacheCostPerMillion,
        cacheWriteCost: m.cacheWriteCostPerMillion,
        isBYOK: true,
      };
      return info;
    });
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const apiKey = await this.secrets.get(SECRET_KEY);
    if (!apiKey) {
      throw new Error('No AWS Bedrock API key configured. Run "AWS Bedrock: Configure API Key & Region" from the Command Palette.');
    }

    const allModels = await getModels(this.secrets);
    const entry = allModels.find(m => m.id === model.id) ?? allModels[0];
    const { bedrockMessages, system, tools } = convertMessages(messages, options);

    if (bedrockMessages.length === 0) { return; }

    const systemWithCaching = system.length > 0
      ? system.map((block, idx) => idx === system.length - 1 ? { ...block, cacheControl: { type: 'ephemeral' as const } } : block)
      : undefined;

    const additionalModelFields: Record<string, unknown> = {};
    const thinkingEffort = options.modelOptions?.['thinkingEffort'] as string | undefined;
    if (thinkingEffort && entry.supportsThinking) {
      additionalModelFields['performanceConfig'] = { latency: thinkingEffort === 'high' ? 'standard' : 'optimized' };
    }

    let toolConfig: ConverseStreamCommandInput['toolConfig'] = undefined;
    if (tools.length > 0) {
      toolConfig = options.toolMode === vscode.LanguageModelChatToolMode.Required
        ? { tools, toolChoice: { any: {} } }
        : { tools, toolChoice: { auto: {} } };
    }

    const input: ConverseStreamCommandInput = {
      modelId: entry.bedrockId,
      messages: bedrockMessages,
      system: systemWithCaching,
      inferenceConfig: { maxTokens: entry.maxOutputTokens },
      toolConfig,
      additionalModelRequestFields: Object.keys(additionalModelFields).length > 0 ? additionalModelFields as any : undefined,
    };

    const client = new BedrockRuntimeClient({
      region: getRegion(),
      credentials: { accessKeyId: 'unused', secretAccessKey: 'unused' },
    });
    injectBearerToken(client.middlewareStack, apiKey);

    const response = await client.send(new ConverseStreamCommand(input));
    if (!response.stream) { return; }

    interface PendingTool { callId: string; name: string; inputJson: string; }
    const pendingTools = new Map<number, PendingTool>();

    for await (const event of response.stream) {
      if (token.isCancellationRequested) { break; }

      if (event.contentBlockDelta?.delta?.text) {
        progress.report(new vscode.LanguageModelTextPart(event.contentBlockDelta.delta.text));
      }

      if (event.contentBlockStart?.start?.toolUse) {
        const { toolUseId, name } = event.contentBlockStart.start.toolUse;
        const idx = event.contentBlockStart.contentBlockIndex ?? 0;
        if (toolUseId && name) {
          pendingTools.set(idx, { callId: toolUseId, name, inputJson: '' });
        }
      }

      if (event.contentBlockDelta?.delta?.toolUse?.input) {
        const idx = event.contentBlockDelta.contentBlockIndex ?? 0;
        const pending = pendingTools.get(idx);
        if (pending) { pending.inputJson += event.contentBlockDelta.delta.toolUse.input; }
      }

      if (event.contentBlockStop !== undefined) {
        const idx = event.contentBlockStop.contentBlockIndex ?? 0;
        const pending = pendingTools.get(idx);
        if (pending) {
          let parsedInput: object = {};
          try { parsedInput = pending.inputJson ? JSON.parse(pending.inputJson) : {}; }
          catch { parsedInput = { _raw: pending.inputJson }; }
          progress.report(new vscode.LanguageModelToolCallPart(pending.callId, pending.name, parsedInput));
          pendingTools.delete(idx);
        }
      }

      if (event.metadata?.usage) {
        const inputTokens  = event.metadata.usage.inputTokens  ?? 0;
        const outputTokens = event.metadata.usage.outputTokens ?? 0;

        this.costTracker.add(inputTokens, outputTokens, entry);

        progress.report(
          new vscode.LanguageModelDataPart(
            new TextEncoder().encode(JSON.stringify({
              prompt_tokens:     inputTokens,
              completion_tokens: outputTokens,
              total_tokens:      inputTokens + outputTokens,
            })),
            'usage'
          )
        );
      }
    }
  }

  async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken
  ): Promise<number> {
    const str = typeof text === 'string' ? text : extractText(text);
    return Math.ceil(str.length / 4);
  }
}

function buildTooltip(costTracker: CostTracker): vscode.MarkdownString {
  const region = getRegion();
  const md = new vscode.MarkdownString('', true);
  md.supportHtml = true;

  md.appendMarkdown(`$(cloud) **AWS Bedrock**\n\n`);
  md.appendMarkdown(`---\n\n`);
  md.appendMarkdown(`<span style="color:var(--vscode-descriptionForeground);">Estimated total spend</span>\n\n`);
  md.appendMarkdown(`**<span style="color:var(--vscode-charts-green);">${costTracker.formatTotal()}</span>**\n\n`);
  md.appendMarkdown(`---\n\n`);
  md.appendMarkdown(`$(globe) <span style="color:var(--vscode-descriptionForeground);">Region</span> — **${region}**\n\n`);
  md.appendMarkdown(`---\n\n`);
  md.appendMarkdown(
    `[$(key) Update API Key](command:awsBedrock.updateApiKey) \u2002 ` +
    `[$(globe) Change Region](command:awsBedrock.changeRegion) \u2002 ` +
    `[$(trash) Reset](command:awsBedrock.resetCost)`
  );

  md.isTrusted = { enabledCommands: ['awsBedrock.resetCost', 'awsBedrock.updateApiKey', 'awsBedrock.changeRegion'] };
  return md;
}

export function activate(context: vscode.ExtensionContext): void {
  const costTracker = new CostTracker(context.globalState);

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.name = 'AWS Bedrock Cost';
  const updateStatusBar = () => {
    statusBar.text = `$(cloud) ${costTracker.formatTotal()}`;
    statusBar.tooltip = buildTooltip(costTracker);
  };
  updateStatusBar();
  statusBar.show();
  context.subscriptions.push(statusBar, costTracker.onDidChange(updateStatusBar));

  const provider = new BedrockProvider(context.secrets, costTracker);
  context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider(VENDOR, provider));

  context.subscriptions.push(
    vscode.commands.registerCommand('awsBedrock.configure', async () => {
      await runSetup(context.secrets);
      await provider.refresh();
    }),
    vscode.commands.registerCommand('awsBedrock.updateApiKey', async () => {
      if (await runUpdateApiKey(context.secrets)) { await provider.refresh(); }
    }),
    vscode.commands.registerCommand('awsBedrock.changeRegion', async () => {
      if (await runSelectRegion()) { await provider.refresh(); }
    }),
    vscode.commands.registerCommand('awsBedrock.refreshModels', async () => {
      await provider.refresh();
      vscode.window.showInformationMessage('AWS Bedrock: Model list refreshed.');
    }),
    vscode.commands.registerCommand('awsBedrock.resetCost', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Reset AWS Bedrock cost tracker? This cannot be undone.',
        { modal: true }, 'Reset'
      );
      if (confirm === 'Reset') { costTracker.reset(); }
    }),
  );

  context.secrets.get(SECRET_KEY).then(key => {
    if (!key) {
      vscode.window.showInformationMessage(
        'AWS Bedrock: No API key configured. Set up now?', 'Configure', 'Later'
      ).then(answer => {
        if (answer === 'Configure') { runSetup(context.secrets).then(() => provider.refresh()); }
      });
    } else {
      provider.refresh().catch(() => { /* ignore */ });
    }
  });
}

async function runSetup(secrets: vscode.SecretStorage): Promise<void> {
  if (!await runSelectRegion()) { return; }
  await runUpdateApiKey(secrets);
}

async function runSelectRegion(): Promise<boolean> {
  const regions = ['us-east-1', 'us-west-2', 'eu-central-1', 'eu-west-1', 'ap-northeast-1', 'ap-southeast-2'];
  const current = getRegion();
  const picked = await vscode.window.showQuickPick(
    regions.map(r => ({ label: r, picked: r === current })),
    { title: 'AWS Bedrock: Select Region', placeHolder: current }
  );
  if (!picked) { return false; }
  await vscode.workspace.getConfiguration('awsBedrock').update('region', picked.label, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`AWS Bedrock region updated: ${picked.label}`);
  return true;
}

async function runUpdateApiKey(secrets: vscode.SecretStorage): Promise<boolean> {
  const apiKey = await vscode.window.showInputBox({
    title: 'AWS Bedrock: Update API Key',
    prompt: 'Enter your Bedrock long-term API key',
    password: true,
    ignoreFocusOut: true,
    validateInput: v => v.trim() ? undefined : 'API key is required',
  });
  if (!apiKey) { return false; }
  await secrets.store(SECRET_KEY, apiKey.trim());
  vscode.window.showInformationMessage('AWS Bedrock API key updated.');
  return true;
}

export function deactivate(): void {}
