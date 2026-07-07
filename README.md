# AWS Bedrock LM Provider

Registers AWS Bedrock models as VS Code language model chat providers, so they show up in the Copilot model picker alongside your other models.

## Setup

Open the Command Palette and run **AWS Bedrock: Configure API Key & Region**. You will be prompted to select a region and enter your Bedrock API key. The key is stored in VS Code's secret storage and never written to disk in plain text.

To update your key or region independently, use **AWS Bedrock: Update API Key** and **AWS Bedrock: Change Region**.

## Models

On activation, the extension fetches your available models from the Bedrock API. Cross-region inference profiles are listed first (recommended for production), with foundation models as a fallback. If the API call fails, two Claude Sonnet 4 models are used as a built-in fallback.

The following families are supported: Anthropic Claude 3/4, Amazon Nova, Meta Llama 3/4, and Mistral AI. Pricing and context limits are sourced from the AWS us-east-1 on-demand pricing page and embedded in the extension, since the Bedrock API does not expose them.

## Cost tracker

Every response updates a running cost estimate shown in the status bar as a cloud icon followed by a dollar amount. The total persists across restarts. Hover the status bar item to see the current region and action links for updating your API key, changing region, or resetting the counter.

To force-reset the tracker, use **AWS Bedrock: Reset Cost Tracker** from the Command Palette, or click Reset in the hover tooltip.

## Commands

| Command | Description |
|---|---|
| AWS Bedrock: Configure API Key & Region | First-time setup wizard |
| AWS Bedrock: Update API Key | Change the stored API key |
| AWS Bedrock: Change Region | Switch the inference region |
| AWS Bedrock: Refresh Models | Force a model list refresh |
| AWS Bedrock: Reset Cost Tracker | Zero out the running total |

## Installation

Download the `.vsix` file from the [latest GitHub release](https://github.com/YOUR_USERNAME/vscode-ext-aws-bedrock/releases/latest) and install it via **Extensions: Install from VSIX...** in the Command Palette.

## Requirements

A Bedrock-compatible API key with access to the models you want to use. The extension uses Bearer token authentication, so standard AWS IAM credentials are not required.