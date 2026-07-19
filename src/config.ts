import * as vscode from 'vscode';

export const CONFIG_SECTIONS = {
  bedrock: 'aiProviders.bedrock',
  azure: 'aiProviders.azure',
} as const;

export const SECRET_KEYS = {
  bedrockApiKey: 'aiProviders.bedrock.apiKey',
  azureApiKey: 'aiProviders.azure.apiKey',
} as const;

export function getBedrockRegion(): string {
  return vscode.workspace.getConfiguration(CONFIG_SECTIONS.bedrock).get<string>('region') ?? 'us-east-1';
}

export function getAzureEndpoint(): string {
  return vscode.workspace.getConfiguration(CONFIG_SECTIONS.azure).get<string>('endpoint') ?? '';
}

export function validateHttpsUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? undefined : 'Endpoint must use HTTPS';
  } catch {
    return 'Must be a valid HTTPS URL';
  }
}