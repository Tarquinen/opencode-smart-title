# Smart Title Plugin (Fork)

This plugin auto-generates meaningful OpenCode session titles from your conversation.

## Fork Notice

This repository is a fork of:

- Upstream: `Tarquinen/opencode-smart-title`
- Fork: `the3asic/opencode-smart-title`

The npm package for this fork is:

- `@the3asic/opencode-smart-title`

## What This Fork Adds

Compared to upstream, this fork adds:

- **Custom prompt support** via config (`prompt`)
- **Directory exclusion** (`excludeDirectories`) so specific paths are ignored
- **Config model fallback flow** with better provider/model selection behavior
- **Subagent skip logic** (does not rename subagent sessions)
- **Smarter context extraction** (keeps full user message + first/last assistant reply per turn)
- **Improved logging and error output** for debugging and operations

## How It Works

1. Plugin listens for OpenCode `session.status` events.
2. When status becomes `idle`, it checks gates:
   - plugin enabled
   - not a subagent session
   - current directory not excluded
   - `updateThreshold` reached
3. It loads recent conversation context and builds a compact prompt payload.
4. It picks a model:
   - use configured `model` first (if set)
   - fallback to authenticated providers in priority order
5. It generates a short title and updates the current session title.

## Installation

```bash
npm install @the3asic/opencode-smart-title
```

Add to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["@the3asic/opencode-smart-title"]
}
```

## Configuration

The plugin supports global and project-level config:

- Global: `~/.config/opencode/smart-title.jsonc`
- Project: `.opencode/smart-title.jsonc` (overrides global)

The plugin auto-creates a default global config on first run.

```jsonc
{
  "enabled": true,
  "debug": false,
  // Optional, for example: "opencode/gpt-5-nano"
  // "model": "anthropic/claude-haiku-4-5",
  // Optional custom generation prompt
  // "prompt": "Generate very short technical titles...",
  "updateThreshold": 1,
  // Optional directory blacklist
  // "excludeDirectories": ["/home/ubuntu/.heartbeat"]
}
```

## Local Development (Optional)

If you are actively developing this plugin, you can load local build output directly:

```json
{
  "plugin": [
    "file:///absolute/path/to/opencode-smart-title/dist/index.js"
  ]
}
```

Use package install for daily usage across machines, and local file mode only for development/debugging.

## License

MIT
