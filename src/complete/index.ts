import { Command } from "commander";
import { ZSH_COMPLETION } from "./zsh.js";
import { BASH_COMPLETION } from "./bash.js";
import { POWERSHELL_COMPLETION } from "./powershell.js";

export function completeCommand(): Command {
  return new Command("complete")
    .description("Print shell completion script")
    .argument("<shell>", "Shell type: bash, zsh, or powershell")
    .action((shell: string) => {
      switch (shell) {
        case "zsh":
          process.stdout.write(ZSH_COMPLETION);
          break;
        case "bash":
          process.stdout.write(BASH_COMPLETION);
          break;
        case "powershell":
          process.stdout.write(POWERSHELL_COMPLETION);
          break;
        default:
          console.error(`Unsupported shell: ${shell}. Use 'bash', 'zsh', or 'powershell'.`);
          process.exit(1);
      }
    });
}
