import { startTUI } from './tui/index.js';
import { loadConfig } from './config.js';
import type { ClientOptions, TuiThemeId } from './client/index.js';
import { createLogger, Logger } from './utils/logger.js'

const logger = createLogger()
if (logger instanceof Logger) {
  logger.info('main', `lop_minimal starting, session: ${process.env.LOP_SESSION_ID || 'default'}`)
}

async function main() {
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
  };

  // 启动 TUI
  startTUI(options);
}

main().catch(console.error);