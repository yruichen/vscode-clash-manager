import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import { TargetSettings } from '../../domain/entities/dashboard';

export const readTargetSettings = (): TargetSettings => {
  const configuration = vscode.workspace.getConfiguration('clashManager');
  const transport = configuration.get<'local' | 'ssh'>('transport', 'local');
  const language = configuration.get<'en' | 'zh-CN'>('language', 'en');
  return {
    transport: transport === 'ssh' ? 'ssh' : 'local',
    sshTarget: configuration.get<string>('sshTarget', '').trim(),
    clashctlPath: configuration.get<string>('clashctlPath', 'clashctl').trim() || 'clashctl',
    commandTimeoutMs: Math.max(2, configuration.get<number>('commandTimeout', 12)) * 1000,
    controllerUrl: configuration.get<string>('controller.url', '').trim(),
    controllerAutoDiscover: configuration.get<boolean>('controller.autoDiscover', true),
    language: language === 'zh-CN' ? 'zh-CN' : 'en',
    autoRefresh: configuration.get<boolean>('autoRefresh', true),
    refreshIntervalMs: Math.max(2, configuration.get<number>('refreshInterval', 5)) * 1000,
    showSensitiveAddresses: configuration.get<boolean>('showSensitiveAddresses', false)
  };
};

export const targetConfigured = (settings: TargetSettings): boolean => settings.transport === 'local' || Boolean(settings.sshTarget);

export const targetLabel = (settings: TargetSettings): string => settings.transport === 'ssh' ? settings.sshTarget : 'localhost';

export const controllerSecretKey = (settings: TargetSettings, controllerUrl: string): string => {
  const identity = `${settings.transport}\0${settings.sshTarget}\0${controllerUrl}`;
  return `clashManager.controllerSecret.${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 24)}`;
};
