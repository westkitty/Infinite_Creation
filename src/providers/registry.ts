// Provider adapter registry: interfaces for FUTURE generation providers.
// The offline production engine never depends on provider availability.
// No cloud integration ships by default; all built-ins are `unavailable`.

export type ProviderState = 'unavailable' | 'not_configured' | 'ready' | 'running' | 'failed';

export interface ProviderMeta {
  providerId: string;
  version: string;
  operations: string[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  state: ProviderState;
  auth: string;
  executionMode: 'local' | 'remote' | 'hybrid';
  cancellation: boolean;
  cost?: string;
  note?: string;
}

export interface ProviderHandler {
  meta: ProviderMeta;
  execute: (inputs: Record<string, unknown>, signal: AbortSignal) => Promise<Record<string, unknown>>;
}

const handlers = new Map<string, ProviderHandler>();

const BUILT_INS: ProviderMeta[] = [
  {
    providerId: 'image-generation', version: '0',
    operations: ['provider.imageGen'],
    inputSchema: { prompt: 'TextPrompt' }, outputSchema: { image: 'ImageAsset' },
    state: 'unavailable', auth: 'none configured', executionMode: 'remote',
    cancellation: false, note: 'No image-generation provider is configured. This node cannot execute.',
  },
  {
    providerId: 'video-generation', version: '0',
    operations: ['provider.videoGen'],
    inputSchema: { prompt: 'TextPrompt' }, outputSchema: { video: 'VideoAsset' },
    state: 'unavailable', auth: 'none configured', executionMode: 'remote',
    cancellation: false, note: 'No video-generation provider is configured. This node cannot execute.',
  },
  {
    providerId: 'audio-generation', version: '0',
    operations: ['provider.audioGen'],
    inputSchema: { prompt: 'TextPrompt' }, outputSchema: { audio: 'AudioAsset' },
    state: 'unavailable', auth: 'none configured', executionMode: 'remote',
    cancellation: false, note: 'No audio-generation provider is configured. This node cannot execute.',
  },
];

export function listProviders(): ProviderMeta[] {
  const customs = [...handlers.values()].map((h) => h.meta);
  return [...BUILT_INS, ...customs];
}

/** Register a real adapter. The handler must produce actual bytes; the engine
 *  records whatever it returns as-is (no fabrication by the registry). */
export function registerProvider(handler: ProviderHandler): void {
  if (!handler.meta.providerId) throw new Error('Provider needs an id');
  if (handlers.has(handler.meta.providerId)) throw new Error(`Provider ${handler.meta.providerId} already registered`);
  handlers.set(handler.meta.providerId, handler);
}

export function unregisterProvider(providerId: string): void {
  handlers.delete(providerId);
}

export function getProvider(providerId: string): ProviderHandler | undefined {
  return handlers.get(providerId);
}

/** Is there a usable (ready) adapter for the given node type? Never true for built-ins. */
export function hasUsableAdapter(nodeType: string): boolean {
  for (const h of handlers.values()) {
    if (h.meta.state === 'ready' && h.meta.operations.includes(nodeType)) return true;
  }
  return false;
}
