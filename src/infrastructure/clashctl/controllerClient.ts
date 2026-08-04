import * as http from 'node:http';
import * as https from 'node:https';
import {
  ActiveConnection,
  ClashRule,
  ControllerSnapshot,
  OperationMode,
  ProxyGroup,
  ProxyProvider,
  emptyControllerSnapshot
} from '../../domain/entities/dashboard';

interface RawProxy {
  type?: string;
  now?: string;
  all?: string[];
  history?: Array<{ delay?: number }>;
}

export interface ControllerRequestSpec {
  pathname: string;
  method: string;
  body?: unknown;
  stream: boolean;
}

export type ControllerRequestHandler = (request: ControllerRequestSpec) => Promise<Record<string, unknown>>;

export class ControllerError extends Error {
  public constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'ControllerError';
  }
}

export class ControllerClient {
  public constructor(
    private readonly baseUrl: string,
    private readonly secret: string | undefined,
    private readonly timeoutMs: number,
    private readonly requestHandler?: ControllerRequestHandler
  ) {
    const parsed = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Controller URL must use HTTP or HTTPS');
    if (parsed.username || parsed.password || parsed.search) throw new Error('Controller URL must not contain credentials or query parameters');
  }

  public async snapshot(): Promise<ControllerSnapshot> {
    const [versionResult, configResult, proxyResult, providerResult, connectionResult, ruleResult, trafficResult, memoryResult] = await Promise.allSettled([
      this.requestJson('/version'),
      this.requestJson('/configs'),
      this.requestJson('/proxies'),
      this.requestJson('/providers/proxies'),
      this.requestJson('/connections'),
      this.requestJson('/rules'),
      this.requestStreamSample('/traffic'),
      this.requestStreamSample('/memory')
    ]);

    if (versionResult.status === 'rejected' && configResult.status === 'rejected') {
      const reason = versionResult.reason instanceof Error ? versionResult.reason : configResult.reason;
      throw reason instanceof Error ? reason : new ControllerError('Controller is unavailable');
    }

    const versionRaw = versionResult.status === 'fulfilled' ? versionResult.value : {};
    const configRaw = configResult.status === 'fulfilled' ? configResult.value : {};
    const proxyRaw = proxyResult.status === 'fulfilled' ? proxyResult.value : {};
    const providerRaw = providerResult.status === 'fulfilled' ? providerResult.value : {};
    const connectionRaw = connectionResult.status === 'fulfilled' ? connectionResult.value : {};
    const ruleRaw = ruleResult.status === 'fulfilled' ? ruleResult.value : {};
    const trafficRaw = trafficResult.status === 'fulfilled' ? trafficResult.value : {};
    const memoryRaw = memoryResult.status === 'fulfilled' ? memoryResult.value : {};

    const snapshot = emptyControllerSnapshot();
    snapshot.connected = true;
    snapshot.version = this.stringValue(versionRaw, ['version']);
    snapshot.mode = this.modeValue(configRaw);
    snapshot.proxyGroups = this.parseProxyGroups(proxyRaw);
    snapshot.providers = this.parseProviders(providerRaw);
    snapshot.connections = this.parseConnections(connectionRaw);
    snapshot.rules = this.parseRules(ruleRaw);
    snapshot.uploadTotal = this.numberValue(connectionRaw, ['uploadTotal']);
    snapshot.downloadTotal = this.numberValue(connectionRaw, ['downloadTotal']);
    snapshot.uploadSpeed = this.numberValue(trafficRaw, ['up']);
    snapshot.downloadSpeed = this.numberValue(trafficRaw, ['down']);
    snapshot.memory = this.numberValue(memoryRaw, ['inuse', 'memory']);
    return snapshot;
  }

  public async selectProxy(group: string, name: string): Promise<void> {
    this.validateText(group);
    this.validateText(name);
    await this.requestJson(`/proxies/${encodeURIComponent(group)}`, 'PUT', { name });
  }

  public async setMode(mode: OperationMode): Promise<void> {
    if (!['rule', 'global', 'direct'].includes(mode)) throw new Error('Invalid mode');
    await this.requestJson('/configs', 'PATCH', { mode });
  }

  public async closeConnection(id: string): Promise<void> {
    this.validateText(id);
    await this.requestJson(`/connections/${encodeURIComponent(id)}`, 'DELETE');
  }

