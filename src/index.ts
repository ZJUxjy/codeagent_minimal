import { startTUI } from './tui/index.js';
import { loadConfig } from './config.js';
import type { ClientOptions, TuiThemeId } from './client/index.js';
import { createLogger, Logger } from './utils/logger.js'
import * as fs from "fs"
import * as path from "path"

const logger = createLogger()
if (logger instanceof Logger) {
  logger.info('main', `lop_minimal starting, session: ${process.env.LOP_SESSION_ID || 'default'}`)
}

async function main() {
  // Handle `lop init` subcommand
  if (process.argv[2] === 'init') {
    const targetPath = path.resolve(process.cwd(), 'LOP.md')
    const smart = process.argv.includes('--smart')

    if (!smart) {
      // Existing template behaviour
      if (fs.existsSync(targetPath)) {
        console.log('LOP.md already exists. No changes made.')
        process.exit(0)
      }
      const template = `# Project Instructions\n\n<!-- Add project-specific instructions for the AI agent here. -->\n<!-- This file is loaded automatically from any directory in the project tree. -->\n\n## Code Style\n<!-- e.g. "Always use TypeScript strict mode." -->\n\n## Architecture\n<!-- e.g. "This is a Next.js App Router project." -->\n\n## Rules\n<!-- e.g. "Never commit secrets. Always write tests." -->\n`
      fs.writeFileSync(targetPath, template, 'utf8')
      console.log(`Created LOP.md at ${targetPath}`)
      process.exit(0)
    }

    // --smart: scan project and generate via LLM
    if (fs.existsSync(targetPath)) {
      console.log('LOP.md already exists. Remove it first or edit it manually.')
      process.exit(1)
    }

    const { runSmartInit } = await import('./commands/init/smartInit.js')
    const fileConfig = loadConfig()

    if (!fileConfig.apiKey && !process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
      console.error('Error: No API key configured. Run `lop` to set up config first.')
      process.exit(1)
    }

    const llmConfig = {
      provider: fileConfig.provider ?? 'anthropic',
      model: fileConfig.model ?? 'claude-sonnet-4-6',
      apiKey: fileConfig.apiKey,
      baseURL: fileConfig.baseURL,
    }

    console.log('Scanning project and generating LOP.md...')
    try {
      const content = await runSmartInit(process.cwd(), llmConfig as any)
      if (!content) {
        console.error('Error: LLM returned empty content.')
        process.exit(1)
      }
      fs.writeFileSync(targetPath, content + '\n', 'utf8')
      console.log(`Created LOP.md at ${targetPath}`)
    } catch (err: any) {
      console.error(`Error: ${err?.message ?? String(err)}`)
      process.exit(1)
    }
    process.exit(0)
  }

  const fileConfig = loadConfig();

  // 解析命令行参数
  const args = process.argv.slice(2);
  const cliOptions: Partial<ClientOptions> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-p' || arg === '--provider') {
      cliOptions.provider = args[++i];
    } else if (arg === '-m' || arg === '--model') {
      cliOptions.model = args[++i];
    } else if (arg === '-d' || arg === '--directory') {
      cliOptions.cwd = args[++i];
    } else if (arg === '--theme') {
      cliOptions.theme = args[++i] as TuiThemeId;
    } else if (arg === '-r' || arg === '--resume') {
      cliOptions.resume = true;
    } else if (arg === '--approval-mode') {
      const mode = args[++i];
      if (mode === 'default' || mode === 'cautious' || mode === 'auto' || mode === 'plan') {
        cliOptions.approvalMode = mode;
      }
    }
  }

  const options: ClientOptions = {
    provider: cliOptions.provider ?? fileConfig.provider,
    model: cliOptions.model ?? fileConfig.model,
    apiKey: fileConfig.apiKey,
    baseURL: fileConfig.baseURL,
    cwd: cliOptions.cwd,
    theme: cliOptions.theme,
    mcpServers: fileConfig.mcpServers,
    mcp: fileConfig.mcp,
    resume: cliOptions.resume,
    persistence: fileConfig.persistence,
    skills: fileConfig.skills,
    approvalMode: cliOptions.approvalMode ?? fileConfig.approvalMode,
  };

  // 启动 TUI
  await startTUI(options);
  // Ink's exit() unmounts the React tree but does NOT call process.exit().
  // After waitUntilExit() resolves, force exit to clean up child processes.
  process.exit(0);
}

main().catch(console.error);