import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { packPlugin } from "../scripts/pack-plugin.mjs";
import {
  assertChecksum,
  assertPluginManifest,
  installFromOptions,
  installPluginArtifact,
  installPluginDirectory,
  parseChecksumText,
  parseLineageVersion,
  pluginArtifactFilename,
  releaseArtifactUrls,
  resolveLineageVersion,
  runCodexCommandSync,
  sha256,
} from "../src/installer.mjs";

const cliPath = path.resolve("bin/lineage-plugin-installer.mjs");
const pluginFixturePath = path.resolve("../../plugins/lineage-codex-plugin");
const installerVersion = JSON.parse(await readFile(path.resolve("package.json"), "utf8")).version;
const releaseFixtureVersion = JSON.parse(await readFile(path.join(pluginFixturePath, ".codex-plugin", "plugin.json"), "utf8")).version;

test("parseLineageVersion accepts JSON strings and CLI output", () => {
  assert.equal(parseLineageVersion('"0.1.11"'), "0.1.11");
  assert.equal(parseLineageVersion("lineage 0.1.11"), "0.1.11");
});

test("CLI prints installer package version", () => {
  const result = spawnSync(process.execPath, [cliPath, "--version"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), installerVersion);
  assert.equal(result.stderr, "");
});

test("Codex runner explains how to recover when the CLI is not on PATH", () => {
  const result = runCodexCommandSync("lineage-codex-cli-missing-for-test", [], {
    codexHome: "/tmp/lineage-codex-home",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Codex CLI was not found on PATH/);
  assert.match(result.stderr, /codex --version/);
});

test("CLI help is non-mutating and documents install isolation and doctor", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "lineage-plugin-help-"));
  const isolatedHome = path.join(temp, "home");
  try {
    const result = spawnSync(process.execPath, [cliPath, "--help"], {
      encoding: "utf8",
      env: { ...process.env, HOME: isolatedHome, CODEX_HOME: path.join(temp, "codex-home") },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /lineage-plugin-installer doctor/);
    assert.match(result.stdout, /--target-dir is a files-only mode/);
    await assert.rejects(stat(isolatedHome), /ENOENT/);
    await assert.rejects(stat(path.join(temp, "codex-home")), /ENOENT/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("installFromOptions rejects ambiguous target and Codex home isolation before resolving a version", async () => {
  await assert.rejects(
    installFromOptions({
      targetRoot: "/tmp/lineage-files-only",
      codexHome: "/tmp/lineage-codex-home",
      runCommand: async () => { throw new Error("version lookup should not run"); },
    }),
    /files-only and cannot be combined with --codex-home/,
  );
});

test("CLI doctor fails read-only with structured guidance for a missing Codex home", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "lineage-plugin-doctor-cli-"));
  const codexHome = path.join(temp, "missing-codex-home");
  try {
    const result = spawnSync(process.execPath, [
      cliPath,
      "doctor",
      "--version",
      releaseFixtureVersion,
      "--codex-home",
      codexHome,
      "--json",
    ], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.equal(result.stderr, "");
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, false);
    assert.equal(output.codexHome, codexHome);
    assert.deepEqual(output.diagnoses, ["codex_home_missing", "marketplace_missing", "plugin_missing", "manifest_missing_or_invalid"]);
    assert.equal(output.remediation.action, "install");
    assert.deepEqual(output.remediation.argv.slice(0, 6), [
      "npx", "--yes", "@mean-weasel/lineage-plugin-installer@latest", "install", "--version", releaseFixtureVersion,
    ]);
    assert.match(output.remediation.command, new RegExp(`--version ${releaseFixtureVersion}`));
    assert.equal(output.remediation.expectedLineageVersion, releaseFixtureVersion);
    assert.match(output.checks.find((check) => check.id === "codex_cli")?.message || "", /does not exist/);
    await assert.rejects(stat(codexHome), /ENOENT/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("CLI preserves install --version as the Lineage compatibility selector", () => {
  const result = spawnSync(process.execPath, [
    cliPath,
    "install",
    "--plugin",
    pluginFixturePath,
    "--version",
    releaseFixtureVersion,
    "--target-dir",
    path.join(tmpdir(), "lineage-cli-version-selector-proof"),
    "--dry-run",
    "--json",
  ], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.dryRun, true);
  assert.equal(output.pluginVersion, releaseFixtureVersion);
  assert.equal(output.lineageVersion, releaseFixtureVersion);
});

test("resolveLineageVersion uses explicit version before npm channel lookup", async () => {
  const version = await resolveLineageVersion({
    version: "0.1.11",
    runCommand: async () => {
      throw new Error("should not run npm");
    },
  });

  assert.equal(version, "0.1.11");
});

test("resolveLineageVersion resolves npm dist-tag channels", async () => {
  const calls = [];
  const version = await resolveLineageVersion({
    channel: "next",
    runCommand: async (command, args) => {
      calls.push([command, args]);
      return { status: 0, stdout: '"0.1.3"', stderr: "" };
    },
  });

  assert.equal(version, "0.1.3");
  assert.deepEqual(calls, [["npm", ["view", "@mean-weasel/lineage@next", "version", "--json"]]]);
});

test("assertPluginManifest accepts exact package and plugin version match", () => {
  const manifest = {
    name: "lineage-codex-plugin",
    version: "0.1.11",
    lineage: { package: "@mean-weasel/lineage", version: "0.1.11" },
  };

  assert.equal(assertPluginManifest(manifest, "0.1.11"), manifest);
});

test("assertPluginManifest rejects plugin version mismatch", () => {
  assert.throws(
    () =>
      assertPluginManifest(
        {
          name: "lineage-codex-plugin",
          version: "0.1.1",
          lineage: { package: "@mean-weasel/lineage", version: "0.1.11" },
        },
        "0.1.11",
      ),
    /Plugin version 0\.1\.1 does not match 0\.1\.11/,
  );
});

test("assertPluginManifest rejects lineage compatibility mismatch", () => {
  assert.throws(
    () =>
      assertPluginManifest(
        {
          name: "lineage-codex-plugin",
          version: "0.1.11",
          lineage: { package: "@mean-weasel/lineage", version: "0.1.1" },
        },
        "0.1.11",
      ),
    /Plugin lineage version 0\.1\.1 does not match 0\.1\.11/,
  );
});

test("assertChecksum rejects corrupted artifact bytes", () => {
  const bytes = Buffer.from("lineage plugin artifact");
  assert.equal(assertChecksum(bytes, sha256(bytes)), sha256(bytes));
  assert.throws(() => assertChecksum(Buffer.from("corrupt"), sha256(bytes)), /Checksum mismatch/);
});

test("parseChecksumText accepts sha256 files with filenames", () => {
  const hash = "a".repeat(64);
  assert.equal(parseChecksumText(`${hash}  lineage-codex-plugin-0.1.11.tgz\n`), hash);
  assert.throws(() => parseChecksumText("not a checksum"), /does not contain a sha256 hash/);
});

test("releaseArtifactUrls derives GitHub release artifact URLs", () => {
  assert.deepEqual(releaseArtifactUrls({ version: "0.1.11" }), {
    artifactUrl:
      "https://github.com/mean-weasel/lineage/releases/download/v0.1.11/lineage-codex-plugin-0.1.11.tgz",
    checksumUrl:
      "https://github.com/mean-weasel/lineage/releases/download/v0.1.11/lineage-codex-plugin-0.1.11.tgz.sha256",
  });
});

test("installPluginDirectory verifies manifest and dry-run does not write", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "lineage-plugin-installer-"));
  const pluginDir = path.join(temp, "plugin");
  const targetRoot = path.join(temp, "target");

  try {
    await writePluginManifest(pluginDir, {
      name: "lineage-codex-plugin",
      version: "0.1.11",
      lineage: { package: "@mean-weasel/lineage", version: "0.1.11" },
    });

    const result = await installPluginDirectory({
      pluginDir,
      targetRoot,
      expectedVersion: "0.1.11",
      dryRun: true,
    });

    assert.equal(result.dryRun, true);
    assert.equal(result.destination, path.join(targetRoot, "lineage-codex-plugin"));
    await assert.rejects(readFile(path.join(targetRoot, "lineage-codex-plugin", ".codex-plugin", "plugin.json")));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("installPluginDirectory copies a verified plugin to target directory", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "lineage-plugin-installer-"));
  const pluginDir = path.join(temp, "plugin");
  const targetRoot = path.join(temp, "target");

  try {
    await writePluginManifest(pluginDir, {
      name: "lineage-codex-plugin",
      version: "0.1.11",
      lineage: { package: "@mean-weasel/lineage", version: "0.1.11" },
    });

    await installPluginDirectory({
      pluginDir,
      targetRoot,
      expectedVersion: "0.1.11",
    });

    const copied = JSON.parse(
      await readFile(path.join(targetRoot, "lineage-codex-plugin", ".codex-plugin", "plugin.json"), "utf8"),
    );
    assert.equal(copied.version, "0.1.11");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("installPluginDirectory replaces the destination as one verified tree without stale files", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "lineage-plugin-installer-"));
  const pluginDir = path.join(temp, "plugin");
  const targetRoot = path.join(temp, "target");
  const destination = path.join(targetRoot, "lineage-codex-plugin");
  const manifest = {
    name: "lineage-codex-plugin",
    version: "0.1.11",
    lineage: { package: "@mean-weasel/lineage", version: "0.1.11" },
  };

  try {
    await writePluginManifest(pluginDir, manifest);
    await writePluginManifest(destination, manifest);
    await writeFile(path.join(destination, "stale-guidance.md"), "must disappear\n");

    await installPluginDirectory({ pluginDir, targetRoot, expectedVersion: "0.1.11" });

    await assert.rejects(readFile(path.join(destination, "stale-guidance.md")), /ENOENT/);
    assert.deepEqual(JSON.parse(await readFile(path.join(destination, ".codex-plugin", "plugin.json"), "utf8")), manifest);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("installPluginDirectory refuses a concurrent install without changing the destination", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "lineage-plugin-installer-"));
  const pluginDir = path.join(temp, "plugin");
  const targetRoot = path.join(temp, "target");
  const destination = path.join(targetRoot, "lineage-codex-plugin");
  const manifest = {
    name: "lineage-codex-plugin",
    version: "0.1.11",
    lineage: { package: "@mean-weasel/lineage", version: "0.1.11" },
  };

  try {
    await writePluginManifest(pluginDir, manifest);
    await writePluginManifest(destination, manifest);
    await mkdir(path.join(targetRoot, ".lineage-codex-plugin.install.lock"), { recursive: true });

    await assert.rejects(
      installPluginDirectory({ pluginDir, targetRoot, expectedVersion: "0.1.11" }),
      /install is already active/,
    );
    assert.equal(JSON.parse(await readFile(path.join(destination, ".codex-plugin", "plugin.json"), "utf8")).version, "0.1.11");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("installPluginDirectory recovers an interrupted replacement before installing", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "lineage-plugin-installer-"));
  const pluginDir = path.join(temp, "plugin");
  const targetRoot = path.join(temp, "target");
  const destination = path.join(targetRoot, "lineage-codex-plugin");
  const backup = path.join(targetRoot, ".lineage-codex-plugin.install-backup");
  const manifest = {
    name: "lineage-codex-plugin",
    version: "0.1.11",
    lineage: { package: "@mean-weasel/lineage", version: "0.1.11" },
  };

  try {
    await writePluginManifest(pluginDir, manifest);
    await writePluginManifest(backup, manifest);
    await writeFile(path.join(backup, "interrupted-install-marker.md"), "old verified tree\n");
    await symlink("999999:abandoned", path.join(targetRoot, ".lineage-codex-plugin.install.lock"));

    await installPluginDirectory({ pluginDir, targetRoot, expectedVersion: "0.1.11" });

    assert.deepEqual(JSON.parse(await readFile(path.join(destination, ".codex-plugin", "plugin.json"), "utf8")), manifest);
    await assert.rejects(readFile(path.join(destination, "interrupted-install-marker.md")), /ENOENT/);
    await assert.rejects(readFile(backup), /ENOENT|EISDIR/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("packPlugin dry-run validates artifact contents without writing dist files", async () => {
  const result = await packPlugin({
    plugin: path.resolve("../../plugins/lineage-codex-plugin"),
    version: releaseFixtureVersion,
    outDir: path.resolve("dist-test-should-not-exist"),
    dryRun: true,
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.artifactName, `lineage-codex-plugin-${releaseFixtureVersion}.tgz`);
  assert.deepEqual(result.files, [
    ".codex-plugin/plugin.json",
    "README.md",
    "package.json",
    "skills/lineage-package-operator/references/claims.md",
    "skills/lineage-package-operator/references/cloning-migration.md",
    "skills/lineage-package-operator/references/image-generation.md",
    "skills/lineage-package-operator/references/runtime-profiles.md",
    "skills/lineage-package-operator/references/services-upgrades.md",
    "skills/lineage-package-operator/SKILL.md",
  ]);
  await assert.rejects(readFile(path.resolve("dist-test-should-not-exist", `lineage-codex-plugin-${releaseFixtureVersion}.tgz`)));
});

test("installPluginArtifact verifies local release artifact and dry-runs install", async () => {
  const fixture = await createPluginArtifactFixture();

  try {
    const result = await installPluginArtifact({
      artifactFile: fixture.artifactPath,
      checksumFile: fixture.checksumPath,
      targetRoot: fixture.targetRoot,
      expectedVersion: releaseFixtureVersion,
      dryRun: true,
    });

    assert.equal(result.dryRun, true);
    assert.equal(result.pluginVersion, releaseFixtureVersion);
    assert.equal(result.lineageVersion, releaseFixtureVersion);
    assert.equal(result.checksum, fixture.checksum);
    assert.equal(result.artifact, fixture.artifactPath);
    await assert.rejects(readFile(path.join(fixture.targetRoot, "lineage-codex-plugin", ".codex-plugin", "plugin.json")));
  } finally {
    await rm(fixture.temp, { recursive: true, force: true });
  }
});

test("installFromOptions can fetch a release artifact from resolved URLs", async () => {
  const fixture = await createPluginArtifactFixture();
  const urls = releaseArtifactUrls({
    version: releaseFixtureVersion,
    releaseBaseUrl: `https://example.test/releases/v${releaseFixtureVersion}`,
  });

  try {
    const result = await installFromOptions({
      version: releaseFixtureVersion,
      releaseBaseUrl: `https://example.test/releases/v${releaseFixtureVersion}`,
      targetRoot: fixture.targetRoot,
      dryRun: true,
      fetchBytes: async (url) => {
        if (url === urls.artifactUrl) return readFile(fixture.artifactPath);
        if (url === urls.checksumUrl) return readFile(fixture.checksumPath);
        throw new Error(`unexpected url ${url}`);
      },
    });

    assert.equal(result.artifact, urls.artifactUrl);
    assert.equal(result.checksumSource, urls.checksumUrl);
    assert.equal(result.pluginVersion, releaseFixtureVersion);
  } finally {
    await rm(fixture.temp, { recursive: true, force: true });
  }
});

test("installPluginArtifact rejects checksum mismatches before extraction", async () => {
  const fixture = await createPluginArtifactFixture();
  const badChecksumPath = path.join(fixture.temp, "bad.sha256");

  try {
    await writeFile(badChecksumPath, `${"b".repeat(64)}  ${path.basename(fixture.artifactPath)}\n`);
    await assert.rejects(
      installPluginArtifact({
        artifactFile: fixture.artifactPath,
        checksumFile: badChecksumPath,
        targetRoot: fixture.targetRoot,
        expectedVersion: releaseFixtureVersion,
        dryRun: true,
      }),
      /Checksum mismatch/,
    );
  } finally {
    await rm(fixture.temp, { recursive: true, force: true });
  }
});

test("installPluginArtifact rejects unsafe tarball entries", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "lineage-plugin-artifact-unsafe-"));
  const artifactPath = path.join(temp, pluginArtifactFilename("0.1.11"));
  const checksumPath = `${artifactPath}.sha256`;
  const targetRoot = path.join(temp, "target");

  try {
    const packageDir = path.join(temp, "unsafe", "package");
    await writePluginManifest(packageDir, {
      name: "lineage-codex-plugin",
      version: "0.1.11",
      lineage: { package: "@mean-weasel/lineage", version: "0.1.11" },
    });
    await mkdir(path.join(packageDir, "docs", "goals"), { recursive: true });
    await writeFile(path.join(packageDir, "docs", "goals", "leak.md"), "should not ship\n");

    const result = spawnSync("tar", ["-czf", artifactPath, "-C", path.join(temp, "unsafe"), "package"], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const checksum = sha256(await readFile(artifactPath));
    await writeFile(checksumPath, `${checksum}  ${path.basename(artifactPath)}\n`);

    await assert.rejects(
      installPluginArtifact({
        artifactFile: artifactPath,
        checksumFile: checksumPath,
        targetRoot,
        expectedVersion: "0.1.11",
        dryRun: true,
      }),
      /unsafe entries/,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

async function writePluginManifest(pluginDir, manifest) {
  const manifestDir = path.join(pluginDir, ".codex-plugin");
  await writeFile(path.join(pluginDir, "README.md"), "fixture\n", { flag: "w" }).catch(async (error) => {
    if (error.code !== "ENOENT") throw error;
    await import("node:fs/promises").then(({ mkdir }) => mkdir(pluginDir, { recursive: true }));
    await writeFile(path.join(pluginDir, "README.md"), "fixture\n");
  });
  await import("node:fs/promises").then(({ mkdir }) => mkdir(manifestDir, { recursive: true }));
  await writeFile(path.join(manifestDir, "plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function createPluginArtifactFixture() {
  const temp = await mkdtemp(path.join(tmpdir(), "lineage-plugin-artifact-"));
  const outDir = path.join(temp, "dist");
  const targetRoot = path.join(temp, "target");
  const plugin = pluginFixturePath;
  const result = await packPlugin({
    plugin,
    version: releaseFixtureVersion,
    outDir,
  });
  const artifactPath = result.artifactPath;
  const checksumPath = `${artifactPath}.sha256`;

  return {
    temp,
    artifactPath,
    checksumPath,
    checksum: result.sha256,
    targetRoot,
  };
}
