import * as path from 'node:path';
import { DiagnosticReport, ProxyStatus, Subscription, TargetSettings } from '../../domain/entities/dashboard';
import { CommandError } from '../process/commandRunner';
import { TargetRunner } from '../process/targetRunner';
import { parseControllerSecret, parseDoctor, parseStatus, parseSubscriptions } from './parsers';
import { redactText } from './redaction';

export class ClashctlService {
  public constructor(
    private readonly runner: TargetRunner,
    private readonly settings: TargetSettings
  ) {}

  public async status(): Promise<ProxyStatus> {
    const result = await this.runner.run(this.settings.clashctlPath, ['status']);
    return parseStatus(result.stdout);
  }

  public async subscriptions(): Promise<Subscription[]> {
    const result = await this.runner.run(this.settings.clashctlPath, ['ls']);
    return parseSubscriptions(result.stdout);
  }

  public async doctor(): Promise<DiagnosticReport> {
    const result = await this.runner.run(this.settings.clashctlPath, ['doctor'], Math.max(this.settings.commandTimeoutMs, 30_000));
    return parseDoctor(result.stdout);
  }

  public async start(): Promise<void> {
    await this.runner.run(this.companionCommand('clashon'), []);
  }

  public async stop(): Promise<void> {
    await this.runner.run(this.companionCommand('clashoff'), []);
  }

  public async switchSubscription(name: string): Promise<void> {
    this.validateSelection(name);
    await this.runner.run(this.settings.clashctlPath, ['use', name], Math.max(this.settings.commandTimeoutMs, 30_000));
  }

  public async controllerSecret(): Promise<string | undefined> {
    const result = await this.runner.run(this.settings.clashctlPath, ['secret']);
    return parseControllerSecret(result.stdout);
  }

  public async logs(): Promise<string> {
    try {
      const result = await this.runner.run(this.settings.clashctlPath, ['logs'], 5_000, 256 * 1024);
      return redactText(`${result.stdout}\n${result.stderr}`.trim());
    } catch (error) {
      if (error instanceof CommandError && error.result?.stdout) return redactText(error.result.stdout);
      throw error;
    }
  }

  private companionCommand(name: string): string {
    const configured = this.settings.clashctlPath;
    if (configured.includes('/') || configured.includes('\\')) return path.join(path.dirname(configured), name);
    return name;
  }

  private validateSelection(value: string): void {
    if (!value || value.length > 256 || /[\r\n\0]/.test(value)) throw new Error('Invalid selection');
  }
}
