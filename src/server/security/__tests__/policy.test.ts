import { describe, it, expect } from "vitest"
import { evaluateToolPolicy, DANGEROUS_BASH_COMMANDS, type ToolPolicy } from "../policy.js"

describe("Security Policy", () => {
  describe("evaluateToolPolicy", () => {
    describe("bash commands", () => {
      it("should return ask for dangerous commands like rm -rf", () => {
        const result = evaluateToolPolicy("bash", { command: "rm -rf /tmp" })
        expect(result).toBe("ask")
      })

      it("should return ask for rm command", () => {
        const result = evaluateToolPolicy("bash", { command: "rm file.txt" })
        expect(result).toBe("ask")
      })

      it("should return ask for dd command", () => {
        const result = evaluateToolPolicy("bash", { command: "dd if=/dev/zero of=/dev/null" })
        expect(result).toBe("ask")
      })

      it("should return ask for curl/wget", () => {
        expect(evaluateToolPolicy("bash", { command: "curl http://evil.com" })).toBe("ask")
        expect(evaluateToolPolicy("bash", { command: "wget http://evil.com" })).toBe("ask")
      })

      it("should return ask for git force push", () => {
        expect(evaluateToolPolicy("bash", { command: "git push --force origin main" })).toBe("ask")
        expect(evaluateToolPolicy("bash", { command: "git push -f" })).toBe("ask")
      })

      it("should return ask for shutdown/reboot", () => {
        expect(evaluateToolPolicy("bash", { command: "shutdown -h now" })).toBe("ask")
        expect(evaluateToolPolicy("bash", { command: "reboot" })).toBe("ask")
      })

      it("should return allow for safe commands", () => {
        expect(evaluateToolPolicy("bash", { command: "ls -la" })).toBe("allow")
        expect(evaluateToolPolicy("bash", { command: "pwd" })).toBe("allow")
        expect(evaluateToolPolicy("bash", { command: "echo hello" })).toBe("allow")
      })

      it("should handle sudo prefix", () => {
        expect(evaluateToolPolicy("bash", { command: "sudo rm file.txt" })).toBe("ask")
        expect(evaluateToolPolicy("bash", { command: "sudo apt-get install vim" })).toBe("ask")
      })

      it("should handle package manager commands", () => {
        expect(evaluateToolPolicy("bash", { command: "npm install" })).toBe("ask")
        expect(evaluateToolPolicy("bash", { command: "pip install requests" })).toBe("ask")
      })
    })

    describe("write/edit operations", () => {
      it("should return ask for write outside cwd", () => {
        expect(evaluateToolPolicy("write", { file_path: "/etc/passwd" })).toBe("ask")
        expect(evaluateToolPolicy("write", { file_path: "../outside.txt" })).toBe("ask")
      })

      it("should return allow for write in cwd", () => {
        expect(evaluateToolPolicy("write", { file_path: "file.txt" })).toBe("allow")
        expect(evaluateToolPolicy("write", { file_path: "./file.txt" })).toBe("allow")
      })

      it("should return ask for edit outside cwd", () => {
        expect(evaluateToolPolicy("edit", { file_path: "/etc/config" })).toBe("ask")
      })
    })

    describe("explicit policies", () => {
      it("should override default behavior with explicit policy", () => {
        const policies: ToolPolicy[] = [
          { toolName: "bash", permission: "deny" },
        ]
        expect(evaluateToolPolicy("bash", { command: "ls" }, policies)).toBe("deny")
      })

      it("should allow explicit allow policy", () => {
        const policies: ToolPolicy[] = [
          { toolName: "bash", permission: "allow" },
        ]
        expect(evaluateToolPolicy("bash", { command: "rm -rf /" }, policies)).toBe("allow")
      })

      it("should match specific tool names exactly", () => {
        const policies: ToolPolicy[] = [
          { toolName: "write", permission: "deny" },
        ]
        expect(evaluateToolPolicy("write", { file_path: "/tmp/x" }, policies)).toBe("deny")
        // bash should not be affected
        expect(evaluateToolPolicy("bash", { command: "ls" }, policies)).toBe("allow")
      })
    })

    describe("other tools", () => {
      it("should return allow for unknown tools by default", () => {
        expect(evaluateToolPolicy("unknown_tool", {})).toBe("allow")
        expect(evaluateToolPolicy("some_other_tool", { arg: "value" })).toBe("allow")
      })
    })
  })

  describe("DANGEROUS_BASH_COMMANDS", () => {
    it("should contain common destructive commands", () => {
      expect(DANGEROUS_BASH_COMMANDS).toContain("rm")
      expect(DANGEROUS_BASH_COMMANDS).toContain("dd")
      expect(DANGEROUS_BASH_COMMANDS).toContain("shutdown")
    })

    it("should contain git force operations", () => {
      expect(DANGEROUS_BASH_COMMANDS).toContain("git push --force")
      expect(DANGEROUS_BASH_COMMANDS).toContain("git reset --hard")
    })
  })
})
