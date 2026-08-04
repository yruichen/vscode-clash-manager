import { DiagnosticReport, ProxyStatus, Subscription } from '../../domain/entities/dashboard';
import { cleanLine, redactText, stripAnsi } from './redaction';

const valueAfter = (text: string, labels: readonly string[]): string | undefined => {
  const normalized = stripAnsi(text);
  for (const label of labels) {
    const line = normalized.split(/\r?\n/).find(item => item.includes(label));
    if (!line) continue;
    const index = line.indexOf(label);
    const value = cleanLine(line.slice(index + label.length).replace(/^\s*[：:]\s*/, ''));
    if (value) return value;
  }
  return undefined;
};

const exactValueAfter = (text: string, labels: readonly string[]): string | undefined => {
  const lines = stripAnsi(text).split(/\r?\n/);
  for (const line of lines) {
    const normalized = line.replace(/^\s*[^\p{L}\p{N}]*/u, '').trim();
    for (const label of labels) {
      const match = normalized.match(new RegExp(`^${label}\\s*[：:]\\s*(.+)$`, 'i'));
      if (match?.[1]) return cleanLine(match[1]);
    }
  }
  return undefined;
};

const parseLifecycle = (text: string): ProxyStatus['lifecycle'] => {
  const status = valueAfter(text, ['代理状态', 'Proxy status'])?.toLowerCase() ?? '';
  if (/已开启|运行中|running|enabled|\bon\b/.test(status)) return 'running';
  if (/已关闭|未运行|stopped|disabled|\boff\b/.test(status)) return 'stopped';
  return 'unknown';
};

const parseRouting = (text: string): ProxyStatus['routing'] => {
  const availability = valueAfter(text, ['当前可用性', 'Availability'])?.toLowerCase() ?? '';
  if (/未自动接管|not.*take|manual/.test(availability)) return 'off';
  if (/已接管|taken over|system traffic.*proxied/.test(availability)) return 'on';
  return 'unknown';
};

const normalizeControllerUrl = (value?: string): string | undefined => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    url.pathname = url.pathname.replace(/\/ui\/?$/, '');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
};

export const parseStatus = (raw: string): ProxyStatus => ({
  lifecycle: parseLifecycle(raw),
  reachability: valueAfter(raw, ['当前可用性', 'Availability']),
  routing: parseRouting(raw),
  subscription: valueAfter(raw, ['当前订阅', 'Current subscription']),
  node: valueAfter(raw, ['当前节点', 'Current node']),
  backend: valueAfter(raw, ['运行后端', 'Backend']),
  risk: valueAfter(raw, ['当前风险', 'Risk']),
  tun: valueAfter(raw, ['Tun 状态', 'Tun status']),
  lan: valueAfter(raw, ['局域网代理管理', 'LAN status']) ?? (valueAfter(raw, ['局域网代理', 'LAN proxy']) ? 'on' : undefined),
  localProxy: valueAfter(raw, ['本地代理', 'Local proxy']),
  lanProxy: valueAfter(raw, ['局域网代理', 'LAN proxy']),
  controllerLocalUrl: normalizeControllerUrl(exactValueAfter(raw, ['控制台', 'Dashboard'])),
  controllerLanUrl: normalizeControllerUrl(exactValueAfter(raw, ['局域网', 'LAN dashboard'])),
  dns: valueAfter(raw, ['DNS']),
  systemProxy: valueAfter(raw, ['系统代理持久接管', 'System proxy'])
});

export const parseSubscriptions = (raw: string): Subscription[] => {
  const lines = stripAnsi(raw).split(/\r?\n/);
  const subscriptions: Subscription[] = [];
  for (const line of lines) {
    const match = line.match(/^\s*(\*)?\s*([^\s]+)\s+([^\s]+)\s+(?:https?:\/\/|file:|local\b)/i);
    if (!match) continue;
    subscriptions.push({ name: match[2], type: match[3], active: Boolean(match[1]), enabled: true });
  }
  const recommended = valueAfter(raw, ['推荐订阅', 'Recommended subscription']);
  for (const item of subscriptions) item.recommended = item.name === recommended;
  return subscriptions;
};

const linesUnder = (raw: string, headingPatterns: readonly RegExp[]): string[] => {
  const lines = stripAnsi(raw).split(/\r?\n/);
  let active = false;
  const result: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^【.+】$/.test(trimmed)) {
      if (active) break;
      active = headingPatterns.some(pattern => pattern.test(trimmed));
      continue;
    }
    if (!active || !trimmed) continue;
    const cleaned = cleanLine(redactText(trimmed));
    if (cleaned) result.push(cleaned);
  }
  return result;
};

export const parseDoctor = (raw: string): DiagnosticReport => {
  const summary = linesUnder(raw, [/总体结论/, /Summary/i])[0] ?? cleanLine(redactText(raw.split(/\r?\n/).find(Boolean) ?? ''));
  const findings = linesUnder(raw, [/发现的问题/, /Findings/i]);
  const evidence = linesUnder(raw, [/关键证据/, /Evidence/i]);
  const advice = linesUnder(raw, [/修复建议/, /Advice|Recommendations/i]);
  const severity = valueAfter(raw, ['风险等级', 'Risk level']) ?? valueAfter(raw, ['当前风险', 'Risk']) ?? 'unknown';
  return { severity, summary, findings, evidence, advice };
};

export const parseControllerSecret = (raw: string): string | undefined => {
  const plain = stripAnsi(raw);
  for (const line of plain.split(/\r?\n/)) {
    if (!/secret|密钥/i.test(line)) continue;
    const candidate = line.replace(/^.*?(?:secret|密钥)\s*[：:=]\s*/i, '').trim();
    if (/^(?:已设置|未设置|set|unset|configured|none)$/i.test(candidate)) continue;
    if (/^[A-Za-z0-9._~+/=-]{8,256}$/.test(candidate)) return candidate;
  }
  const tokens = plain.match(/[A-Za-z0-9._~+/=-]{16,256}/g) ?? [];
  return tokens.find(token => !/clash|secret|configured/i.test(token));
};
