// lib/config.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { parse } from 'jsonc-parser'
import type { PluginInput } from '@opencode-ai/plugin'

export interface PluginConfig {
    enabled: boolean
    debug: boolean
    model?: string
    prompt?: string
    updateThreshold: number
    excludeDirectories?: string[]
}

const defaultConfig: PluginConfig = {
    enabled: true,
    debug: false,
    updateThreshold: 1
}

const GLOBAL_CONFIG_DIR = join(homedir(), '.config', 'opencode')
const GLOBAL_CONFIG_PATH_JSONC = join(GLOBAL_CONFIG_DIR, 'smart-title.jsonc')
const GLOBAL_CONFIG_PATH_JSON = join(GLOBAL_CONFIG_DIR, 'smart-title.json')

/**
 * Searches for .opencode directory starting from current directory and going up
 * Returns the path to .opencode directory if found, null otherwise
 */
function findOpencodeDir(startDir: string): string | null {
    let current = startDir
    while (current !== '/') {
        const candidate = join(current, '.opencode')
        if (existsSync(candidate) && statSync(candidate).isDirectory()) {
            return candidate
        }
        const parent = dirname(current)
        if (parent === current) break // Reached root
        current = parent
    }
    return null
}

/**
 * Determines which config file to use (prefers .jsonc, falls back to .json)
 * Checks both project-level and global configs
 */
function getConfigPaths(ctx?: PluginInput): { global: string | null, project: string | null } {
    // Global config paths
    let globalPath: string | null = null
    if (existsSync(GLOBAL_CONFIG_PATH_JSONC)) {
        globalPath = GLOBAL_CONFIG_PATH_JSONC
    } else if (existsSync(GLOBAL_CONFIG_PATH_JSON)) {
        globalPath = GLOBAL_CONFIG_PATH_JSON
    }

    // Project config paths (if context provided)
    let projectPath: string | null = null
    if (ctx?.directory) {
        const opencodeDir = findOpencodeDir(ctx.directory)
        if (opencodeDir) {
            const projectJsonc = join(opencodeDir, 'smart-title.jsonc')
            const projectJson = join(opencodeDir, 'smart-title.json')
            if (existsSync(projectJsonc)) {
                projectPath = projectJsonc
            } else if (existsSync(projectJson)) {
                projectPath = projectJson
            }
        }
    }

    return { global: globalPath, project: projectPath }
}

/**
 * Creates the default configuration file with helpful comments
 */
function createDefaultConfig(): void {
    // Ensure the directory exists
    if (!existsSync(GLOBAL_CONFIG_DIR)) {
        mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true })
    }

    const configContent = `{
  // Enable or disable the Smart Title plugin
  "enabled": true,

  // Enable debug logging to ~/.config/opencode/logs/smart-title/YYYY-MM-DD.log
  "debug": false,

  // Optional: Specify a model to use for title generation
  // Format: "provider/model" (same as agent model config in opencode.jsonc)
  // If not specified, will use intelligent fallbacks from authenticated providers
  // Examples: "anthropic/claude-haiku-4-5", "openai/gpt-5-mini"
  // "model": "anthropic/claude-haiku-4-5",

  // Optional: Custom prompt for title generation
  // If not specified, uses the built-in English prompt
  // "prompt": "你是一个标题生成器。分析对话内容，生成一个简短的中文标题。",

  // Update title every N idle events (default: 1)
  "updateThreshold": 1,

  // Optional: Directories to exclude from title generation
  // Sessions in these directories will not get automatic titles
  // Uses prefix matching (e.g. "/home/ubuntu/.heartbeat" matches any subdirectory)
  // "excludeDirectories": ["/home/ubuntu/.heartbeat"]
}
`

    writeFileSync(GLOBAL_CONFIG_PATH_JSONC, configContent, 'utf-8')
}

/**
 * Loads a single config file and parses it
 */
function loadConfigFile(configPath: string): Partial<PluginConfig> | null {
    try {
        const fileContent = readFileSync(configPath, 'utf-8')
        return parse(fileContent) as Partial<PluginConfig>
    } catch {
        return null
    }
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback
}

function normalizeOptionalString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined
    }

    const normalized = value.trim()
    return normalized.length > 0 ? normalized : undefined
}

function normalizePositiveInt(value: unknown, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback
    }

    const normalized = Math.floor(value)
    return normalized > 0 ? normalized : fallback
}

function normalizeExcludeDirectories(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) {
        return undefined
    }

    return value
        .filter((entry): entry is string => typeof entry === 'string')
        .map(entry => {
            const trimmed = entry.trim()
            if (trimmed === '/') {
                return '/'
            }
            return trimmed.replace(/\/+$/, '')
        })
        .filter(entry => entry.length > 0)
}

function mergeConfig(base: PluginConfig, overlay: Partial<PluginConfig>): PluginConfig {
    const model = normalizeOptionalString(overlay.model)
    const prompt = normalizeOptionalString(overlay.prompt)
    const excludeDirectories = normalizeExcludeDirectories(overlay.excludeDirectories)

    return {
        enabled: normalizeBoolean(overlay.enabled, base.enabled),
        debug: normalizeBoolean(overlay.debug, base.debug),
        model: model ?? base.model,
        prompt: prompt ?? base.prompt,
        updateThreshold: normalizePositiveInt(overlay.updateThreshold, base.updateThreshold),
        excludeDirectories: excludeDirectories ?? base.excludeDirectories
    }
}

/**
 * Loads configuration with support for both global and project-level configs
 * 
 * Config resolution order:
 * 1. Start with default config
 * 2. Merge with global config (~/.config/opencode/smart-title.jsonc)
 * 3. Merge with project config (.opencode/smart-title.jsonc) if found
 * 
 * Project config overrides global config, which overrides defaults.
 * 
 * @param ctx - Plugin input context (optional). If provided, will search for project-level config.
 * @returns Merged configuration
 */
export function getConfig(ctx?: PluginInput): PluginConfig {
    let config = { ...defaultConfig }
    const configPaths = getConfigPaths(ctx)

    if (configPaths.global) {
        const globalConfig = loadConfigFile(configPaths.global)
        if (globalConfig) {
            config = mergeConfig(config, globalConfig)
        }
    } else {
        createDefaultConfig()
    }

    if (configPaths.project) {
        const projectConfig = loadConfigFile(configPaths.project)
        if (projectConfig) {
            config = mergeConfig(config, projectConfig)
        }
    }

    return config
}
