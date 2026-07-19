import * as vscode from 'vscode';
import type { ModelDef } from '../models';
export { extractMessageText } from '../text';

export type ProviderModelInfo = vscode.LanguageModelChatInformation & Record<string, unknown>;

export interface UsageEvent {
  inputTokens: number;
  outputTokens: number;
  meta: ModelDef;
}

export interface IProvider extends vscode.LanguageModelChatProvider, vscode.Disposable {
  /** Human-readable label, e.g. "AWS Bedrock" */
  readonly label: string;

  /** VS Code vendor identifier used when registering the provider */
  readonly vendor: string;

  /** Force-expire the model cache and re-fetch. */
  refresh(): Promise<void>;

  /** Fired whenever the token tracker should be updated. */
  readonly onUsage: vscode.Event<UsageEvent>;
}

export interface ModelInfoOptions {
  family: string;
  cacheTooltip?: string;
  configurationSchema?: unknown;
}

export function createModelInformation(model: ModelDef, options: ModelInfoOptions): ProviderModelInfo {
  const ctxK = Math.round(model.maxInputTokens / 1000);
  const tooltipParts = [
    `Context: ${ctxK}k tokens`,
    `Input: $${model.inputCostPerMillion} / Output: $${model.outputCostPerMillion} per 1M tokens`,
    options.cacheTooltip ?? '',
    model.supportsImages ? 'Supports image input' : 'Text only',
    model.supportsThinking ? 'Supports extended thinking' : '',
  ].filter(Boolean);

  const info: ProviderModelInfo = {
    id: model.id,
    name: model.name,
    family: options.family,
    version: '1.0.0',
    maxInputTokens: model.maxInputTokens,
    maxOutputTokens: model.maxOutputTokens,
    detail: `${ctxK}k ctx · $${model.inputCostPerMillion}/$${model.outputCostPerMillion}`,
    tooltip: tooltipParts.join('\n'),
    capabilities: { toolCalling: true, imageInput: model.supportsImages },
    configurationSchema: options.configurationSchema,
    pricing: `In: $${model.inputCostPerMillion} · Out: $${model.outputCostPerMillion} per 1M tokens`,
    inputCost: model.inputCostPerMillion,
    outputCost: model.outputCostPerMillion,
    cacheCost: model.cacheCostPerMillion,
    cacheWriteCost: model.cacheWriteCostPerMillion,
    isBYOK: true,
  };
  return info;
}

export function reportUsage(
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  emit: (event: UsageEvent) => void,
  meta: ModelDef,
  inputTokens: number,
  outputTokens: number,
): void {
  emit({ inputTokens, outputTokens, meta });
  progress.report(
    new vscode.LanguageModelDataPart(
      new TextEncoder().encode(JSON.stringify({
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      })),
      'usage'
    )
  );
}

