# Smart Title Plugin

Auto-generates meaningful session titles for your OpenCode conversations using AI.

## What It Does

- Watches your conversation and generates short, descriptive titles
- Updates automatically when the session becomes idle (you stop typing)
- Uses OpenCode's unified auth - no API keys needed
- Works with any authenticated AI provider

## Installation

```bash
npm install @tarquinen/opencode-smart-title
```

Add to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["@tarquinen/opencode-smart-title"]
}
```

## Configuration

The plugin supports both global and project-level configuration:

- **Global:** `~/.config/opencode/smart-title.jsonc` - Applies to all OpenCode sessions
- **Project:** `.opencode/smart-title.jsonc` - Applies only to the current project

Project configuration takes precedence over global configuration. The plugin creates a default global configuration file on first run.

```jsonc
{
  // Enable or disable the plugin
  "enabled": true,

  // Enable debug logging
  "debug": false,

  // Optional: Use a specific model (otherwise uses smart fallbacks)
  // "model": "anthropic/claude-haiku-4-5",

  // Update title every N idle events (1 = every time you pause)
  "updateThreshold": 1
}
```

### Configuration Hierarchy

1. **Defaults** - Built-in plugin defaults
2. **Global config** (`~/.config/opencode/smart-title.jsonc`) - Overrides defaults
3. **Project config** (`.opencode/smart-title.jsonc`) - Overrides global config

This allows you to:
- Set global defaults for all projects
- Override settings per-project (e.g., disable for certain projects, use different models)
- Commit project config to version control for team consistency

### Creating Project-Level Config

To create a project-specific configuration:

1. Create `.opencode` directory in your project root (if it doesn't exist)
2. Create `smart-title.jsonc` file inside `.opencode/`
3. Add your project-specific settings

```bash
# In your project directory
mkdir -p .opencode
cat > .opencode/smart-title.jsonc << 'EOF'
{
  // Project-specific Smart Title settings
  "updateThreshold": 3,
  "model": "openai/gpt-5-mini"
}
EOF
```

The global config (`~/.config/opencode/smart-title.jsonc`) is automatically created on first run. Project configs are opt-in and must be created manually.

## How It Works

**Trigger:** Updates when session goes idle (you stop typing)

**Model Selection:**
1. Try configured model (if specified)
2. Try fallback models from authenticated providers in priority order:
   - openai/gpt-5-mini
   - anthropic/claude-haiku-4-5
   - google/gemini-2.5-flash
   - deepseek/deepseek-chat
   - xai/grok-4-fast
   - alibaba/qwen3-coder-flash
   - zai/glm-4.5-flash
   - opencode/big-pickle

**Update Threshold:**
- `1` = Update every idle (default)
- `2` = Update every other idle
- `3` = Update every third idle, etc.

## Troubleshooting

**Enable debug logging:**
```jsonc
{ "debug": true }
```

**View logs:**
```bash
tail -f ~/.config/opencode/logs/smart-title/$(date +%Y-%m-%d).log
```

**Plugin not working?**
- Make sure you're authenticated with at least one provider
- Check that `enabled: true` in config
- Restart OpenCode after config changes

## License

MIT
