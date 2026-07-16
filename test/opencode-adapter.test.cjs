const test = require('node:test');
const assert = require('node:assert/strict');

const {
  fetchOpenCodeAgents,
  normalizeOpenCodeUrl,
  normalizedStatus,
  projectIdentity
} = require('../desktop/providers/opencode.cjs');

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

test('normalizes only loopback OpenCode URLs', () => {
  assert.equal(normalizeOpenCodeUrl('http://localhost:4096/'), 'http://localhost:4096');
  assert.throws(() => normalizeOpenCodeUrl('https://localhost:4096'), /must use http/);
  assert.throws(() => normalizeOpenCodeUrl('http://example.com:4096'), /this computer/);
});

test('maps OpenCode session states to Claw states', () => {
  assert.equal(normalizedStatus({ type: 'busy' }), 'active');
  assert.equal(normalizedStatus({ type: 'retry' }), 'blocked');
  assert.equal(normalizedStatus({ type: 'idle' }), 'idle');
});

test('returns active sessions enriched with safe session metadata', async () => {
  const responses = new Map([
    ['/session/status', { ses_busy: { type: 'busy' }, ses_idle: { type: 'idle' } }],
    ['/session', [
      { id: 'ses_idle', title: 'Older work', directory: '/work/old', time: { updated: 1000 } },
      { id: 'ses_busy', title: 'Implement adapter', directory: '/work/claw', agent: 'build', model: { providerID: 'openai', modelID: 'gpt-5' }, time: { updated: 2000 } }
    ]]
  ]);
  const agents = await fetchOpenCodeAgents({
    fetchImpl: async (url) => jsonResponse(responses.get(new URL(url).pathname)),
    now: () => 3_000_000
  });

  assert.equal(agents.length, 1);
  assert.equal(agents[0].id, projectIdentity({ directory: '/work/claw' }).id);
  assert.equal(agents[0].status, 'active');
  assert.equal(agents[0].name, 'OpenCode · claw');
  assert.equal(agents[0].task, 'Implement adapter');
  assert.equal(agents[0].workspacePath, '/work/claw');
  assert.equal(agents[0].activity.model, 'openai/gpt-5');
  assert.equal(agents[0].avatarAssignmentKey, projectIdentity({ directory: '/work/claw' }).assignmentKey);
});

test('keeps the latest session visible when OpenCode is idle', async () => {
  const responses = new Map([
    ['/session/status', {}],
    ['/session', [
      { id: 'older', directory: '/work/old', time: { updated: 1000 } },
      { id: 'latest', directory: '/work/new', time: { updated: 2000 } }
    ]]
  ]);
  const agents = await fetchOpenCodeAgents({
    fetchImpl: async (url) => jsonResponse(responses.get(new URL(url).pathname))
  });

  assert.deepEqual(agents.map((agent) => agent.id), [projectIdentity({ directory: '/work/new' }).id]);
  assert.equal(agents[0].status, 'idle');
  assert.equal(agents[0].displayState, 'Idle');
  assert.equal(agents[0].pose, null);
});

test('folds multiple active terminal sessions into one agent per project', async () => {
  const sessions = [
    { id: 'a-new', title: 'A new', directory: '/work/a', time: { updated: 300 } },
    { id: 'a-old', title: 'A old', directory: '/work/a/', time: { updated: 200 } },
    { id: 'b', title: 'B', directory: '/work/b', time: { updated: 100 } }
  ];
  const responses = new Map([
    ['/session/status', { 'a-new': { type: 'busy' }, 'a-old': { type: 'busy' }, b: { type: 'busy' } }],
    ['/session', sessions]
  ]);
  const agents = await fetchOpenCodeAgents({
    fetchImpl: async (url) => jsonResponse(responses.get(new URL(url).pathname)),
    now: () => 400_000
  });

  assert.deepEqual(agents.map((agent) => agent.id), [
    projectIdentity({ directory: '/work/a' }).id,
    projectIdentity({ directory: '/work/b' }).id
  ]);
  assert.deepEqual(agents.map((agent) => agent.task), ['A new', 'B']);
});

test('can fold every terminal project into one OpenCode agent', async () => {
  const responses = new Map([
    ['/session/status', { a: { type: 'busy' }, b: { type: 'idle' } }],
    ['/session', [
      { id: 'a', title: 'Older busy project', directory: '/work/a', time: { updated: 200 } },
      { id: 'b', title: 'Latest idle project', directory: '/work/b', time: { updated: 300 } }
    ]]
  ]);
  const agents = await fetchOpenCodeAgents({
    grouping: 'single',
    fetchImpl: async (url) => jsonResponse(responses.get(new URL(url).pathname)),
    now: () => 400_000
  });

  assert.equal(agents.length, 1);
  assert.equal(agents[0].id, 'opencode-all-projects');
  assert.equal(agents[0].name, 'OpenCode');
  assert.equal(agents[0].avatarAssignmentKey, 'runtime:opencode-single');
  assert.equal(agents[0].task, 'Latest idle project');
  assert.equal(agents[0].workspacePath, '/work/b');
  assert.equal(agents[0].status, 'idle');
  assert.equal(agents[0].displayState, 'Idle');
  assert.equal(agents[0].pose, null);
});

test('reports OpenCode HTTP failures', async () => {
  await assert.rejects(
    fetchOpenCodeAgents({ fetchImpl: async () => jsonResponse({}, 503) }),
    /HTTP 503/
  );
});

test('supports OpenCode HTTP basic authentication', async () => {
  const headers = [];
  await fetchOpenCodeAgents({
    username: 'claw',
    password: 'secret',
    fetchImpl: async (_url, options) => {
      headers.push(options.headers.authorization);
      return jsonResponse([]);
    }
  });
  assert.deepEqual(headers, ['Basic Y2xhdzpzZWNyZXQ=', 'Basic Y2xhdzpzZWNyZXQ=']);
});
