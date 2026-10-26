---
name: secure-coding
description: Guardrails for code that handles users, input, secrets or money.
triggers: [auth, login, password, token, session, upload, payment, form, input, validation, api, permission]
risk: high
---
- Validate and sanitize all external input on the server, not only in the UI.
- Never log or return secrets, tokens or full error stacks to clients.
- Check authorization on every route that reads or changes user data.
- Use parameterized queries; never build SQL or shell commands from user input.
- Prefer existing, maintained libraries for auth and crypto; do not write your own.
