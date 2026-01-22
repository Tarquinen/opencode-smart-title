/**
 * Smart Title Plugin for OpenCode
 * 
 * Automatically generates meaningful session titles based on conversation content.
 * Uses OpenCode auth provider for unified authentication across all AI providers.
 * 
 * Configuration: ~/.config/opencode/smart-title.jsonc
 * Logs: ~/.config/opencode/logs/smart-title/YYYY-MM-DD.log
 * 
 * NOTE: ai package is lazily imported to avoid loading the 2.8MB package during
 * plugin initialization. The package is only loaded when title generation is needed.
 */

import type { Plugin } from "@opencode-ai/plugin"
import { getConfig } from "./lib/config.js"
import { Logger } from "./lib/logger.js"
import { selectModel } from "./lib/model-selector.js"
import { TITLE_PROMPT } from "./prompt.js"
import { join, basename } from "path"
import { homedir } from "os"

// Type for OpenCode client object
interface OpenCodeClient {
    session: {
        messages: (params: { path: { id: string } }) => Promise<any>
        update: (params: { path: { id: string }, body: { title: string } }) => Promise<any>
        get: (params: { path: { id: string } }) => Promise<any>
    }
    tui: {
        showToast: (params: { body: { title: string, message: string, variant: "info" | "success" | "warning" | "error", duration: number } }) => Promise<any>
    }
}

// Conversation turn structure for context extraction
interface ConversationTurn {
    user: {
        text: string
        time: number
    }
    assistant?: {
        first: string
        last: string
        time: number
    }
}

interface MessagePart {
    type: string
    text?: string
    synthetic?: boolean
}

interface Message {
    info: {
        id: string
        role: "user" | "assistant" | "system"
        sessionID: string
        time: {
            created: number
            completed?: number
        }
        parentID?: string
    }
    parts: MessagePart[]
}

/**
 * Checks if a session is a subagent (child session)
 * Subagent sessions should skip title generation
 */
async function isSubagentSession(
    client: OpenCodeClient,
    sessionID: string,
    logger: Logger
): Promise<boolean> {
    try {
        const result = await client.session.get({ path: { id: sessionID } })

        if (result.data?.parentID) {
            logger.debug("subagent-check", "Detected subagent session, skipping title generation", {
                sessionID,
                parentID: result.data.parentID
            })
            return true
        }

        return false
    } catch (error: any) {
        logger.error("subagent-check", "Failed to check if session is subagent", {
            sessionID,
            error: error.message
        })
        return false
    }
}

// Track idle event count per session for threshold-based updates
const sessionIdleCount = new Map<string, number>()

/**
 * Extract only text content from message parts, excluding synthetic content
 */
function extractTextOnly(parts: MessagePart[]): string {
    // Only extract text parts, exclude synthetic content
    const textParts = parts.filter(
        part => part.type === "text" && !part.synthetic
    )

    return textParts
        .map(part => part.text || '')
        .join("\n")
        .trim()
}

/**
 * Extract smart context from conversation
 * Returns first and last assistant messages per turn to minimize token usage
 */
async function extractSmartContext(
    client: OpenCodeClient,
    sessionId: string,
    logger: Logger
): Promise<ConversationTurn[]> {

    logger.debug('context-extraction', 'Fetching session messages', { sessionId })

    // Get all messages
    const { data: messages } = await client.session.messages({
        path: { id: sessionId }
    })

    logger.debug('context-extraction', 'Messages fetched', {
        sessionId,
        totalMessages: messages.length
    })

    // Filter out system messages
    const conversationMessages = messages.filter(
        (msg: Message) => msg.info.role === "user" || msg.info.role === "assistant"
    )

    logger.debug('context-extraction', 'Filtered conversation messages', {
        sessionId,
        conversationMessages: conversationMessages.length
    })

    // Group into turns
    const turns: ConversationTurn[] = []
    let currentTurn: ConversationTurn | null = null
    let assistantMessagesInTurn: Array<{ text: string, time: number }> = []

    for (const msg of conversationMessages) {
        if (msg.info.role === "user") {
            // Save previous turn if exists
            if (currentTurn && assistantMessagesInTurn.length > 0) {
                currentTurn.assistant = {
                    first: assistantMessagesInTurn[0].text,
                    last: assistantMessagesInTurn[assistantMessagesInTurn.length - 1].text,
                    time: assistantMessagesInTurn[0].time
                }
                turns.push(currentTurn)
            }

            // Start new turn
            const userText = extractTextOnly(msg.parts)
            currentTurn = {
                user: {
                    text: userText,
                    time: msg.info.time.created
                }
            }
            assistantMessagesInTurn = []

        } else if (msg.info.role === "assistant") {
            // Collect assistant messages for this turn
            const assistantText = extractTextOnly(msg.parts)
            if (assistantText.length > 0) {
                assistantMessagesInTurn.push({
                    text: assistantText,
                    time: msg.info.time.created
                })
            }
        }
    }

    // Don't forget the last turn (might not have assistant response yet)
    if (currentTurn) {
        if (assistantMessagesInTurn.length > 0) {
            currentTurn.assistant = {
                first: assistantMessagesInTurn[0].text,
                last: assistantMessagesInTurn[assistantMessagesInTurn.length - 1].text,
                time: assistantMessagesInTurn[0].time
            }
        }

        // Include the turn even if it doesn't have an assistant response yet
        // This ensures the triggering user message is included in the context
        turns.push(currentTurn)
    }

    logger.debug('context-extraction', 'Extracted conversation turns', {
        sessionId,
        turnCount: turns.length
    })

    return turns
}

