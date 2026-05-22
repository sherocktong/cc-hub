export const POWERSHELL_COMPLETION = `Register-ArgumentCompleter -Native -CommandName cc-hub -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)

  $commands = @(
    'profile:Manage Claude CLI profiles'
    'use:Set a profile as the default'
    'run:Launch Claude Code using the default or a specified profile'
    'hook:Manage Claude Code hooks in settings.json'
    'session:Manage Claude Code sessions'
    'provider:Manage provider types'
    'cache:Manage Claude Code cache and backup files'
    'completion:Print shell completion functions'
    'help:Display help for a command'
  )

  $profileSubcmds = @('add', 'update', 'list', 'view', 'remove', 'rename', 'default', 'sync', 'export')
  $hookSubcmds = @('list', 'add', 'remove', 'enable', 'disable')
  $sessionSubcmds = @('list', 'show', 'search', 'ps', 'stats', 'clean', 'troubleshoot')
  $cacheSubcmds = @('restore')
  $providerSubcmds = @('list')

  $tokens = $commandAst.CommandElements | ForEach-Object { $_.ToString() }

  if ($tokens.Count -eq 1 -or ($tokens.Count -eq 2 -and $wordToComplete -ne '')) {
    $commands | ForEach-Object { if ($_ -like "$wordToComplete*") { $_ } }
    return
  }

  $cmd = $tokens[1]

  switch ($cmd) {
    'profile' {
      if ($tokens.Count -eq 2 -or ($tokens.Count -eq 3 -and $wordToComplete -ne '')) {
        $profileSubcmds | ForEach-Object { if ($_ -like "$wordToComplete*") { $_ } }
        return
      }
      if ($tokens[2] -eq 'default' -and $tokens.Count -ge 3) {
        $opts = @('--built-in')
        $opts | ForEach-Object { if ($_ -like "$wordToComplete*") { $_ } }
      }
    }
    'hook' {
      if ($tokens.Count -eq 2 -or ($tokens.Count -eq 3 -and $wordToComplete -ne '')) {
        $hookSubcmds | ForEach-Object { if ($_ -like "$wordToComplete*") { $_ } }
        return
      }
    }
    'session' {
      if ($tokens.Count -eq 2 -or ($tokens.Count -eq 3 -and $wordToComplete -ne '')) {
        $sessionSubcmds | ForEach-Object { if ($_ -like "$wordToComplete*") { $_ } }
        return
      }
    }
    'provider' {
      if ($tokens.Count -eq 2 -or ($tokens.Count -eq 3 -and $wordToComplete -ne '')) {
        $providerSubcmds | ForEach-Object { if ($_ -like "$wordToComplete*") { $_ } }
        return
      }
    }
    'cache' {
      if ($tokens.Count -eq 2 -or ($tokens.Count -eq 3 -and $wordToComplete -ne '')) {
        $cacheSubcmds | ForEach-Object { if ($_ -like "$wordToComplete*") { $_ } }
        return
      }
    }
    'use' {
      $opts = @('--built-in')
      $opts | ForEach-Object { if ($_ -like "$wordToComplete*") { $_ } }
      return
    }
    'run' {
      $opts = @('--built-in')
      $opts | ForEach-Object { if ($_ -like "$wordToComplete*") { $_ } }
      return
    }
  }
}`;
