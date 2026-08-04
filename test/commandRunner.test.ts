import assert from 'node:assert/strict';
import test from 'node:test';
import { quotePosixArg } from '../src/infrastructure/process/commandRunner';

test('quotePosixArg leaves safe arguments readable', () => {
  assert.equal(quotePosixArg('user@example-host'), 'user@example-host');
  assert.equal(quotePosixArg('/usr/local/bin/clashctl'), '/usr/local/bin/clashctl');
});

test('quotePosixArg contains shell metacharacters inside a single argument', () => {
  assert.equal(quotePosixArg('node; touch /tmp/nope'), "'node; touch /tmp/nope'");
  assert.equal(quotePosixArg("node'quote"), "'node'\"'\"'quote'");
  assert.equal(quotePosixArg('$(id)'), "'$(id)'");
  assert.equal(quotePosixArg(''), "''");
});
