import { TargetSettings } from '../../domain/entities/dashboard';
import { CommandResult, CommandRunner, quotePosixArg } from './commandRunner';

export class TargetRunner {
  public constructor(
    private readonly commandRunner: CommandRunner,
    private readonly settings: TargetSettings
  ) {}

  public run(executable: string, args: readonly string[], timeoutMs = this.settings.commandTimeoutMs, maxOutputBytes?: number): Promise<CommandResult> {
    if (this.settings.transport === 'local') {
      return this.commandRunner.run({ executable, args, timeoutMs, maxOutputBytes });
    }

    if (!this.settings.sshTarget.trim()) throw new Error('SSH target is not configured');
    const remoteCommand = [executable, ...args].map(quotePosixArg).join(' ');
    return this.commandRunner.run({
      executable: 'ssh',
      args: [
        '-o', 'BatchMode=yes',
        '-o', `ConnectTimeout=${Math.max(2, Math.ceil(timeoutMs / 1000))}`,
        '--',
        this.settings.sshTarget,
        remoteCommand
      ],
      timeoutMs: timeoutMs + 1000,
      maxOutputBytes
    });
  }
}
