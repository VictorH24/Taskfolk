const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const TASKFOLK_VERSION = require('../../package.json').version;

const ACP_PROTOCOL_VERSION = 1;
const DEFAULT_ACP_TIMEOUT_MS = 4_000;
const DEFAULT_MAX_SESSION_PAGES = 5;

function defaultCodexExecutable({ env = process.env, platform = process.platform } = {}) {
  if (env.CODEX_PATH) return env.CODEX_PATH;
  if (platform === 'darwin') {
    for (const candidate of [
      '/Applications/ChatGPT.app/Contents/Resources/codex',
      '/Applications/Codex.app/Contents/Resources/codex'
    ]) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return platform === 'win32' ? 'codex.exe' : 'codex';
}

function codexAcpLaunch() {
  const packageJsonPath = require.resolve('@agentclientprotocol/codex-acp/package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const relativeBin = typeof packageJson.bin === 'string'
    ? packageJson.bin
    : packageJson.bin?.['codex-acp'];
  if (!relativeBin) throw new Error('The Codex ACP package does not expose a codex-acp executable.');
  return {
    command: process.execPath,
    args: [path.resolve(path.dirname(packageJsonPath), relativeBin)],
    env: {
      ...process.env,
      // Electron can execute ordinary Node entry points when this flag is set.
      ELECTRON_RUN_AS_NODE: '1',
      // Discovery must never open an authentication browser on its own.
      NO_BROWSER: '1',
      // Reuse the Codex installation Taskfolk is observing. The adapter's
      // large optional bundled CLI is excluded from desktop distributions.
      CODEX_PATH: defaultCodexExecutable()
    }
  };
}

function probeAcpAgent({
  command,
  args = [],
  cwd,
  env = process.env,
  timeoutMs = DEFAULT_ACP_TIMEOUT_MS,
  maxSessionPages = DEFAULT_MAX_SESSION_PAGES,
  spawnImpl = spawn
} = {}) {
  if (!command) return Promise.reject(new Error('An ACP agent command is required.'));
  const child = spawnImpl(command, args, {
    cwd,
    env,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let nextId = 1;
  let stdoutBuffer = '';
  let stderr = '';
  let settled = false;
  let cleanupTimer = null;
  const pending = new Map();

  const close = () => {
    if (child.stdin && !child.stdin.destroyed) child.stdin.end();
    // Closing stdin lets the adapter shut down its Codex app-server child.
    // Force only the adapter if that bounded graceful shutdown gets stuck.
    cleanupTimer = setTimeout(() => {
      if (child.exitCode === null && !child.killed) child.kill();
    }, 2_500);
    cleanupTimer.unref?.();
  };

  const failPending = (error) => {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };

  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`, (error) => {
      if (!error) return;
      pending.delete(id);
      reject(error);
    });
  });

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk;
    let newline;
    while ((newline = stdoutBuffer.indexOf('\n')) >= 0) {
      const line = stdoutBuffer.slice(0, newline).trim();
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message.id === undefined || message.id === null) continue;
      const waiter = pending.get(message.id);
      if (!waiter) continue;
      pending.delete(message.id);
      if (message.error) {
        const detail = message.error.message || JSON.stringify(message.error);
        waiter.reject(new Error(`ACP ${detail}`));
      } else {
        waiter.resolve(message.result || {});
      }
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-2_048); });

  return new Promise((resolve, reject) => {
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      close();
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => {
      const suffix = stderr.trim() ? `: ${stderr.trim()}` : '';
      const error = new Error(`ACP probe timed out after ${timeoutMs}ms${suffix}`);
      failPending(error);
      finish(error);
    }, Math.max(250, Number(timeoutMs) || DEFAULT_ACP_TIMEOUT_MS));

    child.once('error', (error) => {
      failPending(error);
      finish(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(cleanupTimer);
      if (settled) return;
      const suffix = stderr.trim() ? `: ${stderr.trim()}` : '';
      const error = new Error(`ACP agent exited before discovery completed (${signal || code})${suffix}`);
      failPending(error);
      finish(error);
    });

    (async () => {
      const initialized = await request('initialize', {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: { name: 'Taskfolk', title: 'Taskfolk', version: TASKFOLK_VERSION }
      });
      const listCapability = initialized?.agentCapabilities?.sessionCapabilities?.list;
      const sessions = [];
      let cursor = null;
      let pages = 0;
      if (listCapability !== undefined && listCapability !== null) {
        do {
          const page = await request('session/list', cursor ? { cursor } : {});
          if (Array.isArray(page.sessions)) sessions.push(...page.sessions);
          cursor = typeof page.nextCursor === 'string' && page.nextCursor ? page.nextCursor : null;
          pages += 1;
        } while (cursor && pages < Math.max(1, Number(maxSessionPages) || DEFAULT_MAX_SESSION_PAGES));
      }
      finish(null, {
        protocolVersion: initialized.protocolVersion,
        agentInfo: initialized.agentInfo || null,
        agentCapabilities: initialized.agentCapabilities || {},
        authMethods: Array.isArray(initialized.authMethods) ? initialized.authMethods : [],
        sessions,
        sessionsTruncated: Boolean(cursor)
      });
    })().catch((error) => {
      failPending(error);
      finish(error);
    });
  });
}

function probeCodexAcp(options = {}) {
  const launch = codexAcpLaunch();
  return probeAcpAgent({ ...launch, ...options });
}

module.exports = {
  ACP_PROTOCOL_VERSION,
  DEFAULT_ACP_TIMEOUT_MS,
  codexAcpLaunch,
  defaultCodexExecutable,
  probeAcpAgent,
  probeCodexAcp
};
