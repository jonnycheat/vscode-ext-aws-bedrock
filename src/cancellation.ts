import * as vscode from 'vscode';

export function createAbortController(token: vscode.CancellationToken): AbortController {
  const controller = new AbortController();
  const subscription = token.onCancellationRequested(() => controller.abort());
  if (token.isCancellationRequested) { controller.abort(); }
  controller.signal.addEventListener('abort', () => subscription.dispose(), { once: true });
  return controller;
}