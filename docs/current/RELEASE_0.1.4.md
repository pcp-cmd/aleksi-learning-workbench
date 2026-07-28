# Aleksi Workbench 0.1.4

0.1.4 is a reliability-hardening candidate built from the qualified 0.1.3
desktop baseline. It adds no new learning workflow. The release remains an
`unsigned-preview`; it must not be described as a signed stable Windows
release.

## Reliability changes

- Crash-recoverable, journaled Markdown transactions with startup recovery.
- Request-scoped learning-library identity and shared/exclusive switch leases.
- Optimistic file-version checks for card update/archive and reading replace.
- Authoritative Markdown survives disposable projection failures.
- Bounded Review, Verification, Graph, migration, and backup file I/O.
- Corrupt projection, verification, and app-settings records are quarantined.
- Migration and backup use verified partial directories; completed backups
  contain `.aleksi/backup-manifest.json`.
- Draft persistence failures are visible and fall back to in-memory recovery.
- Desktop shutdown reports `stop-failed` instead of claiming the sidecar exited.
- Release Actions are pinned to full commit SHAs and the installer receives a
  GitHub build-provenance attestation.

## Canonical identity

- Version: `0.1.4`
- Installer: `Aleksi-Workbench-0.1.4-Setup.exe`
- Upgrade predecessor: canonical `0.1.3`
- Release directory: `artifacts/release/aleksi-workbench/0.1.4`
- Canonical installer path:
  `artifacts/release/aleksi-workbench/0.1.4/Aleksi-Workbench-0.1.4-Setup.exe`
- Signing status: `unsigned-preview`

The exact predecessor installer and installed executable hashes are frozen in
`release/identity.json` from the qualified 0.1.3 evidence.

The installer carries the bundled Node runtime, so end users do not install
Node, Rust, or Visual Studio. WebView2 remains `online-light`: a machine that
lacks WebView2 needs network access to obtain it. This is the 离线安装边界.

## Qualification boundary

Local Node/TypeScript verification is necessary but not sufficient. The
Windows GitHub Actions qualification must still pass Rust formatting, compile,
Clippy, Rust tests, NSIS packaging, first launch, 0.1.3 upgrade, native close,
relaunch, uninstall, residual-process checks, SBOM/hash reconciliation, and
artifact attestation. An 8-hour soak and Authenticode signing remain separate
release evidence; without them this candidate is not a 95+ or signed stable
release.
