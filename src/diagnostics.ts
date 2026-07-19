import * as vscode from 'vscode';

export interface ProviderLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
}

function formatError(error: unknown): string {
  if (error instanceof Error) { return error.name; }
  return 'UnknownError';
}

export function createProviderLogger(output: vscode.LogOutputChannel): ProviderLogger {
  return {
    info: message => output.info(message),
    warn: message => output.warn(message),
    error: (message, error) => output.error(`${message} (${formatError(error)})`),
  };
}