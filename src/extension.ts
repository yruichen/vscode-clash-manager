import * as vscode from 'vscode';
import { DashboardManager } from './application/dashboardManager';
import { bestProviderDelay, findProviderForNode, findProviderForSubscription } from './domain/providerMapping';
import { Localization } from './localization/localization';
import { readTargetSettings } from './infrastructure/storage/settings';
import { StatusBarController } from './presentation/statusbar/statusBarController';
import { ClashTreeProvider } from './presentation/tree/clashTreeProvider';

export function activate(context: vscode.ExtensionContext): void {
  const settings = readTargetSettings();
  const localization = new Localization(context.extensionPath, settings.language);
  const output = vscode.window.createOutputChannel(localization.t('settings.output.title'), { log: true });
  const manager = new DashboardManager(context, localization, output);
  const treeProvider = new ClashTreeProvider(manager, localization);
  const treeView = vscode.window.createTreeView('clashManager.sidebar', {
    treeDataProvider: treeProvider,
    showCollapseAll: true
  });
  const statusBar = new StatusBarController(manager, localization);
  let autoRefreshTimer: NodeJS.Timeout | undefined;

  const configureAutoRefresh = (): void => {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = undefined;
    if (!manager.currentSettings.autoRefresh) return;
    autoRefreshTimer = setInterval(() => void manager.refresh(), manager.currentSettings.refreshIntervalMs);
    autoRefreshTimer.unref();
  };

  const showFailure = (action: string, error: unknown): void => {
    const detail = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(localization.t('command.error.failed', { action, error: detail }));
  };

  context.subscriptions.push(
    output,
    manager,
    treeProvider,
    treeView,
    statusBar,
    vscode.commands.registerCommand('clashManager.show', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.clashManager');
      await vscode.commands.executeCommand('clashManager.sidebar.focus');
    }),
    vscode.commands.registerCommand('clashManager.refresh', () => manager.refresh().catch(error => showFailure('refresh', error))),
    vscode.commands.registerCommand('clashManager.configureTarget', () => configureTarget(manager, localization)),
    vscode.commands.registerCommand('clashManager.toggleProxy', async () => {
      try {
        const running = manager.state.status?.lifecycle === 'running';
        if (running) {
          const confirm = await vscode.window.showWarningMessage(
            localization.t('command.toggle.stopConfirm', { target: manager.state.targetLabel }),
            { modal: true },
            localization.t('command.toggle.stop')
          );
          if (!confirm) return;
        }
        await manager.toggleProxy();
      } catch (error) {
        showFailure('toggleProxy', error);
      }
    }),
    vscode.commands.registerCommand('clashManager.runDoctor', () => manager.runDoctor().catch(error => showFailure('doctor', error))),
    vscode.commands.registerCommand('clashManager.setLanguage', () => setLanguage(manager, treeProvider, statusBar, localization)),
    vscode.commands.registerCommand('clashManager.setControllerSecret', async () => {
      const secret = await vscode.window.showInputBox({
        prompt: localization.t('command.controller.secret.prompt'),
        password: true,
        ignoreFocusOut: true,
        validateInput: value => value.length > 512 || /[\r\n\0]/.test(value) ? localization.t('command.error.invalidMessage') : undefined
      });
      if (secret === undefined) return;
      try {
        await manager.saveControllerSecret(secret);
        void vscode.window.showInformationMessage(localization.t('command.controller.secret.saved'));
      } catch (error) {
        showFailure('setControllerSecret', error);
      }
    }),
    vscode.commands.registerCommand('clashManager.clearControllerSecret', async () => {
      await manager.clearControllerSecret();
      void vscode.window.showInformationMessage(localization.t('command.controller.secret.cleared'));
    }),
    vscode.commands.registerCommand('clashManager.openLogs', async () => {
      output.clear();
      output.appendLine(localization.t('settings.logs.header', { target: manager.state.targetLabel }));
      try {
        const logs = await manager.getLogs();
        output.appendLine(logs || localization.t('settings.logs.empty'));
      } catch (error) {
        showFailure('openLogs', error);
      }
      output.show(true);
    }),
    vscode.commands.registerCommand('clashManager.switchSubscription', async (name: unknown) => {
      if (typeof name !== 'string') return;
      const confirm = await vscode.window.showWarningMessage(
        localization.t('command.subscription.confirm', { target: manager.state.targetLabel, name }),
        { modal: true },
        localization.t('command.subscription.switch')
      );
      if (!confirm) return;
      try {
        await manager.switchSubscription(name);
        void vscode.window.showInformationMessage(localization.t('command.subscription.changed', { name }));
      } catch (error) {
        showFailure('switchSubscription', error);
      }
    }),
    vscode.commands.registerCommand('clashManager.pickProxy', async () => {
      const groups = manager.state.proxyGroups;
      if (!manager.state.controller.connected || !groups.length) {
        void vscode.window.showWarningMessage(localization.t('command.error.controllerUnavailable'));
        return;
      }
      const pickedGroup = groups.length === 1
        ? groups[0]
        : (await vscode.window.showQuickPick(groups.map(group => ({
            label: group.name,
            description: group.now,
            value: group
          })), { placeHolder: localization.t('command.proxy.pickGroup') }))?.value;
      if (!pickedGroup) return;

      const pickedNode = await vscode.window.showQuickPick(pickedGroup.all.map(name => {
        const provider = findProviderForNode(manager.state.providers, name);
        const providerNode = provider?.nodes.find(node => node.name === name);
        const delay = providerNode?.delay ?? pickedGroup.delays[name];
        return {
          label: name,
          description: name === pickedGroup.now ? localization.t('common.active') : undefined,
          detail: [
            delay ? localization.t('common.milliseconds', { value: delay }) : undefined,
            provider ? localization.t('sidebar.provider.source', { provider: provider.name }) : undefined
          ].filter((value): value is string => Boolean(value)).join(' · ') || undefined,
          value: name
        };
      }), { placeHolder: localization.t('command.proxy.pickNode'), matchOnDescription: true, matchOnDetail: true });
      if (!pickedNode || pickedNode.value === pickedGroup.now) return;
      await vscode.commands.executeCommand('clashManager.selectProxy', pickedGroup.name, pickedNode.value);
    }),
    vscode.commands.registerCommand('clashManager.pickSubscription', async () => {
      const subscriptions = manager.state.subscriptions;
      if (!subscriptions.length) return;
      const picked = await vscode.window.showQuickPick(subscriptions.map(subscription => {
        const provider = findProviderForSubscription(manager.state.providers, subscription.name);
        const bestDelay = bestProviderDelay(provider);
        return {
          label: subscription.name,
          description: subscription.active ? localization.t('common.active') : subscription.type,
          detail: [
            bestDelay ? localization.t('sidebar.provider.bestDelay', { delay: bestDelay }) : undefined,
            provider ? localization.t('sidebar.provider.source', { provider: provider.name }) : undefined
          ].filter((value): value is string => Boolean(value)).join(' · ') || localization.t('sidebar.profiles.urlProtected'),
          value: subscription
        };
      }), { placeHolder: localization.t('command.subscription.pick'), matchOnDescription: true, matchOnDetail: true });
      if (!picked || picked.value.active) return;
      await vscode.commands.executeCommand('clashManager.switchSubscription', picked.value.name);
    }),
    vscode.commands.registerCommand('clashManager.pickMode', async () => {
      if (!manager.state.controller.connected) {
        void vscode.window.showWarningMessage(localization.t('command.error.controllerUnavailable'));
        return;
      }
      const current = manager.state.controller.mode;
      const picked = await vscode.window.showQuickPick((['rule', 'global', 'direct'] as const).map(mode => ({
        label: localization.t(`sidebar.mode.${mode}`),
        description: current === mode ? localization.t('common.active') : undefined,
        value: mode
      })), { placeHolder: localization.t('command.mode.pick') });
      if (!picked || picked.value === current) return;
      await vscode.commands.executeCommand('clashManager.setMode', picked.value);
    }),
    vscode.commands.registerCommand('clashManager.selectProxy', async (group: unknown, name: unknown) => {
      if (typeof group !== 'string' || typeof name !== 'string') return;
      try {
        await manager.selectProxy(group, name);
        void vscode.window.showInformationMessage(localization.t('command.proxy.changed', { group, name }));
      } catch (error) {
        showFailure('selectProxy', error);
      }
    }),
    vscode.commands.registerCommand('clashManager.setMode', async (mode: unknown) => {
      if (mode !== 'rule' && mode !== 'global' && mode !== 'direct') return;
      const label = localization.t(`sidebar.mode.${mode}`);
      const confirm = await vscode.window.showWarningMessage(
        localization.t('command.mode.confirm', { target: manager.state.targetLabel, mode: label }),
        { modal: true },
        localization.t('command.mode.switch')
      );
      if (!confirm) return;
      try {
        await manager.setMode(mode);
        void vscode.window.showInformationMessage(localization.t('command.mode.changed', { mode: label }));
      } catch (error) {
        showFailure('setMode', error);
      }
    }),
    vscode.commands.registerCommand('clashManager.closeConnection', async (argument: unknown) => {
      const id = typeof argument === 'string'
        ? argument
        : argument && typeof argument === 'object' && typeof (argument as { payload?: { id?: unknown } }).payload?.id === 'string'
          ? (argument as { payload: { id: string } }).payload.id
          : undefined;
      if (!id) return;
      try {
        await manager.closeConnection(id);
      } catch (error) {
        showFailure('closeConnection', error);
      }
    }),
    vscode.commands.registerCommand('clashManager.closeAllConnections', async () => {
      const confirm = await vscode.window.showWarningMessage(
        localization.t('command.connection.closeAllConfirm', { target: manager.state.targetLabel }),
        { modal: true },
        localization.t('command.connection.closeAll')
      );
      if (!confirm) return;
      try {
        await manager.closeAllConnections();
      } catch (error) {
        showFailure('closeAllConnections', error);
      }
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration('clashManager')) return;
      manager.reloadSettings();
      treeProvider.refresh();
      statusBar.render();
      configureAutoRefresh();
      void manager.refresh();
    }),
    { dispose: () => { if (autoRefreshTimer) clearInterval(autoRefreshTimer); } }
  );

  configureAutoRefresh();
  void manager.refresh();
}

