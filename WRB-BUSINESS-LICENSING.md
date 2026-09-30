# WRB-TV Device Licensing

Branch: `feature/wrb-business-device-license`

## Application flow
1. The player obtains its device ID before showing the login form.
2. It calls the public licensing API:
   `POST /api/v1/device/check`
3. If `authorized=true`, the login screen is released.
4. Otherwise the user sees:
   **Para realizar a ativação, entre em contato com seu fornecedor.**
5. The device ID can be copied from the gate screen.

## Current API server
The implementation is a Netlify Function at `netlify/functions/licensing.mjs` using Netlify Blobs for persistence. Netlify documents `@netlify/blobs` as persistent site-wide storage that can be used from Functions. The package is declared in `package.json`.

## Required environment variable
Configure `LICENSE_ADMIN_TOKEN` in the deployed Netlify site. It is used only for administrative activate/deactivate operations. Do not put this token into the player or browser frontend.

## Player configuration
In `public/index.html`, replace:
`window.WRB_LICENSE_API_BASE = "__SET_AFTER_NETLIFY_DEPLOY__";`
with the public HTTPS base URL of the license API site.

The player never sends the IPTV password during this pre-login check.

## API
### Public
POST `/api/v1/device/check`
Body:
```json
{"device_id":"72:A0:44:4F:80:31","app_id":"wrbtv-player","app_version":"2.0.45","platform":"Windows"}
```

Unknown IDs are automatically recorded as `pending`, so the master panel can later see new devices.

### Administrative
POST to the same function with:
```json
{"action":"activate","device_id":"72:A0:44:4F:80:31"}
```
or `deactivate`, with header:
`Authorization: Bearer <LICENSE_ADMIN_TOKEN>`

For production, the web panel should call these administrative operations from its own authenticated backend, not expose the admin token in JavaScript.
