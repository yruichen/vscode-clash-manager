'use strict';

const { CommandRunner } = require('../out/src/infrastructure/process/commandRunner');
const { TargetRunner } = require('../out/src/infrastructure/process/targetRunner');
const { ClashctlService } = require('../out/src/infrastructure/clashctl/clashctlService');
const { ControllerClient, ControllerError } = require('../out/src/infrastructure/clashctl/controllerClient');

const target = process.env.CLASH_MANAGER_TEST_TARGET;
if (!target) {
  process.stderr.write('Set CLASH_MANAGER_TEST_TARGET to an OpenSSH alias or target.\n');
  process.exit(2);
}

const settings = {
  transport: 'ssh',
  sshTarget: target,
  clashctlPath: 'clashctl',
  commandTimeoutMs: 20_000,
  controllerUrl: '',
  controllerAutoDiscover: true,
  language: 'en',
  autoRefresh: false,
  refreshIntervalMs: 5_000,
  showSensitiveAddresses: false
};

const main = async () => {
  const service = new ClashctlService(new TargetRunner(new CommandRunner(), settings), settings);
  const [status, subscriptions, diagnostic] = await Promise.all([service.status(), service.subscriptions(), service.doctor()]);
  const serializedSubscriptions = JSON.stringify(subscriptions);
  if (/https?:\/\//i.test(serializedSubscriptions) || /[?&](?:token|secret|key)=/i.test(serializedSubscriptions)) {
    throw new Error('Sanitized subscription model exposed a URL or credential parameter');
  }
  const summary = {
    lifecycle: status.lifecycle,
    routing: status.routing,
    subscriptions: subscriptions.length,
    subscriptionUrlsExposed: false,
    diagnostics: {
      summaryPresent: Boolean(diagnostic.summary),
      findings: diagnostic.findings.length,
      advice: diagnostic.advice.length
    },
    controller: { discovered: Boolean(status.controllerLanUrl || status.controllerLocalUrl), connected: false, groups: 0, providers: 0, connections: 0, rules: 0, trafficSample: false, memorySample: false }
  };

  const controllerUrl = status.controllerLanUrl || status.controllerLocalUrl;
  if (controllerUrl) {
    let client = new ControllerClient(controllerUrl, undefined, 10_000);
    try {
      let snapshot;
      try {
        snapshot = await client.snapshot();
      } catch (error) {
        if (!(error instanceof ControllerError) || error.statusCode !== 401) throw error;
        const secret = await service.controllerSecret();
        if (!secret) throw error;
        client = new ControllerClient(controllerUrl, secret, 10_000);
        snapshot = await client.snapshot();
      }
      summary.controller = {
        discovered: true,
        connected: snapshot.connected,
        groups: snapshot.proxyGroups.length,
        providers: snapshot.providers.length,
        subscriptionProviderMatches: subscriptions.filter(subscription => snapshot.providers.some(provider => provider.name.trim().toLowerCase() === subscription.name.trim().toLowerCase())).length,
        connections: snapshot.connections.length,
        rules: snapshot.rules.length,
        trafficSample: snapshot.uploadSpeed >= 0 && snapshot.downloadSpeed >= 0,
        memorySample: snapshot.memory > 0
      };
    } catch (error) {
      summary.controller.errorClass = error instanceof ControllerError ? `HTTP-${error.statusCode || 'transport'}` : 'transport';
    }
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
};

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
