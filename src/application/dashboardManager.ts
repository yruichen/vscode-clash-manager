import * as vscode from 'vscode';
import {
  DashboardState,
  OperationMode,
  ProxyStatus,
  TargetSettings,
  emptyControllerSnapshot
} from '../domain/entities/dashboard';
import { Localization } from '../localization/localization';
import { ClashctlService } from '../infrastructure/clashctl/clashctlService';
import { ControllerClient, ControllerError } from '../infrastructure/clashctl/controllerClient';
import { redactText } from '../infrastructure/clashctl/redaction';
import { CommandError, CommandRunner } from '../infrastructure/process/commandRunner';
import { TargetRunner } from '../infrastructure/process/targetRunner';
import { controllerSecretKey, readTargetSettings, targetConfigured, targetLabel } from '../infrastructure/storage/settings';

export class DashboardManager implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<DashboardState>();
  private settings: TargetSettings;
  private currentState: DashboardState;
  private refreshPromise?: Promise<void>;
  private operationQueue: Promise<void> = Promise.resolve();
  private activeController?: ControllerClient;
  private lastTotals?: { upload: number; download: number; at: number };
  private memorySecret?: { key: string; value: string };
  private disposed = false;

  public readonly onDidChange = this.changeEmitter.event;

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly localization: Localization,
    private readonly output: vscode.OutputChannel
  ) {
    this.settings = readTargetSettings();
    this.currentState = this.initialState();
  }

  public get state(): Readonly<DashboardState> {
    return this.currentState;
  }

  public get currentSettings(): Readonly<TargetSettings> {
    return this.settings;
  }

  public dispose(): void {
    this.disposed = true;
    this.changeEmitter.dispose();
  }

  public reloadSettings(): void {
    const previousTarget = `${this.settings.transport}:${this.settings.sshTarget}`;
    this.settings = readTargetSettings();
    this.localization.reload(this.settings.language);
    if (previousTarget !== `${this.settings.transport}:${this.settings.sshTarget}`) {
      this.activeController = undefined;
      this.lastTotals = undefined;
      this.memorySecret = undefined;
      this.currentState = this.initialState();
    } else {
      this.currentState = {
        ...this.currentState,
        configured: targetConfigured(this.settings),
        targetLabel: targetLabel(this.settings),
        settings: this.publicSettings()
      };
    }
    this.emit();
  }

  public refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.performRefresh().finally(() => { this.refreshPromise = undefined; });
    return this.refreshPromise;
  }

  public runDoctor(): Promise<void> {
    return this.enqueue('doctor', async service => {
      this.currentState = { ...this.currentState, diagnostic: await service.doctor() };
    });
  }

  public toggleProxy(): Promise<void> {
    const running = this.currentState.status?.lifecycle === 'running';
    return this.enqueue(running ? 'stop' : 'start', async service => {
      if (running) await service.stop();
      else await service.start();
    });
  }

  public switchSubscription(name: string): Promise<void> {
    const allowed = this.currentState.subscriptions.some(item => item.name === name);
    if (!allowed) return Promise.reject(new Error('Subscription is not in the current target list'));
    return this.enqueue('switchSubscription', service => service.switchSubscription(name));
  }

  public selectProxy(group: string, name: string): Promise<void> {
    const allowed = this.currentState.proxyGroups.some(item => item.name === group && item.all.includes(name));
    if (!allowed) return Promise.reject(new Error('Proxy selection is not in the current Controller snapshot'));
    return this.enqueueController('selectProxy', client => client.selectProxy(group, name));
  }

  public setMode(mode: OperationMode): Promise<void> {
    return this.enqueueController('setMode', client => client.setMode(mode));
  }

  public closeConnection(id: string): Promise<void> {
    const allowed = this.currentState.connections.some(item => item.id === id);
    if (!allowed) return Promise.reject(new Error('Connection is not in the current Controller snapshot'));
    return this.enqueueController('closeConnection', client => client.closeConnection(id));
  }

  public closeAllConnections(): Promise<void> {
    return this.enqueueController('closeAllConnections', client => client.closeAllConnections());
  }

  public async saveControllerSecret(secret: string): Promise<void> {
    const baseUrl = this.controllerUrl(this.currentState.status);
    if (!baseUrl) throw new Error('Controller URL is not available');
    const key = controllerSecretKey(this.settings, baseUrl);
    await this.context.secrets.store(key, secret);
    this.memorySecret = { key, value: secret };
    await this.refreshController(baseUrl, this.currentState.status);
  }

  public async clearControllerSecret(): Promise<void> {
    const baseUrl = this.controllerUrl(this.currentState.status);
    if (!baseUrl) return;
    const key = controllerSecretKey(this.settings, baseUrl);
    await this.context.secrets.delete(key);
    this.memorySecret = undefined;
    this.activeController = undefined;
    await this.refresh();
  }

  public async getLogs(): Promise<string> {
    const service = this.createClashctlService();
    return service.logs();
  }

  private async performRefresh(): Promise<void> {
    if (!targetConfigured(this.settings)) {
      this.currentState = this.initialState();
      this.emit();
      return;
    }

    this.currentState = { ...this.currentState, loading: true, error: undefined, configured: true, targetLabel: targetLabel(this.settings), settings: this.publicSettings() };
    this.emit();

    const service = this.createClashctlService();
    const [statusResult, subscriptionsResult] = await Promise.allSettled([service.status(), service.subscriptions()]);
    if (statusResult.status === 'rejected') {
      this.currentState = {
        ...this.currentState,
        loading: false,
        partial: true,
        error: this.safeError(statusResult.reason),
        lastUpdated: Date.now()
      };
      this.emit();
      return;
    }

    const status = statusResult.value;
    this.currentState = {
      ...this.currentState,
      status,
      subscriptions: subscriptionsResult.status === 'fulfilled' ? subscriptionsResult.value : [],
      loading: false,
      partial: subscriptionsResult.status === 'rejected',
      error: undefined,
      lastUpdated: Date.now()
    };
    this.emit();

    const baseUrl = this.controllerUrl(status);
    if (baseUrl) await this.refreshController(baseUrl, status);
    else {
      this.activeController = undefined;
      const controller = { ...emptyControllerSnapshot(), error: 'Controller URL was not discovered' };
      this.currentState = { ...this.currentState, controller, proxyGroups: [], providers: [], connections: [], rules: [] };
      this.emit();
    }
  }

  private async refreshController(baseUrl: string, status?: ProxyStatus): Promise<void> {
    try {
      const key = controllerSecretKey(this.settings, baseUrl);
      let secret = this.memorySecret?.key === key ? this.memorySecret.value : await this.context.secrets.get(key);
      let client = new ControllerClient(baseUrl, secret, Math.min(this.settings.commandTimeoutMs, 10_000));
      let snapshot;
      try {
        snapshot = await client.snapshot();
      } catch (error) {
        if (!secret && this.settings.controllerAutoDiscover && error instanceof ControllerError && error.statusCode === 401) {
          secret = await this.createClashctlService().controllerSecret();
          if (secret) {
            this.memorySecret = { key, value: secret };
            client = new ControllerClient(baseUrl, secret, Math.min(this.settings.commandTimeoutMs, 10_000));
            snapshot = await client.snapshot();
          } else throw error;
        } else throw error;
      }

      this.activeController = client;
      const now = Date.now();
      const elapsedSeconds = this.lastTotals ? Math.max((now - this.lastTotals.at) / 1000, 0.001) : 0;
      const uploadSpeed = snapshot.uploadSpeed || (this.lastTotals && snapshot.uploadTotal >= this.lastTotals.upload ? (snapshot.uploadTotal - this.lastTotals.upload) / elapsedSeconds : 0);
      const downloadSpeed = snapshot.downloadSpeed || (this.lastTotals && snapshot.downloadTotal >= this.lastTotals.download ? (snapshot.downloadTotal - this.lastTotals.download) / elapsedSeconds : 0);
      this.lastTotals = { upload: snapshot.uploadTotal, download: snapshot.downloadTotal, at: now };
      this.currentState = {
        ...this.currentState,
        status: status ?? this.currentState.status,
        controller: snapshot,
        proxyGroups: snapshot.proxyGroups,
        providers: snapshot.providers,
        connections: snapshot.connections,
        rules: snapshot.rules,
        metrics: { uploadSpeed, downloadSpeed, memory: snapshot.memory },
        partial: this.currentState.partial || Boolean(snapshot.error)
      };
    } catch (error) {
      this.activeController = undefined;
      const controller = { ...emptyControllerSnapshot(), error: this.safeError(error) };
      this.currentState = { ...this.currentState, controller, proxyGroups: [], providers: [], connections: [], rules: [], partial: true };
    }
    this.emit();
  }

  private enqueue(operation: string, action: (service: ClashctlService) => Promise<void>): Promise<void> {
    const queued = this.operationQueue.then(async () => {
      this.currentState = { ...this.currentState, busy: true };
      this.emit();
      this.audit('started', operation);
      try {
        await action(this.createClashctlService());
        this.audit('completed', operation);
      } catch (error) {
        this.audit('failed', operation, this.safeError(error));
        throw error;
      } finally {
        this.currentState = { ...this.currentState, busy: false };
        this.emit();
      }
      await this.refresh();
    });
    this.operationQueue = queued.catch(() => undefined);
    return queued;
  }

  private enqueueController(operation: string, action: (client: ControllerClient) => Promise<void>): Promise<void> {
    return this.enqueue(operation, async () => {
      if (!this.activeController) throw new Error('Controller is unavailable');
      await action(this.activeController);
    });
  }

  private createClashctlService(): ClashctlService {
    const runner = new TargetRunner(new CommandRunner(), this.settings);
    return new ClashctlService(runner, this.settings);
  }

  private controllerUrl(status?: ProxyStatus): string | undefined {
    if (this.settings.controllerUrl) return this.settings.controllerUrl;
    if (!this.settings.controllerAutoDiscover) return undefined;
    return this.settings.transport === 'ssh'
      ? status?.controllerLanUrl ?? status?.controllerLocalUrl
      : status?.controllerLocalUrl ?? status?.controllerLanUrl;
  }

  private initialState(): DashboardState {
    return {
      configured: targetConfigured(this.settings),
      targetLabel: targetLabel(this.settings),
      loading: false,
      busy: false,
      partial: false,
      subscriptions: [],
      controller: emptyControllerSnapshot(),
      proxyGroups: [],
      providers: [],
      connections: [],
      rules: [],
      metrics: { uploadSpeed: 0, downloadSpeed: 0, memory: 0 },
      settings: this.publicSettings()
    };
  }

  private publicSettings(): DashboardState['settings'] {
    return {
      transport: this.settings.transport,
      language: this.settings.language,
      autoRefresh: this.settings.autoRefresh,
      showSensitiveAddresses: this.settings.showSensitiveAddresses
    };
  }

  private safeError(error: unknown): string {
    if (error instanceof CommandError) {
      const detail = error.result?.stderr || error.result?.stdout || error.message;
      return redactText(detail).trim().slice(0, 800) || error.message;
    }
    return redactText(error instanceof Error ? error.message : String(error)).slice(0, 800);
  }

  private audit(state: 'started' | 'completed' | 'failed', operation: string, error?: string): void {
    const key = `settings.audit.${state}`;
    const operationLabel = this.localization.t(`settings.operation.${operation}`);
    this.output.appendLine(`[${new Date().toISOString()}] ${this.localization.t(key, { operation: operationLabel, target: targetLabel(this.settings), error })}`);
  }

  private emit(): void {
    if (!this.disposed) this.changeEmitter.fire(this.currentState);
  }
}
