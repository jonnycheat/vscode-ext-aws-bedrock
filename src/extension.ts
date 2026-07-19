import * as vscode from 'vscode';
import { BedrockProvider } from './providers/bedrock';
import { AzureFoundryProvider } from './providers/azure-foundry';
import type { IProvider } from './providers/provider';
import { getBedrockRegion } from './config';
import { CONFIG_SECTIONS, SECRET_KEYS, validateHttpsUrl } from './config';
import { createProviderLogger } from './diagnostics';

const TOKEN_STATE_KEY = 'aiProviders.totalTokens';

interface TokenStats {
  total: number;
  byProvider: Record<string, number>;
  byModel: Record<string, Record<string, number>>;
}

class TokenTracker {
  private stats: TokenStats;
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private state: vscode.Memento) {
    const raw = state.get<unknown>(TOKEN_STATE_KEY);
    if (typeof raw === 'number') {
      this.stats = { total: raw, byProvider: {}, byModel: {} };
    } else if (raw && typeof raw === 'object' && 'total' in raw) {
      this.stats = raw as TokenStats;
    } else {
      this.stats = { total: 0, byProvider: {}, byModel: {} };
    }
  }

  get total(): number { return this.stats.total; }

  add(providerLabel: string, modelName: string, inputTokens: number, outputTokens: number): void {
    const sum = inputTokens + outputTokens;
    this.stats.total += sum;

    if (!this.stats.byProvider) { this.stats.byProvider = {}; }
    this.stats.byProvider[providerLabel] = (this.stats.byProvider[providerLabel] ?? 0) + sum;

    if (!this.stats.byModel) { this.stats.byModel = {}; }
    if (!this.stats.byModel[providerLabel]) { this.stats.byModel[providerLabel] = {}; }
    this.stats.byModel[providerLabel][modelName] = (this.stats.byModel[providerLabel][modelName] ?? 0) + sum;

    this.state.update(TOKEN_STATE_KEY, this.stats);
    this._onDidChange.fire();
  }

  reset(): void {
    this.stats = { total: 0, byProvider: {}, byModel: {} };
    this.state.update(TOKEN_STATE_KEY, this.stats);
    this._onDidChange.fire();
  }

  formatTotal(): string {
    return `${this.stats.total.toLocaleString()} tokens`;
  }

  getStats(): TokenStats {
    return this.stats;
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

function buildTooltip(tokenTracker: TokenTracker): vscode.MarkdownString {
  const region = getBedrockRegion();
  const md = new vscode.MarkdownString('', true);
  md.supportHtml = true;

  md.appendMarkdown(`$(cloud) **AI Providers**\n\n`);
  md.appendMarkdown(`---\n\n`);
  md.appendMarkdown(`<span style="color:var(--vscode-descriptionForeground);">Total processed tokens</span>\n\n`);
  md.appendMarkdown(`**<span style="color:var(--vscode-charts-green);">${tokenTracker.formatTotal()}</span>**\n\n`);

  const stats = tokenTracker.getStats();
  if (stats.byProvider && Object.keys(stats.byProvider).length > 0) {
    md.appendMarkdown(`---\n\n`);
    for (const [provider, total] of Object.entries(stats.byProvider)) {
      md.appendMarkdown(`<details><summary><strong>${provider}</strong>: ${total.toLocaleString()}</summary>\n\n`);
      const models = stats.byModel?.[provider] ?? {};
      for (const [model, count] of Object.entries(models)) {
        md.appendMarkdown(`- ${model}: *${count.toLocaleString()}*\n`);
      }
      md.appendMarkdown(`\n</details>\n\n`);
    }
  }

  md.appendMarkdown(`---\n\n`);
  md.appendMarkdown(`$(globe) <span style="color:var(--vscode-descriptionForeground);">AWS Region</span> \u2014 **${region}**\n\n`);
  md.appendMarkdown(`---\n\n`);
  md.appendMarkdown(
    `[$(key) Update AWS Key](command:aiProviders.bedrock.updateApiKey) \u2002 ` +
    `[$(key) Update Azure Key](command:aiProviders.azure.updateApiKey)\n\n` +
    `[$(globe) Change Region](command:aiProviders.bedrock.changeRegion) \u2002 ` +
    `[$(globe) Change Endpoint](command:aiProviders.azure.updateEndpoint)\n\n` +
    `[$(trash) Reset Tokens](command:aiProviders.resetTokens)`
  );

  md.isTrusted = {
    enabledCommands: [
      'aiProviders.resetTokens',
      'aiProviders.bedrock.updateApiKey',
      'aiProviders.bedrock.changeRegion',
      'aiProviders.azure.updateApiKey',
      'aiProviders.azure.updateEndpoint',
      'aiProviders.refreshModels'
    ]
  };
  return md;
}

function registerProvider(context: vscode.ExtensionContext, provider: IProvider, tokenTracker: TokenTracker): void {
  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider(provider.vendor, provider),
    provider.onUsage(({ inputTokens, outputTokens, meta }) => tokenTracker.add(provider.label, meta.name, inputTokens, outputTokens)),
  );
}

function registerRefreshCommand(
  context: vscode.ExtensionContext,
  command: string,
  provider: IProvider,
  label: string,
): void {
  context.subscriptions.push(vscode.commands.registerCommand(command, async () => {
    await provider.refresh();
    vscode.window.showInformationMessage(`${label}: Model list refreshed.`);
  }));
}

function registerSecretCommand(
  context: vscode.ExtensionContext,
  command: string,
  provider: IProvider,
  update: () => Promise<boolean>,
): void {
  context.subscriptions.push(vscode.commands.registerCommand(command, async () => {
    if (await update()) { await provider.refresh(); }
  }));
}

