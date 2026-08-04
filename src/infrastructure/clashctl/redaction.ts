const ANSI_PATTERN = /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
const URL_PATTERN = /\bhttps?:\/\/[^\s<>'"]+/gi;
const SECRET_ASSIGNMENT_PATTERN = /\b(token|secret|password|authorization)\s*[:=]\s*[^\s,;]+/gi;

export const stripAnsi = (value: string): string => value.replace(ANSI_PATTERN, '');

export const redactText = (value: string): string => stripAnsi(value)
  .replace(URL_PATTERN, url => {
    try {
      const parsed = new URL(url);
      parsed.username = parsed.username ? '[redacted]' : '';
      parsed.password = parsed.password ? '[redacted]' : '';
      if (parsed.search) parsed.search = '?[redacted]';
      return parsed.toString();
    } catch {
      return '[redacted-url]';
    }
  })
  .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
  .replace(SECRET_ASSIGNMENT_PATTERN, '$1=[redacted]');

export const cleanLine = (value: string): string => stripAnsi(value)
  .replace(/^\s*[✔⚠❗🔍💡👉🐱🚨📜🧰🚩📡🔧🚦🧪🧩🔐🌐🏠🌍🚀⛔➕💱💫🔗🕹️🩺]+\s*/u, '')
  .trim();
