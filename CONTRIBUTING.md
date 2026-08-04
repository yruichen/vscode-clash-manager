# Contributing

Contributions are welcome through focused issues and pull requests. By contributing, you agree that your work will be distributed under the MIT License.

## Development workflow

1. Use Node.js 20 and a current npm release.
2. Install locked dependencies with `npm ci`.
3. Keep all user-facing text in `l10n/en` and `l10n/zh-CN`.
4. Run `npm test` before opening a pull request.
5. Keep commits focused, use clear commit messages and explain user-visible behavior in the pull request.

## Security rules

- Never commit subscription URLs, Controller secrets, tokens, private keys or raw target output.
- Never add real SSH hosts, usernames or private network addresses to fixtures.
- Preserve `shell: false` for process execution and validate all values crossing a command boundary.
- Use read-only integration checks unless a test explicitly documents and obtains approval for a write operation.

Use GitHub private vulnerability reporting for security issues.
