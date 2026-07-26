# Aleksi Learning Workbench

Private source and Windows build repository for Aleksi Learning Workbench.

## Windows installer

The workflow **Build Windows EXE** runs only when manually started from the Actions page. It builds the Tauri NSIS installer on GitHub's standard `windows-latest` runner and uploads the installer as a short-lived artifact.

The workflow **Qualify Aleksi Workbench 0.1.3 Windows installer** is the canonical
0.1.3 release gate. It verifies the audited source archive and canonical 0.1.2
predecessor by SHA-256, builds on `windows-2022`, installs 0.1.2, upgrades to
0.1.3, verifies launch/native-window-close/sidecar shutdown/relaunch, uninstalls
the qualified payload, and only then uploads the unsigned installer artifact.
Diagnostic lifecycle evidence is retained even when qualification fails.

## Cost controls

- Manual trigger only (`workflow_dispatch`)
- One build at a time
- 90-minute qualification timeout
- Standard GitHub-hosted Windows runner only
- Qualification artifacts retained for 14 days

The 20-second startup animation remains intentionally unchanged.
