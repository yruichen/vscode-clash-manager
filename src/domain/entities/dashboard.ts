export type Transport = 'local' | 'ssh';
export type Lifecycle = 'running' | 'stopped' | 'unknown';
export type OperationMode = 'rule' | 'global' | 'direct';

export interface TargetSettings {
  transport: Transport;
  sshTarget: string;
  clashctlPath: string;
  commandTimeoutMs: number;
  controllerUrl: string;
  controllerAutoDiscover: boolean;
  language: 'en' | 'zh-CN';
  autoRefresh: boolean;
  refreshIntervalMs: number;
  showSensitiveAddresses: boolean;
}

export interface ProxyStatus {
  lifecycle: Lifecycle;
  reachability?: string;
  routing?: 'on' | 'off' | 'unknown';
  subscription?: string;
  node?: string;
  backend?: string;
  risk?: string;
  tun?: string;
  lan?: string;
  localProxy?: string;
  lanProxy?: string;
  controllerLocalUrl?: string;
  controllerLanUrl?: string;
  dns?: string;
  systemProxy?: string;
}

export interface Subscription {
  name: string;
  type?: string;
  active: boolean;
  enabled?: boolean;
  recommended?: boolean;
}

export interface DiagnosticReport {
  severity: string;
  summary: string;
  findings: string[];
  evidence: string[];
  advice: string[];
}

export interface ProxyGroup {
  name: string;
  type: string;
  now?: string;
  all: string[];
  delays: Record<string, number | undefined>;
}

export interface ProviderNode {
  name: string;
  delay?: number;
}

export interface ProxyProvider {
  name: string;
  type?: string;
  vehicleType?: string;
  updatedAt?: string;
  nodes: ProviderNode[];
}

export interface ConnectionMetadata {
  host?: string;
  destinationIP?: string;
  destinationPort?: string;
  network?: string;
  type?: string;
  process?: string;
}

export interface ActiveConnection {
  id: string;
  metadata?: ConnectionMetadata;
  upload: number;
  download: number;
  rule?: string;
  chains?: string[];
}

export interface ClashRule {
  type: string;
  payload: string;
  proxy: string;
}

export interface ControllerSnapshot {
  connected: boolean;
  version?: string;
  mode?: OperationMode;
  error?: string;
  proxyGroups: ProxyGroup[];
  providers: ProxyProvider[];
  connections: ActiveConnection[];
  rules: ClashRule[];
  uploadTotal: number;
  downloadTotal: number;
  uploadSpeed: number;
  downloadSpeed: number;
  memory: number;
}

export interface DashboardMetrics {
  uploadSpeed: number;
  downloadSpeed: number;
  memory: number;
}

export interface DashboardState {
  configured: boolean;
  targetLabel: string;
  loading: boolean;
  busy: boolean;
  partial: boolean;
  error?: string;
  lastUpdated?: number;
  status?: ProxyStatus;
  subscriptions: Subscription[];
  diagnostic?: DiagnosticReport;
  controller: ControllerSnapshot;
  proxyGroups: ProxyGroup[];
  providers: ProxyProvider[];
  connections: ActiveConnection[];
  rules: ClashRule[];
  metrics: DashboardMetrics;
  settings: Pick<TargetSettings, 'transport' | 'language' | 'autoRefresh' | 'showSensitiveAddresses'>;
}

export const emptyControllerSnapshot = (): ControllerSnapshot => ({
  connected: false,
  proxyGroups: [],
  providers: [],
  connections: [],
  rules: [],
  uploadTotal: 0,
  downloadTotal: 0,
  uploadSpeed: 0,
  downloadSpeed: 0,
  memory: 0
});
