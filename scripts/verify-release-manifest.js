#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(REPO_ROOT, 'docs');
const MANIFEST_PATH = path.join(DOCS_DIR, 'RELEASE_MANIFEST.json');
const WRITE_MODE = process.argv.includes('--write');

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function readManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

function resolveArtifact(file) {
  if (typeof file !== 'string' || file.length === 0 || path.basename(file) !== file) {
    throw new Error(`Invalid release artifact path: ${String(file)}`);
  }
  return path.join(DOCS_DIR, file);
}

function computeArtifactMetadata(file) {
  const artifactPath = resolveArtifact(file);
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Release artifact is missing from checkout: docs/${file}`);
  }
  const bytes = fs.readFileSync(artifactPath);
  return {
    sha256: sha256(bytes),
    bytes: bytes.length
  };
}

function main() {
  const manifest = readManifest();
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    throw new Error('RELEASE_MANIFEST.json must declare at least one artifact.');
  }

  const mismatches = [];
  const updatedArtifacts = manifest.artifacts.map((artifact) => {
    const actual = computeArtifactMetadata(artifact.file);
    const expected = {
      sha256: artifact.sha256,
      bytes: artifact.bytes
    };

    if (expected.sha256 !== actual.sha256 || expected.bytes !== actual.bytes) {
      mismatches.push({ file: artifact.file, expected, actual });
    }

    return {
      ...artifact,
      sha256: actual.sha256,
      bytes: actual.bytes
    };
  });

  if (WRITE_MODE) {
    const updatedManifest = {
      ...manifest,
      artifacts: updatedArtifacts
    };
    fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(updatedManifest, null, 2)}\n`, 'utf8');
    console.log(`Updated ${path.relative(REPO_ROOT, MANIFEST_PATH)} from committed artifact bytes.`);
    for (const artifact of updatedArtifacts) {
      console.log(`${artifact.file}\tbytes=${artifact.bytes}\tsha256=${artifact.sha256}`);
    }
    return;
  }

  if (mismatches.length > 0) {
    console.error(`RELEASE_MANIFEST integrity FAILED: ${mismatches.length} artifact(s) differ from committed bytes.`);
    for (const mismatch of mismatches) {
      console.error(`\n${mismatch.file}`);
      console.error(`  manifest bytes : ${mismatch.expected.bytes}`);
      console.error(`  checkout bytes : ${mismatch.actual.bytes}`);
      console.error(`  manifest sha256: ${mismatch.expected.sha256}`);
      console.error(`  checkout sha256: ${mismatch.actual.sha256}`);
    }
    console.error('\nTo regenerate only bytes/sha256 metadata from this checkout:');
    console.error('  node scripts/verify-release-manifest.js --write');
    process.exitCode = 1;
    return;
  }

  console.log(`RELEASE_MANIFEST integrity PASS: ${updatedArtifacts.length} artifact(s) match committed bytes and SHA-256.`);
}

try {
  main();
} catch (error) {
  console.error(`RELEASE_MANIFEST integrity ERROR: ${error.message}`);
  process.exitCode = 1;
}
