import { spawn } from 'node:child_process';

export interface CommandSpec {
  executable: string;
  args: readonly string[];
  timeoutMs: number;
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  truncated: boolean;
}

export class CommandError extends Error {
  public constructor(
    message: string,
    public readonly result?: CommandResult,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

export class CommandRunner {
  public run(spec: CommandSpec): Promise<CommandResult> {
    const maxOutputBytes = spec.maxOutputBytes ?? 1024 * 1024;
    return new Promise((resolve, reject) => {
      const stdoutChunks: Uint8Array[] = [];
      const stderrChunks: Uint8Array[] = [];
      let stdoutLength = 0;
      let stderrLength = 0;
      let truncated = false;
      let timedOut = false;
      let settled = false;

      const child = spawn(spec.executable, [...spec.args], {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, TERM: 'dumb', NO_COLOR: '1', ...spec.env }
      });

      const append = (chunks: Uint8Array[], currentLength: number, chunk: Buffer): number => {
        if (currentLength >= maxOutputBytes) {
          truncated = true;
          return currentLength;
        }
        const remaining = maxOutputBytes - currentLength;
        if (chunk.length > remaining) truncated = true;
        chunks.push(chunk.subarray(0, remaining));
        return currentLength + Math.min(chunk.length, remaining);
      };

      child.stdout.on('data', (chunk: Buffer) => { stdoutLength = append(stdoutChunks, stdoutLength, chunk); });
      child.stderr.on('data', (chunk: Buffer) => { stderrLength = append(stderrChunks, stderrLength, chunk); });

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 600).unref();
      }, spec.timeoutMs);

      child.on('error', error => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new CommandError(error.message, undefined, (error as NodeJS.ErrnoException).code));
      });

      child.on('close', code => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        const result: CommandResult = {
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
          exitCode: code ?? -1,
          timedOut,
          truncated
        };
        if (timedOut) reject(new CommandError('Command timed out', result, 'ETIMEDOUT'));
        else if (result.exitCode !== 0) reject(new CommandError(`Command exited with code ${result.exitCode}`, result));
        else resolve(result);
      });
    });
  }
}

const POSIX_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

export const quotePosixArg = (value: string): string => {
  if (value.length === 0) return "''";
  if (POSIX_SAFE.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
};
