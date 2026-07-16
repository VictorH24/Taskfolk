const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');

const {
  ACTIVE_ACTIVITY_MS,
  defaultVsCodeWorkspaceStorageRoots,
  fetchVsCodeCopilotAgents,
  isVsCodeRunning,
  normalizeVsCodeCopilotGrouping,
  projectIdentity,
  workspaceDetails
} = require('../desktop/providers/vscode-copilot.cjs');

function createWorkspace(root, name, reference, entries, mtimes = {}) {
  const workspace = path.join(root, name);
  const sessions = path.join(workspace, 'chatSessions');
  fs.mkdirSync(sessions, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'workspace.json'), JSON.stringify({ folder: reference }));
  const db = new DatabaseSync(path.join(workspace, 'state.vscdb'));
  db.exec('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)');
  db.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)').run(
    'chat.ChatSessionStore.index',
    JSON.stringify({ version: 1, entries })
  );
  db.close();
  for (const [sessionId, mtimeMs] of Object.entries(mtimes)) {
    const sessionPath = path.join(sessions, `${sessionId}.jsonl`);
    fs.writeFileSync(sessionPath, '{}\n');
    fs.utimesSync(sessionPath, new Date(mtimeMs), new Date(mtimeMs));
  }
}

test('uses standard VS Code workspace storage locations', () => {
  assert.deepEqual(
    defaultVsCodeWorkspaceStorageRoots({ platform: 'darwin', env: {}, home: '/Users/test' }),
    [
      '/Users/test/Library/Application Support/Code/User/workspaceStorage',
      '/Users/test/Library/Application Support/Code - Insiders/User/workspaceStorage'
    ]
  );
  assert.deepEqual(
    defaultVsCodeWorkspaceStorageRoots({ platform: 'linux', env: { XDG_CONFIG_HOME: '/config' }, home: '/home/test' }),
    ['/config/Code/User/workspaceStorage', '/config/Code - Insiders/User/workspaceStorage']
  );
});

test('detects Visual Studio Code without matching unrelated Electron apps', async () => {
  assert.equal(await isVsCodeRunning({
    platform: 'darwin',
    run: async () => '/Applications/Visual Studio Code.app/Contents/MacOS/Code\n'
  }), true);
  assert.equal(await isVsCodeRunning({
    platform: 'darwin',
    run: async () => '/Applications/Other.app/Contents/MacOS/Electron\n'
  }), false);
  assert.equal(await isVsCodeRunning({
    platform: 'win32',
    run: async () => '"Code.exe","123","Console","1","100 K"\n'
  }), true);
});

test('keeps stable identities per VS Code workspace', () => {
  assert.deepEqual(projectIdentity('file:///workspace/one'), projectIdentity('file:///workspace/one'));
  assert.notEqual(projectIdentity('file:///workspace/one').id, projectIdentity('file:///workspace/two').id);
  assert.equal(normalizeVsCodeCopilotGrouping('unexpected'), 'project');
  assert.deepEqual(workspaceDetails('file:///Users/test/My%20Project'), {
    name: 'My Project',
    workspacePath: '/Users/test/My Project'
  });
});

test('reads only indexed Copilot session metadata and maps recent activity', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claw-vscode-copilot-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const nowMs = Date.now();
  createWorkspace(root, 'workspace-a', 'file:///work/alpha', {
    empty: { sessionId: 'empty', title: 'New Chat', lastMessageDate: nowMs, isEmpty: true },
    active: { sessionId: 'active', title: 'Build the feature', lastMessageDate: nowMs - 60_000, isEmpty: false }
  }, { active: nowMs - ACTIVE_ACTIVITY_MS + 1_000 });
  createWorkspace(root, 'workspace-b', 'file:///work/beta', {
    idle: { sessionId: 'idle', title: 'Review tests', lastMessageDate: nowMs - 120_000, isEmpty: false }
  }, { idle: nowMs - 120_000 });

  const agents = await fetchVsCodeCopilotAgents({
    workspaceStorageRoots: [root],
    processRunning: true,
    now: () => nowMs
  });
  assert.equal(agents.length, 2);
  assert.equal(agents[0].name, 'Copilot · alpha');
  assert.equal(agents[0].status, 'active');
  assert.equal(agents[0].task, 'Build the feature');
  assert.equal(agents[0].source, 'vscode-copilot');
  assert.equal(agents[1].status, 'idle');
  assert.equal(agents[1].displayState, 'Idle');
  assert.equal(agents[1].pose, null);
  assert.equal(agents.some((agent) => agent.activity.sessionKeyShort === 'empty'), false);
});

test('can represent all VS Code projects with one Copilot agent', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claw-vscode-copilot-single-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const nowMs = Date.now();
  createWorkspace(root, 'workspace', 'file:///work/alpha', {
    session: { sessionId: 'session', title: 'Latest task', lastMessageDate: nowMs, isEmpty: false }
  });
  const agents = await fetchVsCodeCopilotAgents({
    workspaceStorageRoots: [root],
    processRunning: true,
    grouping: 'single',
    now: () => nowMs
  });
  assert.equal(agents.length, 1);
  assert.equal(agents[0].id, 'vscode-copilot-all-projects');
  assert.equal(agents[0].name, 'VS Code Copilot');
  assert.equal(agents[0].avatarAssignmentKey, 'runtime:vscode-copilot-single');
});

test('does not publish stored sessions while VS Code is closed', async () => {
  assert.deepEqual(await fetchVsCodeCopilotAgents({ processRunning: false }), []);
});
