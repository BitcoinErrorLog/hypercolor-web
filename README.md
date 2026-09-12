# Hypercolor (web)

Hypercolor is unavailable. The production application is terminally closed:
there is no product UI, session initialization, network client, storage flow, or
recovery path.

The root route renders the unavailable page. Former product routes were
removed and resolve through the terminal 404 page. The existing dependency
manifest contains only the dependencies required to build and verify this
terminally unavailable shell; no product dependency is loaded by the
application.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e -- e2e/unavailable.spec.ts
```