  public async closeAllConnections(): Promise<void> {
    await this.requestJson('/connections', 'DELETE');
  }

  private requestJson(pathname: string, method = 'GET', body?: unknown): Promise<Record<string, unknown>> {
    if (this.requestHandler) return this.requestHandler({ pathname, method, body, stream: false });
    const url = new URL(pathname.replace(/^\//, ''), `${this.baseUrl.replace(/\/$/, '')}/`);
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8');
    const transport = url.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
      const request = transport.request(url, {
        method,
        headers: {
          Accept: 'application/json',
          ...(this.secret ? { Authorization: `Bearer ${this.secret}` } : {}),
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) } : {})
        }
      }, response => {
        const chunks: Buffer[] = [];
        let length = 0;
        response.on('data', (chunk: Buffer) => {
          length += chunk.length;
          if (length > 2 * 1024 * 1024) {
            request.destroy(new ControllerError('Controller response is too large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          const statusCode = response.statusCode ?? 0;
          const text = Buffer.concat(chunks).toString('utf8');
          if (statusCode < 200 || statusCode >= 300) {
            reject(new ControllerError(`Controller returned HTTP ${statusCode}`, statusCode));
            return;
          }
          if (!text.trim()) {
            resolve({});
            return;
          }
          try {
            const parsed = JSON.parse(text) as unknown;
            resolve(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {});
          } catch {
            reject(new ControllerError('Controller returned invalid JSON', statusCode));
          }
        });
      });

      request.setTimeout(this.timeoutMs, () => request.destroy(new ControllerError('Controller request timed out')));
      request.on('error', reject);
      if (payload) request.write(payload);
      request.end();
    });
  }

