export const ZSH_COMPLETION = `#compdef cc-hub

_cc-hub() {
  local -a commands
  commands=(
    'profile:Manage Claude CLI profiles'
    'use:Launch Claude Code with a saved profile'
    'run:Launch Claude Code using the default or a specified profile'
    'hook:Manage Claude Code hooks in settings.json'
    'session:Manage Claude Code sessions'
    'provider:Manage provider types'
    'completion:Print shell completion functions'
    'help:Display help for a command'
  )

  local -a provider_subcmds
  provider_subcmds=(
    'list:List available provider types'
  )


  local -a profile_subcmds
  profile_subcmds=(
    'add:Add or update a profile'
    'update:Update fields of an existing profile'
    'list:List all profiles'
    'view:View full details of a profile'
    'remove:Remove a profile'
    'rename:Rename a profile'
    'default:Set the default profile'
    'sync:Synchronize all CLI profiles to the desktop app'
  )

  local -a hooks_subcmds
  hooks_subcmds=(
    'list:List all hooks'
    'add:Add a hook to settings.json'
    'remove:Remove a hook by its global index'
    'enable:Enable one or more disabled hooks'
    'disable:Disable one or more hooks'
  )

  local -a session_subcmds
  session_subcmds=(
    'list:List all Claude Code project sessions'
    'show:Show session files for a project'
    'search:Search conversation history across all projects'
    'ps:Show active Claude Code processes'
    'stats:Show summary statistics'
    'clean:Delete session JSONL files older than N days'
    'troubleshoot:Launch Claude Code to troubleshoot a session file'
  )

  _cc_hub_profiles() {
    local profiles_file="\${CLAUDE_PROFILES_FILE:-\$HOME/.claude/profiles.json}"
    if [[ -f "$profiles_file" ]]; then
      local -a names
      names=(\${(f)"$(command jq -r '.profiles | keys[]' "$profiles_file" 2>/dev/null)"})
      _describe -t profiles 'profile' names
    fi
  }

  _cc_hub_models_for_profile() {
    local profile_name="$1"
    local profiles_file="\${CLAUDE_PROFILES_FILE:-\$HOME/.claude/profiles.json}"
    if [[ -f "$profiles_file" && -n "$profile_name" ]]; then
      local -a models
      models=(\${(f)"$(command jq -r --arg p "$profile_name" '(.profiles[$p].models // [ .profiles[$p].model ] )[]? // empty' "$profiles_file" 2>/dev/null)"})
      _describe -t models 'model' models
    fi
  }

  _arguments -C \\
    '1: :->command' \\
    '*::arg:->args'

  case $state in
    command)
      _describe -t commands 'cc-hub command' commands
      ;;
    args)
      case $words[1] in
        profile)
          if (( CURRENT == 2 )); then
            _describe -t profile-subcmds 'profile subcommand' profile_subcmds
          elif [[ $words[2] == "view" || $words[2] == "remove" || $words[2] == "default" ]]; then
            _cc_hub_profiles
          elif [[ $words[2] == "rename" ]]; then
            if (( CURRENT == 3 )); then
              _cc_hub_profiles
            fi
          elif [[ $words[2] == "update" ]]; then
            if (( CURRENT == 3 )); then
              _cc_hub_profiles
            else
              words=("stub" $words[3,-1])
              (( CURRENT-- ))
              _arguments -C -S \\
                '1:profile:_cc_hub_profiles' \\
                '(-m --model)*'{-m,--model}'[Model ID]:model:->profileModel' \\
                '(-d --delete-model)*'{-d,--delete-model}'[Remove model ID]:model:->profileModel' \\
                '(-t --token)'{-t,--token}'[API key / token]:token:' \\
                '(-u --url)'{-u,--url}'[Base URL]:url:' \\
                '(-p --provider)'{-p,--provider}'[Provider type]:provider:(anthropic openai)'
              case $state in
                profileModel)
                  _cc_hub_models_for_profile $line[1]
                  ;;
              esac
            fi
          fi
          ;;
        provider)
          if (( CURRENT == 2 )); then
            _describe -t provider-subcmds 'provider subcommand' provider_subcmds
          fi
          ;;
        use|run)
          _cc_hub_profiles
          ;;
        hook)
          if (( CURRENT == 2 )); then
            _describe -t hooks-subcmds 'hook subcommand' hooks_subcmds
          fi
          ;;
        session)
          if (( CURRENT == 2 )); then
            _describe -t session-subcmds 'session subcommand' session_subcmds
          fi
          ;;
      esac
      ;;
  esac
}

compdef _cc-hub cc-hub
`;
