# Windows Actions APP Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and qualify the Aleksi Workbench Windows APP from the delivered 0.1.5-rc.1 source package through GitHub Actions, then download and verify the resulting installer.

**Architecture:** Treat the delivered source ZIP and `origin/main` as one content-identical source boundary. Preserve the existing strict clean-source release manifest and installed lifecycle gates; fix the producer of any tracked build-time mutation instead of allowing dirty release evidence. Publish the focused correction through a pull request, run the canonical Windows qualification workflow on the resulting `main`, and verify the downloaded artifact against its manifest and lifecycle evidence.

**Tech Stack:** Git, GitHub Actions, Node.js 22, npm 12, TypeScript, Vitest, Rust 1.97.1, Tauri 2, NSIS, PowerShell

---

### Task 1: Confirm the authoritative source and failure boundary

**Files:**
- Inspect: `C:/Users/pcp/Desktop/coding项目/Aleksi-Workbench-0.1.5-rc.1-Source-Delivery/Aleksi-Learning-Workbench-Source-0.1.5-rc.1.zip`
- Inspect: `.github/workflows/windows-qualification.yml`
- Inspect: `scripts/package-release.mjs`
- Inspect: `scripts/verify-release-manifest.mjs`

- [ ] **Step 1: Compare every source-package manifest hash with the current `origin/main` checkout**

Run the ZIP manifest comparison and require zero missing or changed files.

- [ ] **Step 2: Read the failed Windows qualification log at the canonical installer verification step**

Expected failure: `Qualified release manifest must come from a clean source tree` after `verify:desktop` succeeds.

- [ ] **Step 3: Trace the Git mutation to the first producing build stage**

Compare tracked files before and after the matching local or CI generation command. Record the exact path and generator before editing.

### Task 2: Add a regression contract for clean release provenance

**Files:**
- Modify: `tests/scripts/release-package.test.ts`
- Modify when needed: `tests/scripts/workflow-contract.test.ts`

- [ ] **Step 1: Write a failing test that reproduces the confirmed mutation/provenance defect**

The test must assert the intended clean-source behavior without using `--allow-dirty` or weakening the manifest verifier.

- [ ] **Step 2: Run the focused test and confirm the expected failure**

Run: `npm.cmd test -- --run tests/scripts/release-package.test.ts tests/scripts/workflow-contract.test.ts`

Expected: the new assertion fails against the current implementation.

### Task 3: Implement the smallest root-cause fix

**Files:**
- Modify only the confirmed producer or workflow boundary from Task 1.

- [ ] **Step 1: Make generated build output deterministic or keep it outside tracked source state**

Preserve the strict `manifest.dirty === false` rule and keep installer, signing, predecessor, upgrade, uninstall, and attestation gates unchanged.

- [ ] **Step 2: Run focused verification**

Run the new regression test, workflow contract tests, `git diff --check`, and any generator-specific equality check.

- [ ] **Step 3: Run source-level qualification**

Run: `npm.cmd run typecheck`

Run: `npm.cmd test -- --run tests/scripts/release-package.test.ts tests/scripts/release-manifest.test.ts tests/scripts/desktop-delivery.test.ts tests/scripts/workflow-contract.test.ts`

Expected: all commands exit 0.

### Task 4: Publish and qualify the fix

**Files:**
- Commit only the plan, regression test, and confirmed minimal implementation files.

- [ ] **Step 1: Push `agent/fix-windows-release-provenance` and open a focused pull request**

- [ ] **Step 2: Require Source CI to pass, then merge to `main`**

- [ ] **Step 3: Dispatch `.github/workflows/windows-qualification.yml` on the merged `main`**

Expected: both qualification and artifact-attestation jobs succeed.

### Task 5: Download and verify the APP delivery

**Files:**
- Create: `C:/Users/pcp/Desktop/coding项目/Aleksi-Workbench-0.1.5-rc.1-GitHub-Actions/`

- [ ] **Step 1: Download the qualified installer and installed-lifecycle artifacts**

- [ ] **Step 2: Verify ZIP inventory, installer MZ/PE identity, byte count, SHA-256, version, commit, unsigned-preview policy, and lifecycle pass evidence**

- [ ] **Step 3: Copy the verified installer to the versioned Desktop delivery directory without overwriting older versions**

- [ ] **Step 4: Remove only task-local logs, archives, and temporary tool directories after their evidence has been recorded**
