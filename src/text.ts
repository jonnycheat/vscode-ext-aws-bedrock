export interface TextContentMessage {
  content: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function extractContentPartText(part: unknown): string {
  if (!isRecord(part) || typeof part['value'] !== 'string') { return ''; }
  return part['value'].trim();
}

export function extractToolResultText(part: unknown): string {
  if (!isRecord(part) || !Array.isArray(part['content'])) { return ''; }
  return part['content'].map(extractContentPartText).join('');
}

export function extractMessageText(text: string | TextContentMessage): string {
  if (typeof text === 'string') { return text; }
  if (!Array.isArray(text.content)) {
    return typeof text.content === 'string' ? text.content : '';
  }
  return text.content.map(part => {
    return extractContentPartText(part);
  }).join('');
}