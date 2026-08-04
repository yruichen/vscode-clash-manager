import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDoctor, parseStatus, parseSubscriptions } from '../src/infrastructure/clashctl/parsers';
import { redactText } from '../src/infrastructure/clashctl/redaction';

const STATUS_SAMPLE = `
🐱 Clash 状态总览
【当前结果】
🐱 代理状态：🐱 已开启
🌐 当前可用性：本地代理可用，系统流量未自动接管
📡 当前订阅：default
🚀 当前节点：Auto -> Node A
🚨 当前风险：🐱 低
【核心入口】
🔧 运行后端：systemd
🧪 Tun 状态：❗ 未生效
📜 系统代理持久接管：unsupported
🌐 本地代理：http://127.0.0.1:7890
🏠 局域网代理：http://192.0.2.10:7890
🐱 控制台：http://127.0.0.1:9090/ui
🏠 局域网：http://192.0.2.10:9090/ui
`;

test('parseStatus extracts lifecycle and distinct Controller URLs', () => {
  const status = parseStatus(STATUS_SAMPLE);
  assert.equal(status.lifecycle, 'running');
  assert.equal(status.routing, 'off');
  assert.equal(status.subscription, 'default');
  assert.equal(status.backend, 'systemd');
  assert.equal(status.controllerLocalUrl, 'http://127.0.0.1:9090');
  assert.equal(status.controllerLanUrl, 'http://192.0.2.10:9090');
});

test('parseSubscriptions drops source URLs at the parser boundary', () => {
  const output = `
  名称             类型     URL
\u001b[32m*\u001b[0m default          clash    https://example.invalid/sub?token=abc123
  backup          clash    https://example.invalid/other?token=def456
`;
  const subscriptions = parseSubscriptions(output);
  assert.deepEqual(subscriptions.map(item => ({ name: item.name, type: item.type, active: item.active })), [
    { name: 'default', type: 'clash', active: true },
    { name: 'backup', type: 'clash', active: false }
  ]);
  assert.equal(JSON.stringify(subscriptions).includes('abc123'), false);
  assert.equal(JSON.stringify(subscriptions).includes('https://'), false);
});

test('parseDoctor groups summary, findings, evidence and advice', () => {
  const output = `
📜 系统诊断
【总体结论】
🐱 当前基本可用：代理内核正常
【发现的问题】
⚠ DNS 端口未监听
【关键证据】
🔍 服务状态：运行中
【修复建议】
💡 检查 DNS 配置
`;
  const report = parseDoctor(output);
  assert.match(report.summary, /当前基本可用/);
  assert.deepEqual(report.findings, ['DNS 端口未监听']);
  assert.deepEqual(report.evidence, ['服务状态：运行中']);
  assert.deepEqual(report.advice, ['检查 DNS 配置']);
});

test('redactText removes URL query credentials and authorization tokens', () => {
  const redacted = redactText('url=https://example.invalid/sub?token=abc123 token=secret Authorization: Bearer abc.def.ghi');
  assert.equal(redacted.includes('abc123'), false);
  assert.equal(redacted.includes('token=secret'), false);
  assert.equal(redacted.includes('abc.def.ghi'), false);
  assert.match(redacted, /redacted/);
});
