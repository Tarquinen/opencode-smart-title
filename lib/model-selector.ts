/**
 * Model Selection and Fallback Logic for Smart Title
 * 
 * This module handles intelligent model selection for title generation.
 * It tries models in order from a predefined fallback list.
 * 
 * NOTE: OpencodeAI is lazily imported to avoid loading the 812KB package during
 * plugin initialization. The package is only loaded when model selection is needed.
 */

import type { LanguageModel } from 'ai';
import type { Logger } from './logger';

function trimText(value: unknown, max = 500): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    return value.length > max ? `${value.slice(0, max)}...` : value;
}

function serializeError(error: unknown): Record<string, unknown> {
    if (!error || typeof error !== 'object') {
        return {
            type: typeof error,
            value: String(error)
        };
    }

    const err = error as any;
    const cause = err?.cause && typeof err.cause === 'object'
        ? {
            name: err.cause.name,
            message: trimText(err.cause.message),
            constructor: err.cause.constructor?.name,
            code: err.cause.code,
            stack: trimText(err.cause.stack)
        }
        : undefined;

    return {
        name: err.name,
        message: trimText(err.message),
        constructor: err.constructor?.name,
        code: err.code,
        providerID: err.providerID,
        modelID: err.modelID,
        status: err.status,
        stack: trimText(err.stack),
        keys: Object.keys(err),
        cause
    };
}

export interface ModelInfo {
    providerID: string;
    modelID: string;
}

export const FALLBACK_MODELS: Record<string, string> = {
    openai: 'gpt-5-mini',
    anthropic: 'claude-haiku-4-5',
    google: 'gemini-2.5-flash',
    deepseek: 'deepseek-chat',
    xai: 'grok-4-fast',
    alibaba: 'qwen3-coder-flash',
    zai: 'glm-4.5-flash',
    opencode: 'big-pickle'
};

const PROVIDER_PRIORITY = [
    'openai',
    'anthropic',
    'google',
    'deepseek',
    'xai',
    'alibaba',
    'zai',
    'opencode'
];

export interface ModelSelectionResult {
    model: LanguageModel;
    modelInfo: ModelInfo;
    source: 'config' | 'fallback';
    reason?: string;
    failedModel?: ModelInfo; // The model that failed, if any
}

/**
 * Main model selection function with intelligent fallback logic
 * 
 * Selection hierarchy:
 * 1. Try the config-specified model (if provided)
 * 2. Try fallback models from authenticated providers (in priority order)
 * 
 * @param logger - Logger instance for debug output
 * @param configModel - Model string in "provider/model" format (e.g., "anthropic/claude-haiku-4-5")
 * @returns Selected model with metadata about the selection
 */
export async function selectModel(
    logger?: Logger,
    configModel?: string
): Promise<ModelSelectionResult> {
    const startedAt = Date.now();
    logger?.info('model-selector', 'Model selection started', { configModel });

    // Lazy import - only load the 812KB auth provider package when actually needed
    logger?.debug('model-selector', 'Importing @tarquinen/opencode-auth-provider');
    const importStartedAt = Date.now();
    const { OpencodeAI } = await import('@tarquinen/opencode-auth-provider');
    logger?.debug('model-selector', 'Auth provider imported', {
        importDurationMs: Date.now() - importStartedAt
    });

    const initStartedAt = Date.now();
    const opencodeAI = new OpencodeAI();
    logger?.debug('model-selector', 'OpencodeAI instance created', {
        initDurationMs: Date.now() - initStartedAt
    });

    let failedModelInfo: ModelInfo | undefined;

    if (configModel) {
        const parts = configModel.split('/')
        if (parts.length !== 2) {
            logger?.warn('model-selector', '✗ Invalid config model format, expected "provider/model"', {
                configModel
            });
        } else {
            const [providerID, modelID] = parts
            logger?.debug('model-selector', 'Attempting to use config-specified model', {
                providerID,
                modelID
            });

            try {
                const attemptStartedAt = Date.now();
                const model = await opencodeAI.getLanguageModel(providerID, modelID);
                logger?.info('model-selector', '✓ Successfully using config-specified model', {
                    providerID,
                    modelID,
                    durationMs: Date.now() - attemptStartedAt
                });
                return {
                    model,
                    modelInfo: { providerID, modelID },
                    source: 'config',
                    reason: 'Using model specified in smart-title.jsonc config'
                };
            } catch (error: any) {
                logger?.warn('model-selector', '✗ Failed to use config-specified model, falling back', {
                    providerID,
                    modelID,
                    error: serializeError(error)
                });
                // Track the failed model
                failedModelInfo = { providerID, modelID };
            }
        }
    }

    logger?.debug('model-selector', 'Fetching available authenticated providers');
    const listStartedAt = Date.now();
    const providers = await opencodeAI.listProviders();
    logger?.debug('model-selector', 'Authenticated providers fetched', {
        durationMs: Date.now() - listStartedAt
    });

    const availableProviderIDs = Object.keys(providers);
    logger?.info('model-selector', 'Available authenticated providers', {
        providerCount: availableProviderIDs.length,
        providerIDs: availableProviderIDs,
        providers: Object.entries(providers).map(([id, info]) => ({
            id,
            source: info.source,
            name: info.info.name,
            modelCount: Object.keys(info.info.models || {}).length,
            sampleModels: Object.keys(info.info.models || {}).slice(0, 10)
        }))
    });

    logger?.debug('model-selector', 'Attempting fallback models from providers', {
        priorityOrder: PROVIDER_PRIORITY
    });

    for (const providerID of PROVIDER_PRIORITY) {
        if (!providers[providerID]) {
            logger?.debug('model-selector', `Skipping ${providerID} (not authenticated)`);
            continue;
        }

        const fallbackModelID = FALLBACK_MODELS[providerID];
        if (!fallbackModelID) {
            logger?.debug('model-selector', `Skipping ${providerID} (no fallback model configured)`);
            continue;
        }

        logger?.debug('model-selector', `Attempting ${providerID}/${fallbackModelID}`);

        try {
            const attemptStartedAt = Date.now();
            const model = await opencodeAI.getLanguageModel(providerID, fallbackModelID);
            logger?.info('model-selector', `✓ Successfully using fallback model`, {
                providerID,
                modelID: fallbackModelID,
                durationMs: Date.now() - attemptStartedAt
            });
            return {
                model,
                modelInfo: { providerID, modelID: fallbackModelID },
                source: 'fallback',
                reason: `Using ${providerID}/${fallbackModelID}`,
                failedModel: failedModelInfo
            };
        } catch (error: any) {
            logger?.warn('model-selector', `✗ Failed to use ${providerID}/${fallbackModelID}`, {
                error: serializeError(error)
            });
            continue;
        }
    }

    logger?.error('model-selector', 'Model selection failed after exhausting configured and fallback models', {
        configModel,
        providerPriority: PROVIDER_PRIORITY,
        fallbackModels: FALLBACK_MODELS,
        totalDurationMs: Date.now() - startedAt,
        failedModelInfo
    });

    throw new Error('No available models for title generation. Please authenticate with at least one provider.');
}

