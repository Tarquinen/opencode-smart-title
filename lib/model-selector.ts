/**
 * Model Selection and Fallback Logic for Smart Title
 * 
 * This module handles intelligent model selection for title generation.
 * It tries models in order from a predefined fallback list.
 */

import type { LanguageModel } from 'ai';
import { OpencodeAI } from '@tarquinen/opencode-auth-provider';
import type { Logger } from './logger';

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
    logger?.info('model-selector', 'Model selection started', { configModel });
    const opencodeAI = new OpencodeAI();

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
                const model = await opencodeAI.getLanguageModel(providerID, modelID);
                logger?.info('model-selector', '✓ Successfully using config-specified model', {
                    providerID,
                    modelID
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
                    error: error.message
                });
                // Track the failed model
                failedModelInfo = { providerID, modelID };
            }
        }
    }

    logger?.debug('model-selector', 'Fetching available authenticated providers');
    const providers = await opencodeAI.listProviders();
    const availableProviderIDs = Object.keys(providers);
    logger?.info('model-selector', 'Available authenticated providers', {
        providerCount: availableProviderIDs.length,
        providerIDs: availableProviderIDs,
        providers: Object.entries(providers).map(([id, info]) => ({
            id,
            source: info.source,
            name: info.info.name
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
            const model = await opencodeAI.getLanguageModel(providerID, fallbackModelID);
            logger?.info('model-selector', `✓ Successfully using fallback model`, {
                providerID,
                modelID: fallbackModelID
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
                error: error.message
            });
            continue;
        }
    }

    throw new Error('No available models for title generation. Please authenticate with at least one provider.');
}


