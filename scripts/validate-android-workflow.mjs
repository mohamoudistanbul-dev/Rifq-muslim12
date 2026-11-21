#!/usr/bin/env node
/**
 * Structural validation for the GitHub workflows that gate delivery:
 *   .github/workflows/android-apk.yml      - whether an APK actually gets built
 *   .github/workflows/dependency-scan.yml  - whether the dependency scan keeps
 *                                            covering every committed lockfile
 *
 * Dependency-free on purpose: it runs anywhere Node is available, including
 * before a GitHub runner ever starts. It asserts the parts of each workflow that
 * decide the outcome, so a regression fails loudly here instead of silently in CI.
 * It does not execute either workflow, so a green run there is still required.
 *
 * Usage:  node scripts/validate-android-workflow.mjs
 * Exits non-zero and lists every problem found.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = join(root, '.github/workflows/android-apk.yml');

let src;
try {
  src = readFileSync(workflowPath, 'utf8');
} catch (err) {
  console.error(`workflow validation FAILED: cannot read ${workflowPath} (${err.message})`);
  process.exit(1);
}

// [label, matcher] — matcher is a RegExp that must be found in the workflow.
const rules = [
  ['workflow name', /^name:\s*\S+/m],
  ['manual trigger', /workflow_dispatch:/],
  ['push trigger on main', /push:[\s\S]*?branches:[\s\S]*?-\s*main/],
  ['least-privilege permissions', /permissions:[\s\S]*?contents:\s*read/],
  ['debug job', /^\s{2}debug-apk:/m],
  ['release job', /^\s{2}release-apk:/m],
  ['ubuntu runner', /runs-on:\s*ubuntu-latest/],
  ['checkout action', /actions\/checkout@v4/],
  ['setup-java action', /actions\/setup-java@v4/],
  ['JDK 17', /java-version:\s*['"]?17['"]?/],
  ['Temurin distribution', /distribution:\s*temurin/],
  ['android sdk action', /android-actions\/setup-android@v3/],
  ['compile SDK 35', /platforms;android-35/],
  ['build-tools 35.0.0', /build-tools;35\.0\.0/],
  ['SDK path for Gradle', /local\.properties/],
  ['debug build command', /assembleDebug/],
  ['release build command', /assembleRelease/],
  ['AAB build command', /bundleRelease/],
  ['APK path', /app-debug\.apk/],
  ['artifact upload', /actions\/upload-artifact@v4/],
  ['debug artifact name', /rifq-muslim-debug-apk/],
  ['fail on missing APK', /if-no-files-found:\s*error/],
  ['dependency graph aid', /gradle-dependencies\.txt/],
  ['release signing gate', /vars\.ENABLE_RELEASE_SIGNING/],
];

const problems = [];
for (const [label, re] of rules) {
  if (!re.test(src)) problems.push(`missing or changed: ${label}`);
}

// Build-cache must be disabled in BOTH jobs (CVE-2026-53914 mitigation).
const cacheGuards = (src.match(/--no-build-cache/g) || []).length;
if (cacheGuards < 2) {
  problems.push(`build-cache guard expected in both jobs, found ${cacheGuards}`);
}

// No hardcoded signing values: every storePassword/keyPassword assignment must
// interpolate a variable or printf placeholder rather than a literal secret.
const badSigning = new Set();
for (const line of src.split('\n')) {
  const m = line.match(/(storePassword|keyPassword)\s*=\s*(\S+)/);
  if (m && !/[%$]/.test(m[2])) badSigning.add(m[1]);
}
if (badSigning.size) {
  problems.push(`hardcoded signing value for: ${[...badSigning].join(', ')}`);
}

// A long unbroken base64 run would suggest an inlined keystore.
if (/[A-Za-z0-9+/]{120,}={0,2}/.test(src)) {
  problems.push('possible embedded base64 blob (inlined keystore?)');
}

// ---------------------------------------------------------------------------
// .github/workflows/dependency-scan.yml - the committed route that closes the
// Gradle attribution gap. It cannot execute inside AppJet, so its shape is
// asserted here: every committed lockfile must stay an explicit scan target and
// no step may require a secret.
const scanWorkflowPath = join(root, '.github/workflows/dependency-scan.yml');

let scanSrc;
try {
  scanSrc = readFileSync(scanWorkflowPath, 'utf8');
} catch (err) {
  console.error(`workflow validation FAILED: cannot read ${scanWorkflowPath} (${err.message})`);
  process.exit(1);
}

const scanRules = [
  ['workflow name', /^name:\s*\S+/m],
  ['manual trigger', /workflow_dispatch:/],
  ['scheduled trigger', /cron:\s*['"][^'"]+['"]/],
  ['least-privilege permissions', /permissions:[\s\S]*?contents:\s*read/],
  ['ubuntu runner', /runs-on:\s*ubuntu-latest/],
  ['checkout action', /actions\/checkout@v4/],
  ['explicit lockfile target (-L)', /-L\s+"?\/src\//],
  ['pinned scanner release', /ghcr\.io\/google\/osv-scanner:v\d+\.\d+\.\d+/],
  ['every lockfile reports', /fail-fast:\s*false/],
  ['missing-lockfile guard', /Lockfile missing/],
  ['lock state artifact', /actions\/upload-artifact@v4/],
  ['write-locks attempt', /buildEnvironment --write-locks/],
];

for (const [label, re] of scanRules) {
  if (!re.test(scanSrc)) problems.push(`dependency scan missing or changed: ${label}`);
}

// Each committed lockfile must stay an explicit matrix target. Dropping one would
// shrink coverage silently while the workflow still reported green.
const requiredLockfiles = [
  'package-lock.json',
  'android/app/gradle.lockfile',
  'android/buildscript-gradle.lockfile',
  'deps-audit/gradle.lockfile',
];
for (const lockfile of requiredLockfiles) {
  if (!scanSrc.includes(`lockfile: ${lockfile}`)) {
    problems.push(`dependency scan no longer targets ${lockfile}`);
  }
}

// Exactly one non-gating job (the write-locks attempt); the scans themselves must
// fail the run when advisories are found.
const nonGating = (scanSrc.match(/continue-on-error:\s*true/g) || []).length;
if (nonGating !== 1) {
  problems.push(`expected exactly 1 non-gating job, found ${nonGating}`);
}

// Scanning needs no credentials, so a secret reference would be a design regression.
if (/secrets\./.test(scanSrc)) {
  problems.push('dependency scan references repository secrets');
}

if (problems.length) {
  console.error('workflow validation FAILED:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `workflow validation passed: android-apk ${rules.length} rules ` +
    `(${cacheGuards} build-cache guards, no hardcoded signing values), ` +
    `dependency-scan ${scanRules.length} rules ` +
    `(${requiredLockfiles.length} explicit lockfiles, ${nonGating} non-gating job)`,
);
