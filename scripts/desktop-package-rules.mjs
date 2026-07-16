export const DESKTOP_INSTALLER_PATH = "artifacts/Aleksi-Workbench-Setup.exe";
export const DESKTOP_PACKAGE_MANIFEST_PATH =
  "artifacts/desktop-package-manifest.json";
export const DESKTOP_IDENTITY_PATH = "src-tauri/resources/identity.json";
export const DESKTOP_SIDECAR_NODE_PATH =
  "src-tauri/resources/sidecar/node.exe";
export const DESKTOP_SIDECAR_SERVER_PATH =
  "src-tauri/resources/sidecar/server.js";
export const DESKTOP_NSIS_DIRECTORY =
  "src-tauri/target/release/bundle/nsis";

export const DESKTOP_MIN_INSTALLER_BYTES = 5 * 1024 * 1024;
export const DESKTOP_MIN_NODE_BYTES = 1 * 1024 * 1024;

export function isNsisSetupCandidate(name) {
  return /(?:setup|installer)\.exe$/iu.test(name);
}
