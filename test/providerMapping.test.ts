import assert from 'node:assert/strict';
import test from 'node:test';
import { ProxyProvider } from '../src/domain/entities/dashboard';
import { bestProviderDelay, findProviderForNode, findProviderForSubscription } from '../src/domain/providerMapping';

const providers: ProxyProvider[] = [
  { name: 'default-backup', nodes: [{ name: 'Backup Node', delay: 80 }] },
  { name: 'Default', nodes: [{ name: 'Node A', delay: 42 }, { name: 'Node B', delay: 0 }, { name: 'Node C', delay: 128 }] }
];

test('subscription provider mapping is exact and case insensitive', () => {
  assert.equal(findProviderForSubscription(providers, 'default')?.name, 'Default');
  assert.equal(findProviderForSubscription(providers, 'backup'), undefined);
});

test('provider latency stays attached to its node and source', () => {
  const provider = findProviderForNode(providers, 'Node A');
  assert.equal(provider?.name, 'Default');
  assert.equal(bestProviderDelay(provider), 42);
});