  private requestStreamSample(pathname: string): Promise<Record<string, unknown>> {
    if (this.requestHandler) return this.requestHandler({ pathname, method: 'GET', stream: true });
    const url = new URL(pathname.replace(/^\//, ''), `${this.baseUrl.replace(/\/$/, '')}/`);
    const transport = url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      let settled = false;
      let buffer = '';
      const finish = (value: Record<string, unknown>): void => {
        if (settled) return;
        settled = true;
        resolve(value);
        request.destroy();
      };
      const request = transport.request(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...(this.secret ? { Authorization: `Bearer ${this.secret}` } : {})
        }
      }, response => {
        const statusCode = response.statusCode ?? 0;
        if (statusCode < 200 || statusCode >= 300) {
          settled = true;
          reject(new ControllerError(`Controller returned HTTP ${statusCode}`, statusCode));
          request.destroy();
          return;
        }
        response.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf8');
          if (buffer.length > 64 * 1024) {
            if (!settled) reject(new ControllerError('Controller stream sample is too large'));
            settled = true;
            request.destroy();
            return;
          }
          const candidate = buffer.split(/\r?\n/, 1)[0].trim();
          if (!candidate) return;
          try {
            const parsed = JSON.parse(candidate) as unknown;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) finish(parsed as Record<string, unknown>);
          } catch {
            // Wait for the rest of the first JSON line.
          }
        });
        response.on('end', () => {
          if (settled) return;
          try {
            const parsed = JSON.parse(buffer) as unknown;
            finish(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {});
          } catch {
            settled = true;
            reject(new ControllerError('Controller stream returned invalid JSON'));
          }
        });
      });
      request.setTimeout(Math.min(this.timeoutMs, 2_500), () => {
        if (!settled) reject(new ControllerError('Controller stream sample timed out'));
        settled = true;
        request.destroy();
      });
      request.on('error', error => { if (!settled) reject(error); });
      request.end();
    });
  }

  private parseProxyGroups(raw: Record<string, unknown>): ProxyGroup[] {
    const proxies = raw.proxies;
    if (!proxies || typeof proxies !== 'object' || Array.isArray(proxies)) return [];
    const entries = Object.entries(proxies as Record<string, RawProxy>);
    const delays: Record<string, number | undefined> = {};
    for (const [name, proxy] of entries) {
      const last = Array.isArray(proxy.history) ? proxy.history.at(-1) : undefined;
      delays[name] = typeof last?.delay === 'number' ? last.delay : undefined;
    }
    return entries
      .filter(([, proxy]) => Array.isArray(proxy.all))
      .map(([name, proxy]) => ({
        name,
        type: typeof proxy.type === 'string' ? proxy.type : 'Selector',
        now: typeof proxy.now === 'string' ? proxy.now : undefined,
        all: (proxy.all ?? []).filter((item): item is string => typeof item === 'string'),
        delays: Object.fromEntries((proxy.all ?? []).map(item => [item, delays[item]]))
      }));
  }

  private parseConnections(raw: Record<string, unknown>): ActiveConnection[] {
    if (!Array.isArray(raw.connections)) return [];
    return raw.connections.flatMap(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const value = item as Record<string, unknown>;
      if (typeof value.id !== 'string') return [];
      const metadataRaw = value.metadata && typeof value.metadata === 'object' && !Array.isArray(value.metadata)
        ? value.metadata as Record<string, unknown>
        : {};
      const metadata = {
        host: this.optionalString(metadataRaw.host),
        destinationIP: this.optionalString(metadataRaw.destinationIP),
        destinationPort: this.optionalString(metadataRaw.destinationPort),
        network: this.optionalString(metadataRaw.network),
        type: this.optionalString(metadataRaw.type),
        process: this.optionalString(metadataRaw.process)
      };
      return [{
        id: value.id,
        metadata,
        upload: typeof value.upload === 'number' ? value.upload : 0,
        download: typeof value.download === 'number' ? value.download : 0,
        rule: this.optionalString(value.rule),
        chains: Array.isArray(value.chains) ? value.chains.filter((chain): chain is string => typeof chain === 'string') : []
      }];
    });
  }

  private parseProviders(raw: Record<string, unknown>): ProxyProvider[] {
    if (!raw.providers || typeof raw.providers !== 'object' || Array.isArray(raw.providers)) return [];
    return Object.entries(raw.providers as Record<string, unknown>).flatMap(([key, entry]) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
      const provider = entry as Record<string, unknown>;
      const proxies = Array.isArray(provider.proxies) ? provider.proxies : [];
      const nodes = proxies.flatMap(proxyEntry => {
        if (!proxyEntry || typeof proxyEntry !== 'object' || Array.isArray(proxyEntry)) return [];
        const proxy = proxyEntry as Record<string, unknown>;
        if (typeof proxy.name !== 'string') return [];
        const history = Array.isArray(proxy.history) ? proxy.history : [];
        const latest = history.at(-1);
        const delay = latest && typeof latest === 'object' && !Array.isArray(latest) && typeof (latest as Record<string, unknown>).delay === 'number'
          ? (latest as Record<string, unknown>).delay as number
          : undefined;
        return [{ name: proxy.name, delay }];
      });
      return [{
        name: this.optionalString(provider.name) ?? key,
        type: this.optionalString(provider.type),
        vehicleType: this.optionalString(provider.vehicleType),
        updatedAt: this.optionalString(provider.updatedAt),
        nodes
      }];
    });
  }

  private parseRules(raw: Record<string, unknown>): ClashRule[] {
    if (!Array.isArray(raw.rules)) return [];
    return raw.rules.flatMap(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const value = item as Record<string, unknown>;
      if (typeof value.type !== 'string') return [];
      return [{
        type: value.type,
        payload: this.optionalString(value.payload) ?? '',
        proxy: this.optionalString(value.proxy) ?? ''
      }];
    });
  }

  private modeValue(raw: Record<string, unknown>): OperationMode | undefined {
    const mode = this.optionalString(raw.mode)?.toLowerCase();
    return mode === 'rule' || mode === 'global' || mode === 'direct' ? mode : undefined;
  }

  private stringValue(raw: Record<string, unknown>, keys: readonly string[]): string | undefined {
    for (const key of keys) {
      const value = this.optionalString(raw[key]);
      if (value) return value;
    }
    return undefined;
  }

  private numberValue(raw: Record<string, unknown>, keys: readonly string[]): number {
    for (const key of keys) if (typeof raw[key] === 'number') return raw[key];
    return 0;
  }

  private optionalString(value: unknown): string | undefined {
    return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
  }

  private validateText(value: string): void {
    if (!value || value.length > 512 || /[\r\n\0]/.test(value)) throw new Error('Invalid Controller selection');
  }
}
