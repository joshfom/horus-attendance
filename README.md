# Horus Attendance

Desktop attendance management system built with Tauri v2, React, and SQLite. Syncs with ZKTeco biometric devices to track employee check-in/check-out, generate reports, and export to Excel.

## Download

Get the latest release for your platform:

**[→ Download Latest Release](https://github.com/joshfom/horus-attendance/releases/latest)**

| Platform | File |
|----------|------|
| macOS (Apple Silicon) | `.dmg` |
| macOS (Intel) | `.dmg` |
| Windows | `.msi` |
| Linux | `.deb` / `.AppImage` |

## Features

- Sync users and attendance logs from ZKTeco devices
- Weekly and monthly attendance reports with color-coded Excel export
- Configurable attendance rules (work hours, grace periods, workdays)
- Department management and user filtering
- Bulk user status management (active/inactive)
- Database backup and restore
- Configurable export colors and thresholds from Settings

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://www.rust-lang.org/tools/install)
- [Tauri CLI](https://v2.tauri.app/start/prerequisites/)

### Development

```bash
# Frontend
cd horus-attendance
npm install
npx tauri dev

# Sidecar (separate terminal)
cd horus-attendance/sidecar
npm install
npm run build
node dist/index.js
```

### Build for Production

```bash
cd horus-attendance
npm run build
npx tauri build
```

The installer will be in `horus-attendance/src-tauri/target/release/bundle/`.

### ZKTeco Sidecar

The sidecar is a Node.js process that communicates with ZKTeco devices over TCP. It must run alongside the desktop app:

```bash
cd horus-attendance/sidecar
node dist/index.js
```

It listens on `http://localhost:3847`.

## CI/CD

Pushing a version tag triggers a GitHub Actions build across macOS, Windows, and Linux:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow creates a draft release at [Releases](https://github.com/joshfom/horus-attendance/releases) with installers attached.

## License

MIT
