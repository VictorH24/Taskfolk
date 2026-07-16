const test = require('node:test');
const assert = require('node:assert/strict');

const {
  agentsFromRows,
  defaultOpenCodeDbPath,
  isOpenCodeDesktopRunning,
  rowStatus
} = require('../desktop/providers/opencode-desktop.cjs');
const { projectIdentity } = require('../desktop/providers/opencode.cjs');

test('uses the standard OpenCode database location', () => {
  assert.equal(
    defaultOpenCodeDbPath({ platform: 'darwin', env: {}, home: '/Users/test' }),
    '/Users/test/.local/share/opencode/opencode.db'
  );
  assert.equal(
    defaultOpenCodeDbPath({ platform: 'linux', env: { XDG_DATA_HOME: '/data' }, home: '/home/test' }),
    '/data/opencode/opencode.db'
  );
});

test('detects the OpenCode Desktop process without matching the CLI', async () => {
  const desktop = await isOpenCodeDesktopRunning({
    platform: 'darwin',
    run: async () => '/Applications/OpenCode.app/Contents/MacOS/OpenCode\n/usr/local/bin/opencode\n'
  });
  const cliOnly = await isOpenCodeDesktopRunning({
    platform: 'darwin',
    run: async () => '/usr/local/bin/opencode\n'
  });
  assert.equal(desktop, true);
  assert.equal(cliOnly, false);
});

test('infers live desktop work from incomplete messages and recent activity', () => {
  const now = 2_000_000;
  assert.equal(rowStatus({ message_role: 'assistant', message_completed: null, part_updated: now - 1_000 }, now), 'busy');
  assert.equal(rowStatus({ message_role: 'assistant', message_completed: null, part_updated: now - 60_000 }, now), 'idle');
  assert.equal(rowStatus({ message_role: 'assistant', message_completed: now - 1_000, message_error: 'object' }, now), 'error');
});

test('normalizes active desktop sessions and keeps the latest idle session visible', () => {
  const now = 2_000_000;
  const base = {
    title: 'Desktop task',
    directory: '/work/desktop',
    agent: 'build',
    model: JSON.stringify({ providerID: 'openai', modelID: 'gpt-5' }),
    message_error: null,
    tool_status: null
  };
  const active = agentsFromRows([
    { ...base, id: 'active', message_role: 'assistant', message_completed: null, session_updated: now - 1_000, message_updated: now - 1_000, part_updated: now - 500 },
    { ...base, id: 'idle', message_role: 'assistant', message_completed: now - 10_000, session_updated: now - 10_000, message_updated: now - 10_000, part_updated: now - 10_000 }
  ], now, 8);
  assert.deepEqual(active.map((agent) => agent.id), [projectIdentity({ directory: '/work/desktop' }).id]);
  assert.equal(active[0].status, 'active');
  assert.match(active[0].role, /^OpenCode Desktop/);
  assert.equal(active[0].avatarAssignmentKey, projectIdentity({ directory: '/work/desktop' }).assignmentKey);

  const idle = agentsFromRows([
    { ...base, id: 'latest', message_role: 'assistant', message_completed: now - 1_000, session_updated: now - 1_000, message_updated: now - 1_000, part_updated: now - 1_000 }
  ], now, 8);
  assert.equal(idle[0].status, 'idle');
  assert.equal(idle[0].source, 'opencode-desktop');
});

test('keeps one stable agent for each OpenCode project', () => {
  const now = 2_000_000;
  const rows = [
    { id: 'a2', title: 'A latest', directory: '/work/a', message_role: 'assistant', message_completed: now - 100, session_updated: now - 100, message_updated: now - 100, part_updated: now - 100 },
    { id: 'a1', title: 'A older', directory: '/work/a', message_role: 'assistant', message_completed: now - 200, session_updated: now - 200, message_updated: now - 200, part_updated: now - 200 },
    { id: 'b1', title: 'B', directory: '/work/b', message_role: 'assistant', message_completed: now - 300, session_updated: now - 300, message_updated: now - 300, part_updated: now - 300 }
  ];
  const agents = agentsFromRows(rows, now, 8);
  assert.deepEqual(agents.map((agent) => agent.id), [
    projectIdentity({ directory: '/work/a' }).id,
    projectIdentity({ directory: '/work/b' }).id
  ]);
  assert.deepEqual(agents.map((agent) => agent.task), ['A latest', 'B']);
});

test('can represent every desktop project with one OpenCode agent', () => {
  const now = 2_000_000;
  const agents = agentsFromRows([
    { id: 'a', title: 'Older busy project', directory: '/work/a', message_role: 'assistant', message_completed: null, session_updated: now - 200, message_updated: now - 200, part_updated: now - 200 },
    { id: 'b', title: 'Latest idle project', directory: '/work/b', message_role: 'assistant', message_completed: now - 100, session_updated: now - 100, message_updated: now - 100, part_updated: now - 100 }
  ], now, 24, 'single');

  assert.equal(agents.length, 1);
  assert.equal(agents[0].id, 'opencode-all-projects');
  assert.equal(agents[0].name, 'OpenCode');
  assert.equal(agents[0].avatarAssignmentKey, 'runtime:opencode-single');
  assert.equal(agents[0].task, 'Latest idle project');
  assert.equal(agents[0].workspacePath, '/work/b');
  assert.equal(agents[0].status, 'idle');
  assert.equal(agents[0].displayState, 'Idle');
  assert.equal(agents[0].pose, null);
  assert.equal(agents[0].source, 'opencode-desktop');
});
