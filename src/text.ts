export interface TextContentMessage {
  content: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function extractMessageText(text: string | TextContentMessage): string {
  if (typeof text === 'string') { return text; }
  if (!Array.isArray(text.content)) {
    return typeof text.content === 'string' ? text.content : '';
  }
  return text.content.map(part => {
    const value = isRecord(part) ? part['value'] : undefined;
    return typeof value === 'string' ? value : '';
  }).join('');
}