# Turbopack Tracing Viewer

A self-hosted `trace.nextjs.org`-compatible service for Turbopack trace files. It mirrors the public trace viewer UI, adds a drag-and-drop upload layer, starts a matching `turbo-trace-server` for each uploaded trace, and proxies the viewer WebSocket to that per-upload server.

The trace server binary is expected to come from the `hardfist/bundler-diff` `main` release tag (`turbopack-cli-main`) so the reader matches the Turbopack version used to generate traces.

## Quick start

```bash
pnpm install
pnpm start
# open http://localhost:3000 and drop a trace file
```

By default the service downloads:

- viewer assets from `https://trace.nextjs.org/`
- `turbo-trace-server-linux-x64.tar.gz` from `https://github.com/hardfist/bundler-diff/releases/tag/turbopack-cli-main`

If you already have a local trace-server binary:

```bash
TURBO_TRACE_SERVER_BIN=/path/to/turbo-trace-server pnpm start
```

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port. |
| `HOST` | `0.0.0.0` | HTTP bind address. |
| `DATA_DIR` | `./var` | Uploaded traces, downloaded binary, mirrored viewer cache. |
| `TRACE_VIEWER_URL` | `https://trace.nextjs.org/` | Public viewer to mirror and patch. |
| `BUNDLER_DIFF_REPO` | `hardfist/bundler-diff` | GitHub repo that publishes the matching release. |
| `TRACE_SERVER_RELEASE_TAG` | `turbopack-cli-main` | Release tag to use. |
| `TRACE_SERVER_ASSET` | `turbo-trace-server-linux-x64.tar.gz` | Release asset containing `turbo-trace-server`. |
| `TURBO_TRACE_SERVER_BIN` | unset | Local binary override; skips release download. |
| `SESSION_TTL_MS` | `3600000` | Idle lifetime for uploaded trace sessions. |
| `MAX_UPLOAD_BYTES` | `1073741824` | Upload limit; defaults to 1 GiB. |

## Deployment

The app needs a long-lived Node process and WebSocket support. Do not deploy it as a serverless-only function.

### Docker

```bash
docker build -t turbopack-tracing .
docker run --rm -p 3000:3000 turbopack-tracing
```

The Docker image uses Ubuntu 24.04 so the GitHub Actions-built Rust binary from `bundler-diff` (currently requiring `GLIBC_2.39`) can run.

## How it works

1. On startup, the server mirrors `trace.nextjs.org` assets into `DATA_DIR/viewer-cache` and patches the bundled viewer WebSocket URL from `ws://localhost:<port>` to `/ws/<session>` on the same origin.
2. The injected upload layer accepts drag-and-drop or file picker uploads.
3. After upload, the backend starts `turbo-trace-server <uploaded-file> <local-port>` and redirects the browser to `/?session=<id>`.
4. The browser connects to `/ws/<id>`; the Node backend proxies frames to the local trace server.

## bundler-diff requirement

At the time this service was added, `hardfist/bundler-diff` published `turbopack-cli-linux-x64.tar.gz` only. The service expects the release workflow there to also publish `turbo-trace-server-linux-x64.tar.gz` from the same commit/tag.
