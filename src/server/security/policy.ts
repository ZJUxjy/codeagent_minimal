import * as path from "path"

/** Permission levels for tool execution */
export type PermissionLevel = "allow" | "ask" | "deny"

/** Tool policy configuration */
export interface ToolPolicy {
  toolName: string
  permission: PermissionLevel
}

interface BuiltinRule {
  pattern: RegExp
  level: PermissionLevel
  reason: string
}

/** Structured rules for bash command analysis (evaluated in order — first match wins) */
const BASH_RULES: BuiltinRule[] = [
  // Hard deny: catastrophic / unrecoverable
  { pattern: /\brm\s+(-rf?|--recursive)\s+(\/|~\b|\$HOME\b)/, level: "deny", reason: "destructive: deletes root or home directory" },
  { pattern: /\beval\b/,                                        level: "deny", reason: "arbitrary code execution" },
  { pattern: /\b(curl|wget)\b[^|#\n]*\|\s*(ba)?sh\b/,          level: "deny", reason: "pipe-to-shell: remote code execution" },

  // Ask: irreversible, sensitive, or system-affecting
  { pattern: /\brm\s+-/,                                        level: "ask",  reason: "recursive or force delete" },
  { pattern: /\bsudo\b/,                                        level: "ask",  reason: "privilege escalation" },
  { pattern: /^(env|printenv)(\s|$)/,                           level: "ask",  reason: "may expose secrets via environment" },
  { pattern: /\becho\s+\$/,                                     level: "ask",  reason: "may expose secrets via env vars" },
  { pattern: /\bcat\b.*[~\/]\.ssh\//,                           level: "ask",  reason: "reading SSH keys" },
  { pattern: /\bcat\b.*\.(env|secret|secrets|key|pem|crt|pfx)\b/, level: "ask", reason: "reading sensitive files" },
  { pattern: /\bgit\s+push\s+(--force|-f)\b/,                   level: "ask",  reason: "force push" },
  { pattern: /\bgit\s+(reset\s+--hard|clean\s+-[fdx])/,         level: "ask",  reason: "destructive git operation" },
  { pattern: /\bchmod\s+777\b/,                                 level: "ask",  reason: "world-writable permissions" },
  { pattern: /\b(npm|yarn|pnpm)\s+install\b/,                   level: "ask",  reason: "package installation" },
  { pattern: /\b(pip|pip3)\s+install\b/,                        level: "ask",  reason: "package installation" },
  { pattern: /\b(apt|apt-get|apk|yum|dnf|pacman|zypper)\s+(install|remove|purge|update)\b/, level: "ask", reason: "system package manager" },
  { pattern: /\b(shutdown|reboot|poweroff|halt)\b/,             level: "ask",  reason: "system power operation" },
  { pattern: /\bdd\b.*\bif=/,                                   level: "ask",  reason: "disk-level operation" },
]

const SENSITIVE_PATH_RE = /\/(\.ssh|\.gnupg|etc\/passwd|etc\/shadow|etc\/sudoers)(\/|$)/i

/**
 * Evaluate permission for a tool call.
 * @param cwd - Working directory for path resolution (write/edit tools)
 */
export function evaluateToolPolicy(
  toolName: string,
  args: Record<string, unknown>,
  cwd?: string,
): PermissionLevel {
  if (toolName === "bash") {
    const command = String(args.command ?? "")
    for (const rule of BASH_RULES) {
      if (rule.pattern.test(command)) return rule.level
    }
    return "allow"
  }

  if (toolName === "write" || toolName === "edit") {
    const filePath = String(args.file_path ?? "")
    if (!filePath) return "allow"

    // Deny writes to sensitive system paths regardless of cwd
    if (SENSITIVE_PATH_RE.test(filePath.replace(/\\/g, "/"))) return "deny"
    // Deny .git/config modifications
    if (/[/\\]\.git[/\\]config$/.test(filePath)) return "deny"

    // Path traversal check: resolve against cwd and see if it escapes
    const base = cwd ? path.resolve(cwd) : null
    if (base) {
      const resolved = path.resolve(base, filePath)
      if (!resolved.startsWith(base + path.sep) && resolved !== base) {
        return "ask"
      }
    } else {
      // Fallback when cwd unknown
      if (filePath.startsWith("..") || path.isAbsolute(filePath)) return "ask"
    }
  }

  return "allow"
}
