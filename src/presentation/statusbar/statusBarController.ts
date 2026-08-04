import * as vscode from 'vscode';
import { DashboardManager } from '../../application/dashboardManager';
import { Localization } from '../../localization/localization';

export class StatusBarController implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly timer: NodeJS.Timeout;

  public constructor(private readonly manager: DashboardManager, private readonly localization: Localization) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 30);
    this.item.name = 'Clash Manager';
    this.item.command = 'clashManager.show';
    this.subscriptions.push(this.item, this.manager.onDidChange(() => this.render()));
    this.timer = setInterval(() => this.render(), 5_000);
    this.timer.unref();
    this.render();
    this.item.show();
  }

  public dispose(): void {
    clearInterval(this.timer);
    for (const disposable of this.subscriptions) disposable.dispose();
  }

  public render(): void {
    const state = this.manager.state;
    const target = state.targetLabel;
    if (!state.configured) {
      this.item.text = `$(plug) ${this.localization.t('statusbar.setup')}`;
      this.item.tooltip = this.localization.t('statusbar.tooltip.setup');
      this.item.backgroundColor = undefined;
      return;
    }
    if (state.loading && !state.status) {
      this.item.text = `$(sync~spin) ${this.localization.t('statusbar.checking')}`;
      this.item.tooltip = this.localization.t('statusbar.tooltip.checking', { target, state: this.localization.t('common.unknown') });
      this.item.backgroundColor = undefined;
      return;
    }
    if (state.error) {
      this.item.text = `$(warning) ${this.localization.t('statusbar.error')}`;
      this.item.tooltip = this.localization.t('statusbar.tooltip.error', { target, error: state.error });
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      return;
    }
    const staleAfter = Math.max(this.manager.currentSettings.refreshIntervalMs * 2.5, 30_000);
    if (state.lastUpdated && Date.now() - state.lastUpdated > staleAfter) {
      this.item.text = `$(clock) ${this.localization.t('statusbar.stale')}`;
      this.item.tooltip = this.localization.t('statusbar.tooltip.stale', { target, time: new Date(state.lastUpdated).toLocaleTimeString() });
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      return;
    }
    if (state.status?.lifecycle === 'running') {
      this.item.text = `$(shield) ${this.localization.t('statusbar.on')}`;
      this.item.tooltip = this.localization.t('statusbar.tooltip.on', { target });
      this.item.backgroundColor = undefined;
      return;
    }
    this.item.text = `$(circle-slash) ${this.localization.t('statusbar.off')}`;
    this.item.tooltip = this.localization.t('statusbar.tooltip.off', { target });
    this.item.backgroundColor = undefined;
  }
}
