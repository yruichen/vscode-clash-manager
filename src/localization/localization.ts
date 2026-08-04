import * as fs from 'node:fs';
import * as path from 'node:path';

export type Locale = 'en' | 'zh-CN';
export type Messages = Record<string, string>;

const CATALOG_FILES = ['common.json', 'sidebar.json', 'statusbar.json', 'commands.json', 'settings.json'];

export class Localization {
  private messages: Messages = {};

  public constructor(private readonly extensionPath: string, private locale: Locale) {
    this.reload(locale);
  }

  public get language(): Locale {
    return this.locale;
  }

  public get catalog(): Readonly<Messages> {
    return this.messages;
  }

  public reload(locale: Locale): void {
    this.locale = locale;
    const english = this.loadCatalog('en');
    this.messages = locale === 'en' ? english : { ...english, ...this.loadCatalog(locale) };
  }

  public t(key: string, values: Record<string, string | number | boolean | undefined> = {}): string {
    let message = this.messages[key] ?? key;
    for (const [name, value] of Object.entries(values)) {
      message = message.replaceAll(`{${name}}`, String(value ?? ''));
    }
    return message;
  }

  private loadCatalog(locale: Locale): Messages {
    const messages: Messages = {};
    for (const file of CATALOG_FILES) {
      const filePath = path.join(this.extensionPath, 'l10n', locale, file);
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`Invalid localization catalog: ${filePath}`);
      }
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value !== 'string') throw new Error(`Invalid localization value: ${key}`);
        messages[key] = value;
      }
    }
    return messages;
  }
}
