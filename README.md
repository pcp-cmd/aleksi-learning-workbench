# Aleksi Learning Workbench

Private source and Windows build repository for Aleksi Learning Workbench.

## Windows installer

The workflow **Build Windows EXE** runs only when manually started from the Actions page. It builds the Tauri NSIS installer on GitHub's standard `windows-latest` runner and uploads the installer as a short-lived artifact.

## Cost controls

- Manual trigger only (`workflow_dispatch`)
- One build at a time
- 45-minute timeout
- Standard GitHub-hosted Windows runner only
- Build artifacts retained for 3 days

The 20-second startup animation remains intentionally unchanged.
