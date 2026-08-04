# VS Code Clash Manager

[![CI](https://github.com/yruichen/vscode-clash-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/yruichen/vscode-clash-manager/actions/workflows/ci.yml)

A native VS Code sidebar for managing local and remote Clash/Mihomo instances.

## Features

- Native Activity Bar and Tree View UI
- Proxy lifecycle and current routing status
- Policy groups and node selection
- Subscription switching with URLs removed before UI state is created
- Provider-aware latency shown beside matching subscriptions and nodes
- Active connections and rules
- Network and diagnostic summaries
- Persistent proxy state in the VS Code status bar
- Local and OpenSSH targets
- English by default, with Simplified Chinese available

## Getting started

Install a downloaded release from a terminal:

```bash
code --install-extension ./vscode-clash-manager.vsix
```

Then:

1. Open **Clash Manager** from the Activity Bar.
2. Select **Configure Target** from the view toolbar.
3. Choose the local machine or an existing OpenSSH host alias.
4. Use the native tree items and context actions to manage the target.

The extension reuses your OpenSSH configuration and agent. It never stores SSH private keys. Controller secrets are stored with VS Code SecretStorage, and subscription URLs are removed before data reaches the UI or logs.

This extension manages an existing Clash/Mihomo installation; it does not include a proxy kernel.

## Requirements

- VS Code 1.90 or newer
- Node.js 20 when building from source
- `clashctl` installed on the selected local or SSH target
- Mihomo Controller access for policy groups, provider latency, connections and rules

## Security

- Subscription URLs are discarded when `clashctl` output is parsed.
- Controller secrets use VS Code SecretStorage.
- OpenSSH handles remote authentication; private keys are never copied into the extension.
- Commands are executed without a shell and remote arguments are quoted as individual values.

Please report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/yruichen/vscode-clash-manager/security/advisories/new), not a public issue.

## Development

```bash
npm ci
npm test
npm run package
```

The packaged extension is written to `vscode-clash-manager.vsix` and is intentionally ignored by Git.

## License

Released under the [MIT License](LICENSE.txt).
