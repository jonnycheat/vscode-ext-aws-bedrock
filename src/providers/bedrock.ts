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
import type { DocumentType } from '@smithy/types';
import {
  BedrockClient,
  ListFoundationModelsCommand,
  ListInferenceProfilesCommand,
  ModelModality,
} from '@aws-sdk/client-bedrock';
import {
  type ModelDef,
  parseBedrockId,
  formatModelName,
  getModelMetadata,
} from '../models';
import { createModelInformation, extractMessageText, reportUsage, THINKING_EFFORT_SCHEMA } from './provider';
import type { IProvider, UsageEvent } from './provider';
import { getBedrockRegion, SECRET_KEYS } from '../config';
import { createAbortController } from '../cancellation';
import type { ProviderLogger } from '../diagnostics';

const MODEL_CACHE_TTL = 30 * 60 * 1000;

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
      const { inferenceProfileId: id } = p;
      if (!id) { continue; }
      const parsed = parseBedrockId(id);
      if (!['claude', 'nova', 'llama', 'mistral'].includes(parsed.family)) { continue; }
      if (seen.has(id)) { continue; }
      seen.add(id);
      models.push({ modelId: id, name: formatModelName(parsed), provider: 'aws', ...getModelMetadata(id) });
    }
  } catch { /* fall through to foundation models */ }

  try {
    const resp = await client.send(new ListFoundationModelsCommand({ byOutputModality: 'TEXT' }));
    for (const fm of resp.modelSummaries ?? []) {
      const { modelId: id } = fm;
      if (!id || !fm.responseStreamingSupported) { continue; }
      if (fm.modelLifecycle?.status === 'LEGACY') { continue; }
      if (seen.has(id)) { continue; }
      seen.add(id);
      const parsed = parseBedrockId(id);
      const meta = getModelMetadata(id);
      if (fm.inputModalities) {
        meta.supportsImages = fm.inputModalities.includes(ModelModality.IMAGE);
      }
      models.push({ modelId: id, name: formatModelName(parsed), provider: 'aws', ...meta });
    }
  } catch { /* ignore */ }

  return models;
}

function mimeToBedrockFormat(mime: string): typeof ImageFormat[keyof typeof ImageFormat] | null {
  switch (mime.toLowerCase()) {
    case 'image/jpeg': case 'image/jpg': return ImageFormat.JPEG;
    case 'image/png': return ImageFormat.PNG;
    case 'image/gif': return ImageFormat.GIF;
    case 'image/webp': return ImageFormat.WEBP;
    default: return null;
  }
}

function asJsonObject(value: unknown): DocumentType {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as DocumentType
    : {};
}

function convertMessageContent(
  msg: vscode.LanguageModelChatRequestMessage
): { role: 'user' | 'assistant'; content: ContentBlock[] } | { system: true; text: string } | null {
  const role =
    msg.role === vscode.LanguageModelChatMessageRole.User ? 'user' :
      msg.role === vscode.LanguageModelChatMessageRole.Assistant ? 'assistant' : 'system';

  const content: ContentBlock[] = [];

  if (!Array.isArray(msg.content)) {
    const text = typeof (msg.content as unknown) === 'string' ? (msg.content as unknown as string).trim() : '';
    if (!text) { return null; }
    if (role === 'system') { return { system: true, text }; }
    return { role, content: [{ text }] };
  }

  for (const part of msg.content) {
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
          input: asJsonObject(p['input']),
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
        json: (tool.inputSchema as DocumentType | undefined) ?? { type: 'object', properties: {} },
      },
    },
  } as Tool));

  return { bedrockMessages, system, tools };
}

export class BedrockProvider implements IProvider {
  readonly label = 'AWS Bedrock';
  readonly vendor = 'bedrock';

  private cachedModels: ModelDef[] = [];
  private modelCacheTime = 0;
  private refreshPromise: Promise<void> | undefined;

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation = this._onDidChange.event;

  private readonly _onUsage = new vscode.EventEmitter<UsageEvent>();
  readonly onUsage = this._onUsage.event;

  constructor(private readonly secrets: vscode.SecretStorage, private readonly logger?: ProviderLogger) { }

  async refresh(): Promise<void> {
    if (this.refreshPromise) { return this.refreshPromise; }
    this.refreshPromise = this.refreshModels();
    try { await this.refreshPromise; } finally { this.refreshPromise = undefined; }
  }

  private async refreshModels(): Promise<void> {
    this.modelCacheTime = 0;
    this.logger?.info('AWS Bedrock: refreshing model catalog');
    await this.getModels();
    this._onDidChange.fire();
  }

  dispose(): void {
    this._onDidChange.dispose();
    this._onUsage.dispose();
  }

  private async getModels(): Promise<ModelDef[]> {
    if (this.cachedModels.length > 0 && Date.now() - this.modelCacheTime < MODEL_CACHE_TTL) {
      return this.cachedModels;
    }
    const apiKey = await this.secrets.get(SECRET_KEYS.bedrockApiKey);
    if (!apiKey) { return []; }
    try {
      this.cachedModels = await fetchModels(apiKey);
      this.modelCacheTime = Date.now();
    } catch (error) {
      this.logger?.warn(`AWS Bedrock: model discovery failed (${error instanceof Error ? error.name : 'unknown error'})`);
      this.cachedModels = [];
    }
    return this.cachedModels;
  }

  async provideLanguageModelChatInformation(
    _options: { silent: boolean },
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    const models = await this.getModels();
    return models.map(m => {
      return createModelInformation(m, {
        family: parseBedrockId(m.modelId).family,
        configurationSchema: m.supportsThinking ? THINKING_EFFORT_SCHEMA : undefined,
      });
    });
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const apiKey = await this.secrets.get(SECRET_KEYS.bedrockApiKey);
    if (!apiKey) {
      throw new Error('No AWS Bedrock API key configured. Run "AWS Bedrock: Configure API Key & Region" from the Command Palette.');
    }

    const allModels = await this.getModels();
    const entry = allModels.find(m => m.modelId === model.id);
    if (!entry) { throw new Error(`AWS Bedrock: model "${model.id}" is no longer available. Refresh the model list.`); }
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
      modelId: entry.modelId,
      messages: bedrockMessages,
      system: systemWithCaching,
      inferenceConfig: { maxTokens: entry.maxOutputTokens },
      toolConfig,
      additionalModelRequestFields: Object.keys(additionalModelFields).length > 0
        ? additionalModelFields as DocumentType
        : undefined,
    };

    const client = new BedrockRuntimeClient({
      region: getBedrockRegion(),
      credentials: { accessKeyId: 'unused', secretAccessKey: 'unused' },
    });
    injectBearerToken(client.middlewareStack, apiKey);

    const abortController = createAbortController(token);
    this.logger?.info(`AWS Bedrock: starting request for ${entry.modelId}`);
    const response = await client.send(new ConverseStreamCommand(input), { abortSignal: abortController.signal });
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
        reportUsage(
          progress,
          event => this._onUsage.fire(event),
          entry,
          event.metadata.usage.inputTokens ?? 0,
          event.metadata.usage.outputTokens ?? 0,
        );
      }
    }
  }

  async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken
  ): Promise<number> {
    const str = extractMessageText(text);
    return Math.ceil(str.length / 4);
  }
}
