# Plan for Adding Proxy Support

Introduce configurable proxy support (HTTP/SOCKS) so all network requests issued by the extension (and shared packages) can be routed through a user-specified proxy. This requires:

- New user setting to specify a proxy URL.
- Persisting this value in `GlobalSettings`.
- Configuring global HTTP/HTTPS/SOCKS agents for Node’s `fetch` and `axios`.
- Using the proxy during extension activation before any network operations occur.

## Steps

1. Add Proxy Setting to Types
    - File: `packages/types/src/global-settings.ts`
    - Update `globalSettingsSchema` with a new optional string field `proxyUrl`.
    - Include this key in `GLOBAL_SETTINGS_KEYS`.
    - Export updated type definitions.
2. Expose Setting in Extension Configuration
    - File: `src/package.json`
    - Under `contributes.configuration.properties`, add:
    - `"roo-cline.proxyUrl": { "type": "string", "default": "", "description": "%settings.proxyUrl.description%" }`
    - Add `"proxy-agent"` to dependencies.
3. Localization
    - Add `"settings.proxyUrl.description"` entry to all `package.nls*.json` files (use an English description such as “Proxy URL used for HTTP/SOCKS requests. Leave empty to disable.” for languages lacking a translation).
4. Implement Proxy Setup Utility
    - New file: `src/utils/proxy.ts`
    - Create `setupProxy(proxyUrl?: string)`:
        - Resolve proxy URL from argument, setting, or env vars (`ROO_CODE_PROXY_URL`, `HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY`).
        - If defined, initialize `ProxyAgent` from `proxy-agent`.
        - Call `setGlobalDispatcher(agent)` from `undici` to patch global `fetch`.
        - Configure `axios.defaults.httpAgent` / `axios.defaults.httpsAgent` and set `axios.defaults.proxy = false`.
5. Activate Proxy Early
    - File: `src/extension.ts`
    - Before initializing `CloudService` or other network services:
        - Read `roo-cline.proxyUrl` from `vscode.workspace.getConfiguration`.
        - Call `setupProxy(proxyUrl)`.
6. Update ContextProxy (optional but recommended)
    - Ensure `ContextProxy.getGlobalSettings()` returns the new `proxyUrl`.
    - Persist the setting via `ContextProxy.setValues` when user changes configuration.
7. Documentation
    - Mention the new proxy setting in `README.md` under configuration options.
8. Testing
    - Run existing tests (`pnpm test`) to ensure no regressions.
    - (If new tests are desired) create a minimal test verifying `setupProxy` sets axios agents and undici dispatcher when `proxyUrl` is provided.

This plan introduces a configurable proxy mechanism that covers HTTP and SOCKS protocols and applies globally to all network traffic initiated by the extension.
