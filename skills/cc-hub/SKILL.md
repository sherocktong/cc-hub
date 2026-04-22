# cc-hub skill

Manage cc-hub profiles and models via natural language commands. This skill reads and writes `~/.claude/profiles.json` directly to update model configurations.

## Trigger

Invoke this skill when the user asks to:
- Add models to a cc-hub profile
- Remove models from a cc-hub profile
- List models in a profile
- Set/update the default model for a profile
- View profile details
- Any natural language request involving cc-hub profiles and models

## Profile File Location

`~/.claude/profiles.json`

## Capabilities

### 1. Add models to a profile

**Example requests:**
- "Add kimi-k2.5 and gpt-4 to my hy profile"
- "Add claude-opus-4-7 to the flow profile"
- "Add model X to profile Y"

**Behavior:**
1. Read `~/.claude/profiles.json`
2. Find the specified profile
3. Add the new models to the `models` array (or create it if not exists)
4. Update `model` field to the first model in the list
5. Write back the updated JSON
6. Confirm the changes to the user

### 2. Remove models from a profile

**Example requests:**
- "Remove kimi-k2.5 from my hy profile"
- "Delete gpt-4 from the flow profile"
- "Remove models X and Y from profile Z"

**Behavior:**
1. Read `~/.claude/profiles.json`
2. Find the specified profile
3. Remove the specified models from the `models` array
4. Update `model` field to the new first model (or remove if empty)
5. Write back the updated JSON
6. Confirm the changes to the user

### 3. List models in a profile

**Example requests:**
- "What models are in my hy profile?"
- "List models for the flow profile"
- "Show me the models in profile X"

**Behavior:**
1. Read `~/.claude/profiles.json`
2. Display the `models` array or `model` field for the specified profile

### 4. Set default model

**Example requests:**
- "Set the default model for hy to kimi-k2.5"
- "Make gpt-4 the first model in my flow profile"
- "Change the primary model of profile X to Y"

**Behavior:**
1. Read `~/.claude/profiles.json`
2. Reorder the `models` array so the specified model is first
3. Update `model` field to match
4. Write back the updated JSON

## Profile JSON Structure

```json
{
  "profiles": {
    "profilename": {
      "model": "primary-model-id",
      "models": ["model1", "model2", "model3"],
      "token": "api-token",
      "url": "https://api.example.com"
    }
  },
  "default": "profilename"
}
```

## Implementation Notes

- Always validate JSON before writing
- Preserve all existing profile fields (token, url, etc.)
- Handle edge cases: profile doesn't exist, model not found, etc.
- Provide clear success/error messages
- When adding models, avoid duplicates
- When removing models, handle the case where all models are removed
