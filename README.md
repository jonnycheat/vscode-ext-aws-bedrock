# VS Code AI Providers

Registers **AWS Bedrock** and **Azure AI Foundry** models as VS Code language model chat providers, so they show up in the Copilot model picker alongside your other models.


## First-time Setup

### AWS Bedrock
Open the Command Palette and run **AWS Bedrock: Configure API Key & Region**. You will be prompted to select a region and enter your Bedrock long-term API key. The key is stored securely in VS Code's secret storage.

On activation, the extension fetches your available models from the Bedrock API. Cross-region inference profiles are listed first (recommended for production), with foundation models as a fallback. 
The following families are supported: Anthropic Claude 3/4, Amazon Nova, Meta Llama 3/4, and Mistral AI.

### Azure AI Foundry
Open the Command Palette and run **Azure AI Foundry: Update Endpoint** and **Azure AI Foundry: Update API Key** to configure your Azure AI Foundry / GitHub Models endpoint. The extension registers GPT-5.6 Sol, Terra, and Luna models.

## Token Tracking

This extension keeps a running total of your aggregate token usage across both providers. You will see a live token counter pinned to your status bar indicating the volume of data processed since the tracker was last reset.

To force-reset the tracker, use **AI Providers: Reset Token Tracker** from the Command Palette, or click Reset Tokens in the hover tooltip.

## Commands

| Command | Description |
| ------- | ----------- |
| AWS Bedrock: Configure API Key & Region | First-time setup wizard for Bedrock |
| AWS Bedrock: Update API Key | Change the stored Bedrock API key |
| AWS Bedrock: Change Region | Switch the Bedrock inference region |
| AWS Bedrock: Refresh Model List | Force a model list refresh for Bedrock |
| AI Providers: Refresh Model Lists | Refresh both provider model lists |
| Azure AI Foundry: Configure API Key & Endpoint | First-time setup wizard for Azure |
| Azure AI Foundry: Update Endpoint | Change the Azure endpoint URL |
| Azure AI Foundry: Update API Key | Set the Azure API key |
| Azure AI Foundry: Refresh Model List | Force a model list refresh for Azure |
| AI Providers: Reset Token Tracker | Zero out the running token tracker |

## Local Installation

Download the `.vsix` file from the [latest GitHub release](https://github.com/jonnycheat/vscode-ext-ai-providers/releases/latest) and install it via **Extensions: Install from VSIX...** in the Command Palette.

## Development

Requirements: Node.js 22 or newer and VS Code 1.104 or newer.

```text
npm ci
npm run compile   # Type-check
npm test          # Run unit tests
npm run build     # Build the extension bundle
npm run package   # Create a VSIX
```

Use `npm run watch` while developing. The extension sends prompts and images directly to the configured provider endpoint. API keys are stored in VS Code SecretStorage and are not included in the extension settings or token tracker.

## Troubleshooting

- **No models appear:** configure the provider, verify the endpoint/region, then run the provider's **Refresh Model List** command.
- **Authentication errors:** update the API key and confirm that the key has access to the selected region, model, and streaming API.
- **Model unavailable:** provider catalogs vary by account, region, deployment, and service availability. Refresh the catalog and select an available model.
- **Images or tools fail:** select a model whose details advertise image input or tool calling; unsupported content is rejected by the upstream provider.
- **Unexpected pricing:** displayed pricing is an estimate based on the static model metadata and may vary by region, provider contract, or promotions.