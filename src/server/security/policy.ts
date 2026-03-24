/** Permission levels for tool execution */
export type PermissionLevel = "allow" | "ask" | "deny"

/** Tool policy configuration */
export interface ToolPolicy {
  toolName: string
  permission: PermissionLevel
  patterns?: string[]  // e.g., dangerous commands for bash
}

/** List of dangerous bash commands */
export const DANGEROUS_BASH_COMMANDS = [
  // File system destruction
  "rm", "rmdir", "shred",
  // Disk operations
  "dd", "mkfs", "fdisk", "parted", "format",
  // System power
  "shutdown", "reboot", "poweroff", "halt",
  // Permission changes
  "chmod", "chown", "chgrp",
  // Network operations (potentially dangerous)
  "curl", "wget", "nc", "netcat",
  // Code execution
  "eval", "exec", "source",
  // Package managers (potentially install malicious packages)
  "npm", "yarn", "pnpm", "pip", "pip3",
  "apt-get", "apt", "apk", "yum", "dnf", "pacman", "zypper",
  // Git force operations
  "git push --force", "git push -f", "git reset --hard",
]

/**
 * Evaluate tool policy for a given tool call
 * @param toolName - Name of the tool being executed
 * @param args - Arguments passed to the tool
 * @param policies - Additional explicit policies
 * @returns Permission level
 */
export function evaluateToolPolicy(
  toolName: string,
  args: Record<string, unknown>,
  policies: ToolPolicy[] = []
): PermissionLevel {
  // First check explicit policies
  const policy = policies.find(p => p.toolName === toolName)
  if (policy) return policy.permission

  // Default: ask for dangerous bash commands
  if (toolName === "bash") {
    const commandStr = String(args.command || "")
    // Extract base command (first word, handling sudo)
    const parts = commandStr.split(/\s+/)
    const baseCommand = parts[0] === "sudo" ? parts[1] : parts[0]

    // Check dangerous command list
    if (DANGEROUS_BASH_COMMANDS.some(cmd => baseCommand === cmd || commandStr.includes(cmd))) {
      return "ask"
    }
  }

  // Ask for write/edit operations outside cwd
  if (toolName === "write" || toolName === "edit") {
    const filePath = String(args.file_path || "")
    if (filePath.startsWith("..") || filePath.startsWith("/")) {
      return "ask"
    }
  }

  return "allow"
}