/**
 * Truncate text to specified length with ellipsis
 */
function truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text
    return text.substring(0, maxLength) + "..."
}

/**
 * Format conversation context for title generation
 */
function formatContextForTitle(turns: ConversationTurn[]): string {
    const formatted: string[] = []

    for (const turn of turns) {
        // Add user message
        formatted.push(`User: ${turn.user.text}`)
        formatted.push("") // Empty line for readability

        // Add assistant messages if they exist
        if (turn.assistant) {
            if (turn.assistant.first === turn.assistant.last) {
                // Only one message - don't duplicate
                formatted.push(`Assistant: ${turn.assistant.first}`)
            } else {
                // Multiple messages - show first and last
                formatted.push(`Assistant (initial): ${turn.assistant.first}`)
                formatted.push(`Assistant (final): ${turn.assistant.last}`)
            }
            formatted.push("") // Empty line between turns
        }
    }

    return formatted.join("\n")
}

/**
 * Clean AI-generated title
 */
function cleanTitle(raw: string): string {
    // Remove thinking tags
    let cleaned = raw.replace(/<think>[\s\S]*?<\/think>\s*/g, "")

    // Get first non-empty line
    const lines = cleaned.split("\n").map(line => line.trim())
    cleaned = lines.find(line => line.length > 0) || "Untitled"

    // Truncate if too long
    if (cleaned.length > 100) {
        cleaned = cleaned.substring(0, 97) + "..."
    }

    return cleaned
}

/**
 * Placeholder values available for title formatting
 */
interface PlaceholderValues {
    title: string
    cwd: string
    cwdTip: string
}

/**
 * Apply placeholder replacements to title format
 * Supports: {title}, {cwd}, {cwdTip}
 */
function applyTitleFormat(format: string, values: PlaceholderValues): string {
    let result = format
        .replace(/\{title\}/g, values.title)
        .replace(/\{cwd\}/g, values.cwd)
        .replace(/\{cwdTip\}/g, values.cwdTip)

    // Truncate final result if too long
    if (result.length > 100) {
        result = result.substring(0, 97) + "..."
    }

    return result
}

/**
 * Generate title from conversation context using AI
 */
async function generateTitleFromContext(
    context: string,
    configModel: string | undefined,
    logger: Logger,
    client: OpenCodeClient
): Promise<string | null> {
    try {
        logger.debug('title-generation', 'Selecting model', { configModel })

        const { model, modelInfo, source, reason, failedModel } = await selectModel(
            logger,
            configModel
        )

        logger.info('title-generation', 'Model selected', {
            providerID: modelInfo.providerID,
            modelID: modelInfo.modelID,
            source,
            reason
        })

        // Show toast if we had to fallback from a configured model
        if (failedModel) {
            try {
                await client.tui.showToast({
                    body: {
                        title: "Smart Title: Model fallback",
                        message: `${failedModel.providerID}/${failedModel.modelID} failed\nUsing ${modelInfo.providerID}/${modelInfo.modelID}`,
                        variant: "info",
                        duration: 5000
                    }
                })
                logger.info('title-generation', 'Toast notification shown for model fallback', {
                    failedModel,
                    selectedModel: modelInfo
                })
            } catch (toastError: any) {
                logger.error('title-generation', 'Failed to show toast notification', {
                    error: toastError.message
                })
                // Don't fail the whole operation if toast fails
            }
        }

        logger.debug('title-generation', 'Generating title', {
            contextLength: context.length
        })

        // Lazy import - only load the 2.8MB ai package when actually needed
        const { generateText } = await import('ai')

        const result = await generateText({
            model,
            messages: [
                {
                    role: 'user',
                    content: `${TITLE_PROMPT}\n\n<conversation>\n${context}\n</conversation>\n\nOutput the title now:`
                }
            ]
        })

        const title = cleanTitle(result.text)

        logger.info('title-generation', 'Title generated successfully', {
            title,
            titleLength: title.length,
            rawLength: result.text.length
        })

        return title

    } catch (error: any) {
        logger.error('title-generation', 'Failed to generate title', {
            error: error.message,
            stack: error.stack
        })
        return null
    }
}

