/**
 * Entry point for provider adapters. They're loaded on demand so the provider
 * SDK only downloads once the assistant is used.
 */
import type { Adapter, ProviderId } from './types';

export async function loadAdapter(provider: ProviderId): Promise<Adapter> {
	if (provider === 'anthropic') return (await import('./providers/anthropic')).anthropicAdapter();
	return (await import('./providers/gemini')).geminiAdapter();
}
