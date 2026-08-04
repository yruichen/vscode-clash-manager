import * as vscode from 'vscode';
import { DashboardManager } from '../../application/dashboardManager';
import { ActiveConnection, DashboardState, ProxyGroup } from '../../domain/entities/dashboard';
import { bestProviderDelay, findProviderForNode, findProviderForSubscription } from '../../domain/providerMapping';
import { Localization } from '../../localization/localization';

interface ClashTreeNode {
  id: string;
  label: string;
  description?: string;
  tooltip?: string;
  icon?: vscode.ThemeIcon;
  collapsibleState?: vscode.TreeItemCollapsibleState;
  contextValue?: string;
  command?: vscode.Command;
  payload?: Record<string, unknown>;
  children?: ClashTreeNode[];
}

export class ClashTreeProvider implements vscode.TreeDataProvider<ClashTreeNode>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<ClashTreeNode | undefined>();
  private readonly managerSubscription: vscode.Disposable;
  public readonly onDidChangeTreeData = this.changeEmitter.event;

  public constructor(private readonly manager: DashboardManager, private readonly localization: Localization) {
    this.managerSubscription = manager.onDidChange(() => this.refresh());
  }

  public dispose(): void {
    this.managerSubscription.dispose();
    this.changeEmitter.dispose();
  }

  public refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  public getTreeItem(node: ClashTreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, node.collapsibleState ?? vscode.TreeItemCollapsibleState.None);
    item.id = node.id;
    item.description = node.description;
    item.tooltip = node.tooltip;
    item.iconPath = node.icon;
    item.contextValue = node.contextValue;
    item.command = node.command;
    return item;
  }

  public getChildren(node?: ClashTreeNode): ClashTreeNode[] {
    if (node) return node.children ?? [];
    return this.rootNodes(this.manager.state);
  }

  private rootNodes(state: DashboardState): ClashTreeNode[] {
    if (!state.configured) {
      return [{
        id: 'setup',
        label: this.localization.t('sidebar.setup.title'),
        description: this.localization.t('sidebar.setup.action'),
        tooltip: this.localization.t('sidebar.setup.description'),
        icon: new vscode.ThemeIcon('plug'),
        command: this.command('clashManager.configureTarget', this.localization.t('sidebar.setup.action'))
      }];
    }

    const roots: ClashTreeNode[] = [];
    if (state.error) {
      roots.push({
        id: 'connection-error',
        label: this.localization.t('sidebar.error.title'),
        description: this.localization.t('sidebar.actions.retry'),
        tooltip: `${state.error}\n\n${this.localization.t('sidebar.error.hint')}`,
        icon: new vscode.ThemeIcon('error', new vscode.ThemeColor('problemsErrorIcon.foreground')),
        command: this.command('clashManager.refresh', this.localization.t('sidebar.actions.retry'))
      });
    }

    roots.push(
      ...this.quickActions(state),
      this.section('proxies', this.localization.t('sidebar.section.proxies'), this.proxyChildren(state), this.localization.t('common.items', { count: state.proxyGroups.length }), 'symbol-variable'),
      this.section('profiles', this.localization.t('sidebar.section.profiles'), this.profileChildren(state), state.status?.subscription, 'files'),
      this.section('connections', this.localization.t('sidebar.section.connections'), this.connectionChildren(state), this.localization.t('sidebar.connections.total', { count: state.connections.length }), 'list-unordered', 'clashManager.connectionsSection'),
      this.section('network', this.localization.t('sidebar.section.network'), this.networkChildren(state), state.controller.connected ? this.localization.t('common.connected') : this.localization.t('common.disconnected'), 'globe'),
      this.section('tools', this.localization.t('sidebar.section.tools'), this.toolChildren(state), state.targetLabel, 'tools')
    );
    return roots;
  }

  private quickActions(state: DashboardState): ClashTreeNode[] {
    const lifecycle = state.status?.lifecycle ?? 'unknown';
    const canToggle = lifecycle === 'running' || lifecycle === 'stopped';
    const mode = state.controller.mode;
    return [
      {
        id: 'quick.proxy',
        label: this.localization.t('sidebar.quick.proxy'),
        description: this.lifecycleLabel(state),
        tooltip: state.status?.routing === 'on' ? this.localization.t('sidebar.status.routingOn') : this.localization.t('sidebar.status.routingOff'),
        icon: lifecycle === 'running'
          ? new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconPassed'))
          : lifecycle === 'stopped'
            ? new vscode.ThemeIcon('circle-large-outline')
            : new vscode.ThemeIcon(state.loading ? 'sync~spin' : 'question'),
        contextValue: canToggle ? 'clashManager.lifecycle' : undefined,
        command: canToggle
          ? this.command('clashManager.toggleProxy', lifecycle === 'running' ? this.localization.t('sidebar.status.stop') : this.localization.t('sidebar.status.start'))
          : undefined
      },
      {
        id: 'quick.node',
        label: this.localization.t('sidebar.quick.node'),
        description: state.status?.node ?? this.localization.t('common.unavailable'),
        icon: new vscode.ThemeIcon('server-environment'),
        command: state.controller.connected && state.proxyGroups.length
          ? this.command('clashManager.pickProxy', this.localization.t('command.proxy.pickNode'))
          : undefined
      },
      {
        id: 'quick.subscription',
        label: this.localization.t('sidebar.quick.subscription'),
        description: state.status?.subscription ?? this.localization.t('common.unavailable'),
        tooltip: this.localization.t('sidebar.profiles.urlProtected'),
        icon: new vscode.ThemeIcon('file-symlink-file'),
        command: state.subscriptions.length
          ? this.command('clashManager.pickSubscription', this.localization.t('command.subscription.pick'))
          : undefined
      },
      {
        id: 'quick.mode',
        label: this.localization.t('sidebar.quick.mode'),
        description: mode ? this.localization.t(`sidebar.mode.${mode}`) : this.localization.t('common.unavailable'),
        icon: new vscode.ThemeIcon('symbol-enum'),
        command: state.controller.connected
          ? this.command('clashManager.pickMode', this.localization.t('command.mode.pick'))
          : undefined
      }
    ];
  }

  private proxyChildren(state: DashboardState): ClashTreeNode[] {
    if (!state.controller.connected) {
      return [{
        id: 'proxies.controller-required',
        label: this.localization.t('sidebar.proxies.setSecret'),
        description: this.localization.t('common.disconnected'),
        tooltip: this.localization.t('sidebar.proxies.controllerNeeded'),
        icon: new vscode.ThemeIcon('key'),
        command: this.command('clashManager.setControllerSecret', this.localization.t('sidebar.proxies.setSecret'))
      }];
    }
    if (!state.proxyGroups.length) return [this.emptyNode('proxies.empty', this.localization.t('sidebar.proxies.noGroups'))];
    return state.proxyGroups.map(group => this.proxyGroupNode(group, state));
  }

  private proxyGroupNode(group: ProxyGroup, state: DashboardState): ClashTreeNode {
    return {
      id: `proxyGroup.${group.name}`,
      label: group.name,
      description: group.now,
      tooltip: `${group.type} · ${this.localization.t('sidebar.proxies.nodes', { count: group.all.length })}`,
      icon: new vscode.ThemeIcon('server'),
      collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
      contextValue: 'clashManager.proxyGroup',
      children: group.all.map(name => {
        const provider = findProviderForNode(state.providers, name);
        const providerNode = provider?.nodes.find(node => node.name === name);
        const delay = providerNode?.delay ?? group.delays[name];
        const selected = name === group.now;
        const description = [
          delay ? this.localization.t('common.milliseconds', { value: delay }) : undefined,
          provider?.name
        ].filter((value): value is string => Boolean(value)).join(' · ');
        return {
          id: `proxy.${group.name}.${name}`,
          label: name,
          description: description || undefined,
          tooltip: provider ? this.localization.t('sidebar.provider.source', { provider: provider.name }) : undefined,
          icon: new vscode.ThemeIcon(selected ? 'check' : 'circle-outline', selected ? new vscode.ThemeColor('testing.iconPassed') : undefined),
          contextValue: 'clashManager.proxyNode',
          command: this.command('clashManager.selectProxy', this.localization.t('command.proxy.changed', { group: group.name, name }), group.name, name)
        };
      })
    };
  }

  private profileChildren(state: DashboardState): ClashTreeNode[] {
    if (!state.subscriptions.length) return [this.emptyNode('profiles.empty', this.localization.t('sidebar.profiles.empty'))];
    return state.subscriptions.map(subscription => {
      const provider = findProviderForSubscription(state.providers, subscription.name);
      const delay = bestProviderDelay(provider);
      const description = [
        subscription.active ? this.localization.t('common.active') : subscription.type,
        delay ? this.localization.t('sidebar.provider.bestDelay', { delay }) : undefined
      ].filter((value): value is string => Boolean(value)).join(' · ');
      return {
        id: `subscription.${subscription.name}`,
        label: subscription.name,
        description: description || undefined,
        tooltip: provider
          ? `${this.localization.t('sidebar.provider.source', { provider: provider.name })}\n${this.localization.t('sidebar.profiles.urlProtected')}`
          : this.localization.t('sidebar.profiles.urlProtected'),
        icon: new vscode.ThemeIcon(subscription.active ? 'check' : 'file', subscription.active ? new vscode.ThemeColor('testing.iconPassed') : undefined),
        contextValue: subscription.active ? 'clashManager.subscriptionActive' : 'clashManager.subscription',
        command: subscription.active ? undefined : this.command('clashManager.switchSubscription', this.localization.t('command.subscription.switch'), subscription.name)
      };
    });
  }

  private connectionChildren(state: DashboardState): ClashTreeNode[] {
    if (!state.controller.connected) return [this.emptyNode('connections.controller-required', this.localization.t('sidebar.connections.controllerNeeded'), 'debug-disconnect')];
    if (!state.connections.length) return [this.emptyNode('connections.empty', this.localization.t('sidebar.connections.empty'), 'check')];
    return state.connections.slice(0, 200).map(connection => this.connectionNode(connection));
  }

  private connectionNode(connection: ActiveConnection): ClashTreeNode {
    const host = connection.metadata?.host || connection.metadata?.destinationIP || connection.id;
    const chains = connection.chains?.join(' → ') || connection.rule;
    return {
      id: `connection.${connection.id}`,
      label: host,
      description: `↓ ${this.formatBytes(connection.download)}  ↑ ${this.formatBytes(connection.upload)}`,
      tooltip: chains,
      icon: new vscode.ThemeIcon('arrow-swap'),
      contextValue: 'clashManager.connection',
      payload: { id: connection.id },
      command: undefined
    };
  }

  private ruleChildren(state: DashboardState): ClashTreeNode[] {
    if (!state.controller.connected) return [this.emptyNode('rules.controller-required', this.localization.t('sidebar.rules.controllerNeeded'))];
    if (!state.rules.length) return [this.emptyNode('rules.empty', this.localization.t('sidebar.rules.empty'))];
    return state.rules.slice(0, 500).map((rule, index) => ({
      id: `rule.${index}`,
      label: rule.payload ? `${rule.type}: ${rule.payload}` : rule.type,
      description: rule.proxy,
      icon: new vscode.ThemeIcon('symbol-rule')
    }));
  }

  private networkChildren(state: DashboardState): ClashTreeNode[] {
    const status = state.status;
    const address = (value?: string): string => state.settings.showSensitiveAddresses
      ? value ?? this.localization.t('common.unknown')
      : value ? this.localization.t('sidebar.network.hidden') : this.localization.t('common.unknown');
    return [
      this.valueNode('network.download', this.localization.t('sidebar.metrics.download'), this.formatBytes(state.metrics.downloadSpeed, true), 'cloud-download'),
      this.valueNode('network.upload', this.localization.t('sidebar.metrics.upload'), this.formatBytes(state.metrics.uploadSpeed, true), 'cloud-upload'),
      this.valueNode('network.memory', this.localization.t('sidebar.metrics.memory'), state.metrics.memory ? this.formatBytes(state.metrics.memory) : this.localization.t('common.unavailable'), 'server-process'),
      this.valueNode('network.reachability', this.localization.t('sidebar.general.reachability'), status?.reachability, 'radio-tower'),
      this.valueNode('network.backend', this.localization.t('sidebar.general.backend'), status?.backend, 'terminal'),
      this.valueNode('network.risk', this.localization.t('sidebar.general.risk'), status?.risk, 'shield'),
      this.valueNode('network.localProxy', this.localization.t('sidebar.network.httpProxy'), address(status?.localProxy), 'link'),
      this.valueNode('network.lanProxy', this.localization.t('sidebar.network.lanProxy'), address(status?.lanProxy), 'radio-tower'),
      this.valueNode('network.controller', this.localization.t('sidebar.network.controller'), state.controller.connected ? this.localization.t('common.connected') : this.localization.t('common.disconnected'), 'plug'),
      this.valueNode('network.dns', this.localization.t('sidebar.network.dns'), status?.dns, 'globe'),
      this.valueNode('network.tun', this.localization.t('sidebar.general.tun'), status?.tun, 'git-merge'),
      this.valueNode('network.lan', this.localization.t('sidebar.general.lan'), status?.lan, 'broadcast'),
      this.valueNode('network.systemProxy', this.localization.t('sidebar.network.systemProxy'), status?.systemProxy, 'settings')
    ];
  }

  private diagnosticChildren(state: DashboardState): ClashTreeNode[] {
    const report = state.diagnostic;
    const runNode: ClashTreeNode = {
      id: 'diagnostics.run',
      label: this.localization.t('sidebar.diagnostics.run'),
      icon: new vscode.ThemeIcon('play'),
      command: this.command('clashManager.runDoctor', this.localization.t('sidebar.diagnostics.run'))
    };
    if (!report) return [runNode, this.emptyNode('diagnostics.empty', this.localization.t('sidebar.diagnostics.notRun'))];
    const nodes: ClashTreeNode[] = [
      runNode,
      this.valueNode('diagnostics.summary', this.localization.t('sidebar.diagnostics.summary'), report.summary, 'info'),
      ...report.findings.map((finding, index) => this.valueNode(`diagnostics.finding.${index}`, this.localization.t('sidebar.diagnostics.findings'), finding, 'warning')),
      ...report.advice.map((advice, index) => this.valueNode(`diagnostics.advice.${index}`, this.localization.t('sidebar.diagnostics.advice'), advice, 'lightbulb'))
    ];
    return nodes;
  }

  private logChildren(): ClashTreeNode[] {
    return [{
      id: 'logs.open',
      label: this.localization.t('sidebar.logs.open'),
      description: this.localization.t('sidebar.logs.description'),
      icon: new vscode.ThemeIcon('output'),
      command: this.command('clashManager.openLogs', this.localization.t('sidebar.logs.open'))
    }];
  }

  private settingsChildren(state: DashboardState): ClashTreeNode[] {
    return [
      {
        id: 'settings.target',
        label: this.localization.t('sidebar.settings.target'),
        description: state.targetLabel,
        icon: new vscode.ThemeIcon('remote'),
        command: this.command('clashManager.configureTarget', this.localization.t('sidebar.actions.configure'))
      },
      {
        id: 'settings.language',
        label: this.localization.t('sidebar.settings.language'),
        description: state.settings.language === 'zh-CN' ? this.localization.t('command.language.zhCN') : this.localization.t('command.language.en'),
        icon: new vscode.ThemeIcon('symbol-string'),
        command: this.command('clashManager.setLanguage', this.localization.t('sidebar.actions.language'))
      },
      {
        id: 'settings.controllerSecret',
        label: this.localization.t('sidebar.proxies.setSecret'),
        description: state.controller.connected ? this.localization.t('common.connected') : this.localization.t('common.disconnected'),
        icon: new vscode.ThemeIcon('key'),
        command: this.command('clashManager.setControllerSecret', this.localization.t('sidebar.proxies.setSecret'))
      },
      {
        id: 'settings.open',
        label: this.localization.t('sidebar.settings.open'),
        icon: new vscode.ThemeIcon('settings-gear'),
        command: this.command('workbench.action.openSettings', this.localization.t('sidebar.settings.open'), '@ext:yruichen.vscode-clash-manager')
      }
    ];
  }

  private toolChildren(state: DashboardState): ClashTreeNode[] {
    return [
      {
        id: 'tools.rules',
        label: this.localization.t('sidebar.section.rules'),
        description: this.localization.t('sidebar.rules.total', { count: state.rules.length }),
        icon: new vscode.ThemeIcon('list-tree'),
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        children: this.ruleChildren(state)
      },
      {
        id: 'tools.diagnostics',
        label: this.localization.t('sidebar.section.diagnostics'),
        description: state.diagnostic?.severity,
        icon: new vscode.ThemeIcon('pulse'),
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        children: this.diagnosticChildren(state)
      },
      ...this.logChildren(),
      ...this.settingsChildren(state)
    ];
  }

  private section(id: string, label: string, children: ClashTreeNode[], description: string | undefined, icon: string, contextValue = 'clashManager.section'): ClashTreeNode {
    return {
      id: `section.${id}`,
      label,
      description,
      icon: new vscode.ThemeIcon(icon),
      collapsibleState: id === 'proxies' ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
      contextValue,
      children
    };
  }

  private valueNode(id: string, label: string, value?: string, icon = 'circle-small-filled'): ClashTreeNode {
    return {
      id,
      label,
      description: value ?? this.localization.t('common.unknown'),
      tooltip: value,
      icon: new vscode.ThemeIcon(icon)
    };
  }

  private emptyNode(id: string, label: string, icon = 'info'): ClashTreeNode {
    return { id, label, icon: new vscode.ThemeIcon(icon) };
  }

  private lifecycleLabel(state: DashboardState): string {
    if (state.loading && !state.status) return this.localization.t('sidebar.status.checking');
    if (state.error) return this.localization.t('sidebar.status.error');
    if (state.status?.lifecycle === 'running') return this.localization.t('sidebar.status.running');
    if (state.status?.lifecycle === 'stopped') return this.localization.t('sidebar.status.stopped');
    return this.localization.t('sidebar.status.unknown');
  }

  private command(command: string, title: string, ...args: unknown[]): vscode.Command {
    return { command, title, arguments: args };
  }

  private formatBytes(value: number, speed = false): string {
    if (!Number.isFinite(value) || value < 0) return this.localization.t('common.unavailable');
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let amount = value;
    let unit = 0;
    while (amount >= 1024 && unit < units.length - 1) {
      amount /= 1024;
      unit += 1;
    }
    const digits = amount >= 100 || unit === 0 ? 0 : amount >= 10 ? 1 : 2;
    return `${amount.toFixed(digits)} ${units[unit]}${speed ? '/s' : ''}`;
  }
}