export function activate(context: vscode.ExtensionContext): void {
  const tokenTracker = new TokenTracker(context.globalState);
  const output = vscode.window.createOutputChannel('AI Providers', { log: true });
  const logger = createProviderLogger(output);
  context.subscriptions.push(output);

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.name = 'AI Providers Usage';
  const updateStatusBar = () => {
    statusBar.text = `$(cloud) ${tokenTracker.formatTotal()}`;
    statusBar.tooltip = buildTooltip(tokenTracker);
  };
  updateStatusBar();
  statusBar.show();
  context.subscriptions.push(statusBar, tokenTracker.onDidChange(updateStatusBar));

  const provider = new BedrockProvider(context.secrets, logger);
  context.subscriptions.push(provider);
  registerProvider(context, provider, tokenTracker);

  const azureProvider = new AzureFoundryProvider(context.secrets, logger);
  context.subscriptions.push(azureProvider, tokenTracker);
  registerProvider(context, azureProvider, tokenTracker);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration(CONFIG_SECTIONS.bedrock)) { void provider.refresh(); }
      if (event.affectsConfiguration(CONFIG_SECTIONS.azure)) { void azureProvider.refresh(); }
    }),
    vscode.commands.registerCommand('aiProviders.bedrock.configure', async () => {
      await runSetup(context.secrets);
      await provider.refresh();
    }),
    vscode.commands.registerCommand('aiProviders.bedrock.changeRegion', async () => {
      if (await runSelectRegion()) { await provider.refresh(); }
    }),
    vscode.commands.registerCommand('aiProviders.resetTokens', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Reset token tracker? This cannot be undone.',
        { modal: true }, 'Reset'
      );
      if (confirm === 'Reset') { tokenTracker.reset(); }
    }),

    vscode.commands.registerCommand('aiProviders.azure.configure', async () => {
      await runAzureSetup(context.secrets);
      await azureProvider.refresh();
    }),
  );

  registerSecretCommand(context, 'aiProviders.bedrock.updateApiKey', provider, () => runUpdateApiKey(context.secrets));
  registerRefreshCommand(context, 'aiProviders.bedrock.refreshModels', provider, 'AWS Bedrock');
  registerSecretCommand(context, 'aiProviders.azure.updateEndpoint', azureProvider, runUpdateAzureEndpoint);
  registerSecretCommand(context, 'aiProviders.azure.updateApiKey', azureProvider, () => runUpdateAzureApiKey(context.secrets));
  registerRefreshCommand(context, 'aiProviders.azure.refreshModels', azureProvider, 'Azure AI Foundry');
  context.subscriptions.push(vscode.commands.registerCommand('aiProviders.refreshModels', async () => {
    await Promise.all([provider.refresh(), azureProvider.refresh()]);
    vscode.window.showInformationMessage('AI Providers: Model lists refreshed.');
  }));

  context.secrets.get(SECRET_KEYS.bedrockApiKey).then(key => {
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

  azureProvider.refresh().catch(() => { /* ignore — no endpoint configured yet */ });
}

async function runSetup(secrets: vscode.SecretStorage): Promise<void> {
  if (!await runSelectRegion()) { return; }
  await runUpdateApiKey(secrets);
}

async function runSelectRegion(): Promise<boolean> {
  const regions = ['us-east-1', 'us-west-2', 'eu-central-1', 'eu-west-1', 'ap-northeast-1', 'ap-southeast-2'];
  const current = getBedrockRegion();
  const picked = await vscode.window.showQuickPick(
    regions.map(r => ({ label: r, picked: r === current })),
    { title: 'AWS Bedrock: Select Region', placeHolder: current }
  );
  if (!picked) { return false; }
  await vscode.workspace.getConfiguration(CONFIG_SECTIONS.bedrock).update('region', picked.label, vscode.ConfigurationTarget.Global);
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
  await secrets.store(SECRET_KEYS.bedrockApiKey, apiKey.trim());
  vscode.window.showInformationMessage('AWS Bedrock API key updated.');
  return true;
}

async function runUpdateAzureEndpoint(): Promise<boolean> {
  const current = vscode.workspace.getConfiguration(CONFIG_SECTIONS.azure).get<string>('endpoint') ?? '';
  const endpoint = await vscode.window.showInputBox({
    title: 'Azure AI Foundry: Update Endpoint',
    prompt: 'Azure AI Foundry / GitHub Models endpoint URL',
    value: current,
    placeHolder: 'https://models.inference.ai.azure.com',
    ignoreFocusOut: true,
    validateInput: v => {
      if (!v.trim()) { return 'Endpoint URL is required'; }
      return validateHttpsUrl(v);
    },
  });
  if (!endpoint) { return false; }
  await vscode.workspace.getConfiguration(CONFIG_SECTIONS.azure).update('endpoint', endpoint.trim(), vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage('Azure AI Foundry: Endpoint updated.');
  return true;
}

async function runUpdateAzureApiKey(secrets: vscode.SecretStorage): Promise<boolean> {
  const apiKey = await vscode.window.showInputBox({
    title: 'Azure AI Foundry: Update API Key',
    prompt: 'Enter your Azure AI Foundry or GitHub Models API key',
    password: true,
    ignoreFocusOut: true,
    validateInput: v => v.trim() ? undefined : 'API key is required',
  });
  if (!apiKey) { return false; }
  await secrets.store(SECRET_KEYS.azureApiKey, apiKey.trim());
  vscode.window.showInformationMessage('Azure AI Foundry: API key updated.');
  return true;
}

async function runAzureSetup(secrets: vscode.SecretStorage): Promise<void> {
  if (!await runUpdateAzureEndpoint()) { return; }
  await runUpdateAzureApiKey(secrets);
}

export function deactivate(): void { }
