import assert from 'node:assert/strict';
import test from 'node:test';
import { ControllerClient, ControllerRequestSpec } from '../src/infrastructure/clashctl/controllerClient';

test('ControllerClient reads Clash data and sends bounded write operations', async () => {
  const operations: ControllerRequestSpec[] = [];
  const handler = async (request: ControllerRequestSpec): Promise<Record<string, unknown>> => {
    if (request.method !== 'GET') operations.push(request);
    switch (request.pathname) {
      case '/version': return { version: 'test-version' };
      case '/configs': return request.method === 'PATCH' ? {} : { mode: 'rule' };
      case '/proxies': return { proxies: {
          Select: { type: 'Selector', now: 'Node A', all: ['Node A', 'Node B'] },
          'Node A': { type: 'Shadowsocks', history: [{ delay: 42 }] },
          'Node B': { type: 'Shadowsocks', history: [{ delay: 128 }] }
        } };
      case '/providers/proxies': return { providers: {
        default: { name: 'default', type: 'Proxy', vehicleType: 'HTTP', proxies: [
          { name: 'Node A', history: [{ delay: 42 }] },
          { name: 'Node B', history: [{ delay: 128 }] }
        ] }
      } };
      case '/connections': return request.method === 'DELETE' ? {} : { uploadTotal: 30, downloadTotal: 90, connections: [{ id: 'connection-1', upload: 3, download: 9, metadata: { host: 'example.test' }, chains: ['Select', 'Node A'] }] };
      case '/connections/connection-1': return {};
      case '/rules': return { rules: [{ type: 'MATCH', payload: '', proxy: 'Select' }] };
      case '/traffic': return { up: 12, down: 34 };
      case '/memory': return { inuse: 4096 };
      case '/proxies/Select': return {};
      default: throw new Error(`Unexpected request: ${request.pathname}`);
    }
  };
  const client = new ControllerClient('http://127.0.0.1:9090', 'short-secret', 2_000, handler);

  const snapshot = await client.snapshot();
  assert.equal(snapshot.connected, true);
  assert.equal(snapshot.version, 'test-version');
  assert.equal(snapshot.mode, 'rule');
  assert.equal(snapshot.proxyGroups[0].name, 'Select');
  assert.equal(snapshot.proxyGroups[0].delays['Node A'], 42);
  assert.equal(snapshot.providers[0].name, 'default');
  assert.equal(snapshot.providers[0].nodes[0].delay, 42);
  assert.equal(snapshot.connections[0].metadata?.host, 'example.test');
  assert.equal(snapshot.rules[0].type, 'MATCH');
  assert.equal(snapshot.uploadSpeed, 12);
  assert.equal(snapshot.downloadSpeed, 34);
  assert.equal(snapshot.memory, 4096);

  await client.selectProxy('Select', 'Node B');
  await client.setMode('global');
  await client.closeConnection('connection-1');
  await client.closeAllConnections();

  assert.deepEqual(operations, [
    { pathname: '/proxies/Select', method: 'PUT', body: { name: 'Node B' }, stream: false },
    { pathname: '/configs', method: 'PATCH', body: { mode: 'global' }, stream: false },
    { pathname: '/connections/connection-1', method: 'DELETE', body: undefined, stream: false },
    { pathname: '/connections', method: 'DELETE', body: undefined, stream: false }
  ]);
});
