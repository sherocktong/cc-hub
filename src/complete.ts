import { Command } from "commander";

const ZSH_COMPLETION = `#compdef cc-hub

_cc-hub() {
  local -a commands
  commands=(
    'profile:Manage Claude CLI profiles'
    'use:Launch Claude Code with a saved profile'
    'run:Launch Claude Code using the default or a specified profile'
    'hook:Manage Claude Code hooks in settings.json'
    'session:Manage Claude Code sessions'
    'complete:Print shell completion functions'
    'help:Display help for a command'
  )

  local -a profile_subcmds
  profile_subcmds=(
    'add:Add or update a profile'
    'update:Update fields of an existing profile'
    'remove-model:Remove specific models from a profile'
    'list:List all profiles'
    'view:View full details of a profile'
    'remove:Remove a profile'
    'default:Set the default profile'
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
  )

  _cc_hub_profiles() {
    local profiles_file="\${CLAUDE_PROFILES_FILE:-\$HOME/.claude/profiles.json}"
    if [[ -f "$profiles_file" ]]; then
      local -a names
      names=(\${(f)"$(command python3 -c "
import json
data = json.load(open('$profiles_file'))
for name in data.get('profiles', {}):
    print(name)
" 2>/dev/null)"})
      _describe -t profiles 'profile' names
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
          elif [[ $words[2] == "view" || $words[2] == "remove" || $words[2] == "default" || $words[2] == "update" || $words[2] == "remove-model" ]]; then
            _cc_hub_profiles
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

const BASH_COMPLETION = `_cc-hub_profiles() {
  local profiles_file="\${CLAUDE_PROFILES_FILE:-\$HOME/.claude/profiles.json}"
  if [[ -f "$profiles_file" ]]; then
    local names
    names=$(command python3 -c "
import json
data = json.load(open('$profiles_file'))
for name in data.get('profiles', {}):
    print(name)
" 2>/dev/null)
    COMPREPLY=($(compgen -W "$names" -- "\${cur}"))
  fi
}

_cc-hub() {
  local cur prev commands
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  commands="profile use run hook session complete help"

  local profile_subcmds="add update remove-model list view remove default"
  local hooks_subcmds="list add remove enable disable"
  local session_subcmds="list show search ps stats clean"

  # Top-level command
  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=($(compgen -W "$commands" -- "$cur"))
    return 0
  fi

  local cmd="\${COMP_WORDS[1]}"

  case "$cmd" in
    profile)
      if [[ \${COMP_CWORD} -eq 2 ]]; then
        COMPREPLY=($(compgen -W "$profile_subcmds" -- "$cur"))
      elif [[ "$prev" == "view" || "$prev" == "remove" || "$prev" == "default" || "$prev" == "update" || "$prev" == "remove-model" ]]; then
        _cc-hub_profiles
      elif [[ "$prev" == "profile" ]]; then
        COMPREPLY=($(compgen -W "$profile_subcmds" -- "$cur"))
      fi
      ;;
    use|run)
      _cc-hub_profiles
      ;;
    hook)
      if [[ \${COMP_CWORD} -eq 2 ]]; then
        COMPREPLY=($(compgen -W "$hooks_subcmds" -- "$cur"))
      fi
      ;;
    session)
      if [[ \${COMP_CWORD} -eq 2 ]]; then
        COMPREPLY=($(compgen -W "$session_subcmds" -- "$cur"))
      fi
      ;;
  esac

  return 0
}

complete -F _cc-hub cc-hub
`;

export function completeCommand(): Command {
  return new Command("complete")
    .description("Print shell completion script")
    .argument("<shell>", "Shell type: bash or zsh")
    .action((shell: string) => {
      switch (shell) {
        case "zsh":
          process.stdout.write(ZSH_COMPLETION);
          break;
        case "bash":
          process.stdout.write(BASH_COMPLETION);
          break;
        default:
          console.error(`Unsupported shell: ${shell}. Use 'bash' or 'zsh'.`);
          process.exit(1);
      }
    });
}