/**
 * Update session title with smart context
 */
async function updateSessionTitle(
    client: OpenCodeClient,
    sessionId: string,
    logger: Logger,
    config: ReturnType<typeof getConfig>,
    cwd: string
): Promise<void> {
    try {
        logger.info('update-title', 'Title update triggered', { sessionId, cwd })

        // Extract smart context
        const turns = await extractSmartContext(client, sessionId, logger)

        // Need at least one turn to generate title
        if (turns.length === 0) {
            logger.warn('update-title', 'No conversation turns found', { sessionId })
            return
        }

        logger.info('update-title', 'Context extracted', {
            sessionId,
            turnCount: turns.length
        })

        // Log truncated context for debugging
        for (const turn of turns) {
            logger.debug('update-title', 'Turn context', {
                user: truncate(turn.user.text, 100),
                hasAssistant: !!turn.assistant
            })
        }

        // Format context
        const context = formatContextForTitle(turns)

        // Generate title from AI
        const generatedTitle = await generateTitleFromContext(
            context,
            config.model,
            logger,
            client
        )

        if (!generatedTitle) {
            logger.warn('update-title', 'Title generation returned null', { sessionId })
            return
        }

        // Apply title format with placeholders
        const placeholderValues: PlaceholderValues = {
            title: generatedTitle,
            cwd: cwd,
            cwdTip: basename(cwd)
        }

        const newTitle = applyTitleFormat(config.titleFormat, placeholderValues)

        logger.info('update-title', 'Updating session with new title', {
            sessionId,
            generatedTitle,
            titleFormat: config.titleFormat,
            finalTitle: newTitle
        })

        // Update session
        await client.session.update({
            path: { id: sessionId },
            body: { title: newTitle }
        })

        logger.info('update-title', 'Session title updated successfully', {
            sessionId,
            title: newTitle
        })

    } catch (error: any) {
        logger.error('update-title', 'Failed to update session title', {
            sessionId,
            error: error.message,
            stack: error.stack
        })
    }
}

/**
 * Smart Title Plugin
 * Automatically updates session titles using AI and smart context selection
 */
const SmartTitlePlugin: Plugin = async (ctx) => {
    const config = getConfig(ctx)

    // Exit early if plugin is disabled
    if (!config.enabled) {
        return {}
    }

    const logger = new Logger(config.debug)
    const { client } = ctx

    const cwd = ctx.directory || process.cwd()

    logger.info('plugin', 'Smart Title plugin initialized', {
        enabled: config.enabled,
        debug: config.debug,
        model: config.model,
        updateThreshold: config.updateThreshold,
        titleFormat: config.titleFormat,
        cwd,
        globalConfigFile: join(homedir(), ".config", "opencode", "smart-title.jsonc"),
        projectConfigFile: ctx.directory ? join(ctx.directory, ".opencode", "smart-title.jsonc") : "N/A",
        logDirectory: join(homedir(), ".config", "opencode", "logs", "smart-title")
    })

    return {
        event: async ({ event }) => {
            // @ts-ignore - session.status is not yet in the SDK types
            if (event.type === "session.status" && event.properties.status.type === "idle") {
                // @ts-ignore
                const sessionId = event.properties.sessionID

                logger.debug('event', 'Session became idle', { sessionId })

                // Skip if this is a subagent session
                if (await isSubagentSession(client, sessionId, logger)) {
                    return
                }

                // Increment idle count for this session
                const currentCount = (sessionIdleCount.get(sessionId) || 0) + 1
                sessionIdleCount.set(sessionId, currentCount)

                logger.debug('event', 'Idle count updated', {
                    sessionId,
                    currentCount,
                    threshold: config.updateThreshold
                })

                // Only update title if we've reached the threshold
                if (currentCount % config.updateThreshold !== 0) {
                    logger.debug('event', 'Threshold not reached, skipping title update', {
                        sessionId,
                        currentCount,
                        threshold: config.updateThreshold
                    })
                    return
                }

                logger.info('event', 'Threshold reached, triggering title update for idle session', {
                    sessionId,
                    currentCount,
                    threshold: config.updateThreshold
                })

                // Fire and forget - don't block the event handler
                updateSessionTitle(client, sessionId, logger, config, cwd).catch((error) => {
                    logger.error('event', 'Title update failed', {
                        sessionId,
                        error: error.message,
                        stack: error.stack
                    })
                })
            }
        }
    }
}

export default SmartTitlePlugin