async function configureTarget(manager: DashboardManager, localization: Localization): Promise<void> {
  const selection = await vscode.window.showQuickPick([
    {
      label: localization.t('command.configure.mode.local'),
      description: localization.t('command.configure.mode.local.detail'),
      value: 'local' as const
    },
    {
      label: localization.t('command.configure.mode.ssh'),
      description: localization.t('command.configure.mode.ssh.detail'),
      value: 'ssh' as const
    }
  ], { placeHolder: localization.t('command.configure.mode.prompt') });
  if (!selection) return;

  let sshTarget = '';
  if (selection.value === 'ssh') {
    const target = await vscode.window.showInputBox({
      prompt: localization.t('command.configure.sshTarget.prompt'),
      placeHolder: localization.t('command.configure.sshTarget.placeholder'),
      ignoreFocusOut: true,
      value: manager.currentSettings.sshTarget,
      validateInput: value => !value.trim() || value.length > 255 || /[\r\n\0]/.test(value) ? localization.t('command.error.invalidMessage') : undefined
    });
    if (target === undefined) return;
    sshTarget = target.trim();
  }

  const configuration = vscode.workspace.getConfiguration('clashManager');
  await configuration.update('transport', selection.value, vscode.ConfigurationTarget.Global);
  await configuration.update('sshTarget', sshTarget, vscode.ConfigurationTarget.Global);
  manager.reloadSettings();
  await manager.refresh();
  void vscode.window.showInformationMessage(localization.t('command.configure.saved'));
}

async function setLanguage(
  manager: DashboardManager,
  treeProvider: ClashTreeProvider,
  statusBar: StatusBarController,
  localization: Localization
): Promise<void> {
  const selected = await vscode.window.showQuickPick([
    { label: localization.t('command.language.en'), value: 'en' as const },
    { label: localization.t('command.language.zhCN'), value: 'zh-CN' as const }
  ], { placeHolder: localization.t('command.language.prompt') });
  if (!selected) return;
  await vscode.workspace.getConfiguration('clashManager').update('language', selected.value, vscode.ConfigurationTarget.Global);
  manager.reloadSettings();
  treeProvider.refresh();
  statusBar.render();
  void vscode.window.showInformationMessage(localization.t('command.language.changed', { language: selected.label }));
}

export function deactivate(): void {}
