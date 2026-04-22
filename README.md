# cc-hub

Manage Claude CLI profiles, hooks, and sessions — one tool, all in one place.

## Install

```bash
npm install -g cc-hub-cli
```

## Quick Start

```bash
# Add a profile with single model
cc-hub profile add flow -m anthropic.claude-4-6-sonnet -t eyJ... -u https://example.com/api

# Add a profile with multiple models
cc-hub profile add multi -m kimi-k2.5 -m claude-sonnet-4-6 -m gpt-4 -t eyJ... -u https://api.example.com

# Set as default
cc-hub profile default flow

# Launch Claude Code with it
cc-hub run

# Or launch with a specific profile
cc-hub run flow
```

## Commands

### Profiles

Manage multiple Claude API configurations (model, token, URL).

```bash
cc-hub profile add <name> -m <model> -t <token> -u <url>   # Add or update
cc-hub profile add <name> -m <m1> -m <m2> -t <token>       # Add with multiple models
cc-hub profile update <name> -m <model>                      # Update fields
cc-hub profile update <name> -m <m1> -m <m2>                 # Update with multiple models
cc-hub profile remove-model <name> -m <model>                # Remove specific models
cc-hub profile list                                          # List all (tokens masked)
cc-hub profile view <name>                                   # View details (token visible)
cc-hub profile view <name> -j                                # View as JSON
cc-hub profile remove <name>                                 # Remove
cc-hub profile default <name>                                # Set default
```

**Multi-Model Profiles:**

You can specify multiple models per profile using the `-m` flag multiple times:

```bash
# Add a profile with multiple models
cc-hub profile add myprofile -m kimi-k2.5 -m claude-sonnet-4-6 -t <token> -u <url>

# Remove specific models
cc-hub profile remove-model myprofile -m kimi-k2.5
```

When you launch Claude Code with `cc-hub run`, the models are automatically populated into Claude Code's `/model` picker via the `availableModels` setting in `~/.claude/settings.json`. The first model is used as the default.

**Non-Anthropic Models:**

If your profile includes non-Anthropic models (e.g., `kimi-k2.5`, `gpt-4`), the first such model is also exposed via the `ANTHROPIC_CUSTOM_MODEL_OPTION` environment variable, which adds it as a named entry in the `/model` picker.

### Run / Use

Launch Claude Code with a profile's credentials injected as environment variables.

```bash
# Set a profile as default
cc-hub use <name>

# Launch using the default profile
cc-hub run [extra args...]

# Launch with a specific profile
cc-hub run <name> [extra args...]
```

`run` execs into the `claude` CLI with `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, and `--model` set from the profile.

### Hook

Manage Claude Code hooks in `~/.claude/settings.json`.

```bash
cc-hub hook list                                              # List all hooks
cc-hub hook add -e <event> -c <command> [-m <matcher>] [-a]  # Add a hook
cc-hub hook remove -i <index>                                 # Remove by index
cc-hub hook enable -i <index> [-i <index>]                    # Enable disabled hooks
cc-hub hook disable -i <index> [-i <index>]                   # Disable active hooks
```

**Events:** `PreToolUse`, `PostToolUse`, `Notification`, `Stop`, `UserPromptSubmit`, `PermissionRequest`

**Examples:**

```bash
# Desktop notification when Claude finishes
cc-hub hook add -e Stop -c 'osascript -e "display notification \"Done\""'

# Hook only for Bash tool usage
cc-hub hook add -e PreToolUse -m Bash -c 'echo "Running bash..."'

# Async hook
cc-hub hook add -e PostToolUse -c 'my-logger.sh' -a
```

Disabled hooks are kept in a pool and can be re-enabled later with `hook enable`.

### Session

Browse and search Claude Code session history from `~/.claude/projects/`.

```bash
cc-hub session list [-n <limit>] [-s] [-j]                   # List projects
cc-hub session show <project> [-v]                            # Show sessions for a project
cc-hub session search <query> [-p <project>] [-n <n>] [-i]   # Search conversation history
cc-hub session ps                                             # Show active processes
cc-hub session stats                                          # Summary statistics
cc-hub session clean [-d <days>] [--dry-run]                  # Delete old sessions
```

**Examples:**

```bash
# List recent projects
cc-hub session list -n 10

# Show sessions with first message preview
cc-hub session show cc-hub -v

# Case-insensitive search
cc-hub session search "authentication" -i

# Preview what would be cleaned up
cc-hub session clean -d 60 --dry-run
```

### Shell Completion

```bash
# zsh — add to ~/.zshrc
eval "$(cc-hub complete zsh)"

# bash — add to ~/.bashrc
eval "$(cc-hub complete bash)"
```

Completes subcommands, profile names, and event types.

## Configuration

cc-hub reads from these paths (overridable via environment variables):

| File | Default | Env Override |
|---|---|---|
| Profiles | `~/.claude/profiles.json` | `CLAUDE_PROFILES_FILE` |
| Settings | `~/.claude/settings.json` | `CLAUDE_SETTINGS_FILE` |
| Claude dir | `~/.claude` | `CLAUDE_DIR` |

### Profile storage format

Single-model profile:

```json
{
  "profiles": {
    "flow": {
      "model": "anthropic.claude-4-6-sonnet",
      "token": "eyJ...",
      "url": "https://example.com/api"
    }
  },
  "default": "flow"
}
```

Multi-model profile:

```json
{
  "profiles": {
    "multi": {
      "model": "kimi-k2.5",
      "models": ["kimi-k2.5", "claude-sonnet-4-6", "gpt-4"],
      "token": "eyJ...",
      "url": "https://api.example.com"
    }
  },
  "default": "multi"
}
```

When launching with a multi-model profile, cc-hub automatically configures Claude Code's `availableModels` setting, populating the `/model` picker with all specified models.

## Claude Code Skill

cc-hub includes a Claude Code skill for natural language profile management. The skill is located at `skills/cc-hub/SKILL.md`.

**Capabilities:**
- Add/remove models from profiles using natural language
- List models in a profile
- Set the default model for a profile

**Examples:**

```
Add kimi-k2.5 and gpt-4 to my hy profile
Remove claude-sonnet from the flow profile
What models are in my hy profile?
Set the default model for hy to gpt-4
```

The skill directly reads and writes `~/.claude/profiles.json` to make changes.

## License

MIT
