import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readlink, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

export const LINEAGE_PACKAGE = "@mean-weasel/lineage";
export const PLUGIN_INSTALLER_PACKAGE = "@mean-weasel/lineage-plugin-installer";
export const DEFAULT_GITHUB_REPO = "lineagehq/lineage";
export const PLUGIN_ARTIFACT_NAME = "lineage-codex-plugin";
export const PLUGIN_MANIFEST_PATH = ".codex-plugin/plugin.json";
export const CODEX_MARKETPLACE_NAME = "lineage";
export const CODEX_PLUGIN_ID = `${PLUGIN_ARTIFACT_NAME}@${CODEX_MARKETPLACE_NAME}`;
export const MARKETPLACE_MANIFEST_PATH = ".agents/plugins/marketplace.json";

export function parseLineageVersion(output) {
  const text = String(output || "").trim();
  const jsonCandidate = safeJsonParse(text);
  const value = typeof jsonCandidate === "string" ? jsonCandidate : text;
  const match = String(value).match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/);
  if (!match) {
    throw new Error(`Could not parse a Lineage version from output: ${text}`);
  }
  return match[0];
}

export async function resolveLineageVersion({
  version,
  channel = "latest",
  runCommand = runCommandSync,
} = {}) {
  if (version) return parseLineageVersion(version);
  if (!channel) {
    throw new Error("Either version or channel is required.");
  }

  const result = await runCommand("npm", ["view", `${LINEAGE_PACKAGE}@${channel}`, "version", "--json"]);
  if (result.status !== 0) {
    throw new Error(`Failed to resolve ${LINEAGE_PACKAGE}@${channel}: ${result.stderr || result.stdout}`);
  }
  return parseLineageVersion(result.stdout);
}

export async function loadPluginManifest(pluginDir) {
  const manifestPath = path.join(pluginDir, PLUGIN_MANIFEST_PATH);
  const text = await readFile(manifestPath, "utf8");
  return JSON.parse(text);
}

export function assertPluginManifest(manifest, expectedVersion) {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("Plugin manifest is missing or invalid.");
  }
  if (manifest.version !== expectedVersion) {
    throw new Error(`Plugin version ${manifest.version || "<missing>"} does not match ${expectedVersion}.`);
  }
  if (manifest.lineage?.package !== LINEAGE_PACKAGE) {
    throw new Error(`Plugin lineage package must be ${LINEAGE_PACKAGE}.`);
  }
  if (manifest.lineage?.version !== expectedVersion) {
    throw new Error(
      `Plugin lineage version ${manifest.lineage?.version || "<missing>"} does not match ${expectedVersion}.`,
    );
  }
  return manifest;
}

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function assertChecksum(buffer, expectedSha256) {
  if (!expectedSha256) return sha256(buffer);
  const actual = sha256(buffer);
  if (actual !== expectedSha256) {
    throw new Error(`Checksum mismatch: expected ${expectedSha256}, got ${actual}.`);
  }
  return actual;
}

export function parseChecksumText(text) {
  const match = String(text || "").match(/\b[a-fA-F0-9]{64}\b/);
  if (!match) {
    throw new Error("Checksum file does not contain a sha256 hash.");
  }
  return match[0].toLowerCase();
}

export function pluginArtifactFilename(version) {
  return `${PLUGIN_ARTIFACT_NAME}-${version}.tgz`;
}

export function releaseArtifactUrls({
  version,
  githubRepo = DEFAULT_GITHUB_REPO,
  releaseBaseUrl,
} = {}) {
  if (!version) throw new Error("version is required.");
  const base =
    releaseBaseUrl ||
    `https://github.com/${githubRepo}/releases/download/v${version}`;
  const artifactUrl = `${base.replace(/\/$/, "")}/${pluginArtifactFilename(version)}`;
  return {
    artifactUrl,
    checksumUrl: `${artifactUrl}.sha256`,
  };
}

export function defaultTargetRoot() {
  return path.join(homedir(), ".codex", "plugins", "local");
}

export function defaultCodexHome(env = process.env) {
  return path.resolve(env.CODEX_HOME || path.join(homedir(), ".codex"));
}

export function defaultMarketplaceRoot(codexHome = defaultCodexHome()) {
  return path.join(path.resolve(codexHome), "marketplaces", CODEX_MARKETPLACE_NAME);
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

export function pluginDoctorRemediation({ expectedVersion, codexHome, diagnoses }) {
  const argv = [
    "npx",
    "--yes",
    `${PLUGIN_INSTALLER_PACKAGE}@latest`,
    "install",
    "--version",
    expectedVersion,
    "--codex-home",
    path.resolve(codexHome),
  ];
  const reinstall = diagnoses.some((diagnosis) => [
    "marketplace_mismatch",
    "plugin_disabled",
    "plugin_version_mismatch",
  ].includes(diagnosis))
    || (diagnoses.includes("manifest_missing_or_invalid") && !diagnoses.includes("plugin_missing"));
  return {
    action: reinstall ? "reinstall" : "install",
    argv,
    command: argv.map(shellQuote).join(" "),
    expectedLineageVersion: expectedVersion,
  };
}

export function createMarketplaceManifest(pluginName = PLUGIN_ARTIFACT_NAME) {
  return {
    name: CODEX_MARKETPLACE_NAME,
    interface: { displayName: "Lineage" },
    plugins: [
      {
        name: pluginName,
        source: { source: "local", path: `./plugins/${pluginName}` },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Productivity",
      },
    ],
  };
}

export async function installPluginDirectory({
  pluginDir,
  targetRoot = defaultTargetRoot(),
  expectedVersion,
  dryRun = false,
} = {}) {
  if (!pluginDir) throw new Error("pluginDir is required.");
  if (!expectedVersion) throw new Error("expectedVersion is required.");

  const manifest = assertPluginManifest(await loadPluginManifest(pluginDir), expectedVersion);
  const destination = path.join(targetRoot, manifest.name);

  const plan = {
    ok: true,
    dryRun,
    activated: false,
    plugin: manifest.name,
    pluginVersion: manifest.version,
    lineagePackage: manifest.lineage.package,
    lineageVersion: manifest.lineage.version,
    source: path.resolve(pluginDir),
    destination,
  };

  if (dryRun) return plan;

  await mkdir(targetRoot, { recursive: true });
  const lock = path.join(targetRoot, `.${manifest.name}.install.lock`);
  const staging = path.join(targetRoot, `.${manifest.name}.staging-${randomUUID()}`);
  const backup = path.join(targetRoot, `.${manifest.name}.install-backup`);
  const lockOwner = `${process.pid}:${randomUUID()}`;
  await acquireInstallLock(lock, lockOwner, manifest.name, targetRoot);
  let movedExisting = false;
  let placedDestination = false;
  try {
    const backupExists = await pathExists(backup);
    const destinationExists = await pathExists(destination);
    if (backupExists && !destinationExists) {
      await rename(backup, destination);
    } else if (backupExists) {
      assertPluginManifest(await loadPluginManifest(destination), expectedVersion);
      await rm(backup, { recursive: true, force: true });
    }
    await cp(pluginDir, staging, {
      recursive: true,
      force: false,
      errorOnExist: true,
      filter: isAllowedInstallPath,
    });
    assertPluginManifest(await loadPluginManifest(staging), expectedVersion);
    try {
      await rename(destination, backup);
      movedExisting = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await rename(staging, destination);
    placedDestination = true;
    assertPluginManifest(await loadPluginManifest(destination), expectedVersion);
    if (movedExisting) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (placedDestination) await rm(destination, { recursive: true, force: true });
    if (movedExisting) {
      await rename(backup, destination);
    }
    throw error;
  } finally {
    await releaseInstallLock(lock, lockOwner);
  }

  return plan;
}

export async function installPluginMarketplace({
  pluginDir,
  expectedVersion,
  codexHome = defaultCodexHome(),
  dryRun = false,
  runCodex = runCodexCommandSync,
} = {}) {
  if (!pluginDir) throw new Error("pluginDir is required.");
  if (!expectedVersion) throw new Error("expectedVersion is required.");

  const manifest = assertPluginManifest(await loadPluginManifest(pluginDir), expectedVersion);
  if (manifest.name !== PLUGIN_ARTIFACT_NAME) {
    throw new Error(`Plugin name ${manifest.name || "<missing>"} does not match ${PLUGIN_ARTIFACT_NAME}.`);
  }

  const resolvedCodexHome = path.resolve(codexHome);
  const marketplaceRoot = defaultMarketplaceRoot(resolvedCodexHome);
  const targetRoot = path.join(marketplaceRoot, "plugins");
  const destination = path.join(targetRoot, manifest.name);
  const marketplaceFile = path.join(marketplaceRoot, MARKETPLACE_MANIFEST_PATH);
  const plan = {
    ok: true,
    dryRun,
    activated: !dryRun,
    plugin: manifest.name,
    pluginId: CODEX_PLUGIN_ID,
    pluginVersion: manifest.version,
    lineagePackage: manifest.lineage.package,
    lineageVersion: manifest.lineage.version,
    source: path.resolve(pluginDir),
    destination,
    codexHome: resolvedCodexHome,
    marketplace: CODEX_MARKETPLACE_NAME,
    marketplaceRoot,
    marketplaceFile,
    registration: [
      ["codex", "plugin", "marketplace", "add", marketplaceRoot, "--json"],
      ["codex", "plugin", "add", CODEX_PLUGIN_ID, "--json"],
    ],
  };

  if (dryRun) return plan;

  const marketplaceParent = path.dirname(marketplaceRoot);
  const lock = path.join(marketplaceParent, `.${CODEX_MARKETPLACE_NAME}.activation.lock`);
  const staging = path.join(marketplaceParent, `.${CODEX_MARKETPLACE_NAME}.staging-${randomUUID()}`);
  const backup = path.join(marketplaceParent, `.${CODEX_MARKETPLACE_NAME}.activation-backup`);
  const lockOwner = `${process.pid}:${randomUUID()}`;
  const codexHomeExisted = await pathExists(resolvedCodexHome);
  if (!codexHomeExisted) await mkdir(resolvedCodexHome, { recursive: true });
  try {
    readCodexPluginState({ codexHome: resolvedCodexHome, runCodex });
  } catch (error) {
    if (!codexHomeExisted) await rm(resolvedCodexHome, { recursive: true, force: true });
    throw error;
  }
  await mkdir(marketplaceParent, { recursive: true });
  await acquireInstallLock(lock, lockOwner, manifest.name, marketplaceParent);

  let movedExisting = false;
  let placedMarketplace = false;
  let marketplaceAddAttempted = false;
  let pluginAddAttempted = false;
  let priorState;
  try {
    priorState = readCodexPluginState({ codexHome: resolvedCodexHome, runCodex });
    await recoverMarketplaceReplacement({ marketplaceRoot, backup });
    await installPluginDirectory({
      pluginDir,
      targetRoot: path.join(staging, "plugins"),
      expectedVersion,
    });
    const stagingMarketplaceFile = path.join(staging, MARKETPLACE_MANIFEST_PATH);
    await mkdir(path.dirname(stagingMarketplaceFile), { recursive: true });
    await writeFile(stagingMarketplaceFile, `${JSON.stringify(createMarketplaceManifest(manifest.name), null, 2)}\n`);
    assertPluginManifest(
      await loadPluginManifest(path.join(staging, "plugins", manifest.name)),
      expectedVersion,
    );

    try {
      await rename(marketplaceRoot, backup);
      movedExisting = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await rename(staging, marketplaceRoot);
    placedMarketplace = true;

    marketplaceAddAttempted = true;
    const marketplaceResult = runCodexJson({
      runCodex,
      codexHome: resolvedCodexHome,
      args: ["plugin", "marketplace", "add", marketplaceRoot, "--json"],
      label: "register the Lineage marketplace",
    });
    if (marketplaceResult.marketplaceName !== CODEX_MARKETPLACE_NAME) {
      throw new Error(`Codex registered unexpected marketplace ${marketplaceResult.marketplaceName || "<missing>"}.`);
    }

    pluginAddAttempted = true;
    const pluginResult = runCodexJson({
      runCodex,
      codexHome: resolvedCodexHome,
      args: ["plugin", "add", CODEX_PLUGIN_ID, "--json"],
      label: "install the Lineage plugin",
    });
    if (pluginResult.pluginId !== CODEX_PLUGIN_ID || pluginResult.version !== expectedVersion) {
      throw new Error(
        `Codex installed ${pluginResult.pluginId || "<missing>"}@${pluginResult.version || "<missing>"}, expected ${CODEX_PLUGIN_ID}@${expectedVersion}.`,
      );
    }

    const installedState = readCodexPluginState({ codexHome: resolvedCodexHome, runCodex });
    assertActivatedState(installedState, { expectedVersion, marketplaceRoot });
    if (movedExisting) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    const rollbackErrors = [];
    try {
      await restoreMarketplaceReplacement({ marketplaceRoot, backup, movedExisting, placedMarketplace, staging });
    } catch (rollbackError) {
      rollbackErrors.push(`filesystem: ${rollbackError.message}`);
    }
    if (priorState && (marketplaceAddAttempted || pluginAddAttempted)) {
      try {
        restoreCodexPluginState({ priorState, codexHome: resolvedCodexHome, runCodex });
      } catch (rollbackError) {
        rollbackErrors.push(`Codex registration: ${rollbackError.message}`);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new Error(`${error.message} Rollback failed (${rollbackErrors.join("; ")}).`, { cause: error });
    }
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
    await releaseInstallLock(lock, lockOwner);
  }

  return plan;
}

export async function installFromOptions(options = {}) {
  if (options.targetRoot && options.codexHome) {
    throw new Error("--target-dir is files-only and cannot be combined with --codex-home; choose one isolated destination mode.");
  }
  const expectedVersion = await resolveLineageVersion(options);
  const activate = options.activate ?? !options.targetRoot;
  if (options.pluginDir) {
    if (activate) {
      return installPluginMarketplace({
        pluginDir: options.pluginDir,
        expectedVersion,
        codexHome: options.codexHome,
        dryRun: options.dryRun,
        runCodex: options.runCodex,
      });
    }
    return installPluginDirectory({
      pluginDir: options.pluginDir,
      targetRoot: options.targetRoot || (options.codexHome ? path.join(options.codexHome, "plugins", "local") : undefined),
      expectedVersion,
      dryRun: options.dryRun,
    });
  }

  return installPluginArtifact({
    artifactFile: options.artifactFile,
    checksumFile: options.checksumFile,
    artifactUrl: options.artifactUrl,
    checksumUrl: options.checksumUrl,
    releaseBaseUrl: options.releaseBaseUrl,
    githubRepo: options.githubRepo,
    targetRoot: options.targetRoot || (options.codexHome ? path.join(options.codexHome, "plugins", "local") : undefined),
    expectedVersion,
    dryRun: options.dryRun,
    fetchBytes: options.fetchBytes,
    activate,
    codexHome: options.codexHome,
    runCodex: options.runCodex,
  });
}

export async function doctorPluginInstallation({
  version,
  channel = "latest",
  codexHome = defaultCodexHome(),
  runCommand = runCommandSync,
  runCodex = runCodexCommandSync,
} = {}) {
  const expectedVersion = await resolveLineageVersion({ version, channel, runCommand });
  const resolvedCodexHome = path.resolve(codexHome);
  const marketplaceRoot = defaultMarketplaceRoot(resolvedCodexHome);
  const manifestPath = path.join(marketplaceRoot, "plugins", PLUGIN_ARTIFACT_NAME, PLUGIN_MANIFEST_PATH);
  const checks = [];
  const diagnoses = [];
  let state;
  if (!await pathExists(resolvedCodexHome)) {
    checks.push({ id: "codex_cli", status: "fail", message: `Codex home does not exist: ${resolvedCodexHome}` });
    diagnoses.push("codex_home_missing");
  } else {
    try {
      state = readCodexPluginState({ codexHome: resolvedCodexHome, runCodex });
      checks.push({ id: "codex_cli", status: "pass", message: `Codex inspected ${resolvedCodexHome}` });
    } catch (error) {
      checks.push({ id: "codex_cli", status: "fail", message: error.message });
      diagnoses.push("codex_cli_unavailable");
    }
  }

  const actualMarketplaceRoot = state?.marketplace?.root;
  checks.push(actualMarketplaceRoot === canonicalPath(marketplaceRoot)
    ? { id: "marketplace", status: "pass", message: `Lineage marketplace is registered at ${marketplaceRoot}` }
    : { id: "marketplace", status: "fail", message: `Lineage marketplace root is ${actualMarketplaceRoot || "<missing>"}; expected ${canonicalPath(marketplaceRoot)}` });
  if (actualMarketplaceRoot !== canonicalPath(marketplaceRoot)) {
    diagnoses.push(actualMarketplaceRoot ? "marketplace_mismatch" : "marketplace_missing");
  }

  const plugin = state?.plugin;
  const pluginMatches = plugin?.pluginId === CODEX_PLUGIN_ID
    && plugin.installed === true
    && plugin.enabled === true
    && plugin.version === expectedVersion;
  checks.push(pluginMatches
    ? { id: "plugin_state", status: "pass", message: `${CODEX_PLUGIN_ID}@${expectedVersion} is installed and enabled` }
    : {
        id: "plugin_state",
        status: "fail",
        message: `${CODEX_PLUGIN_ID} is installed=${plugin?.installed === true}, enabled=${plugin?.enabled === true}, version=${plugin?.version || "<missing>"}; expected ${expectedVersion}`,
      });
  if (plugin?.installed !== true) diagnoses.push("plugin_missing");
  else {
    if (plugin.enabled !== true) diagnoses.push("plugin_disabled");
    if (plugin.version !== expectedVersion) diagnoses.push("plugin_version_mismatch");
  }

  try {
    assertPluginManifest(JSON.parse(await readFile(manifestPath, "utf8")), expectedVersion);
    checks.push({ id: "manifest", status: "pass", message: `Verified ${manifestPath}` });
  } catch (error) {
    checks.push({ id: "manifest", status: "fail", message: `Plugin manifest check failed at ${manifestPath}: ${error.message}` });
    diagnoses.push("manifest_missing_or_invalid");
  }

  const ok = checks.every((check) => check.status === "pass");

  return {
    checks,
    codexHome: resolvedCodexHome,
    diagnoses,
    expectedLineageVersion: expectedVersion,
    marketplaceRoot,
    ok,
    pluginId: CODEX_PLUGIN_ID,
    remediation: ok ? null : pluginDoctorRemediation({ expectedVersion, codexHome: resolvedCodexHome, diagnoses }),
    schemaVersion: "lineage.plugin_doctor.v1",
  };
}

export async function installPluginArtifact({
  artifactFile,
  checksumFile,
  artifactUrl,
  checksumUrl,
  releaseBaseUrl,
  githubRepo,
  targetRoot,
  expectedVersion,
  dryRun = false,
  fetchBytes = fetchBytesFromUrl,
  activate = false,
  codexHome,
  runCodex = runCodexCommandSync,
} = {}) {
  if (!expectedVersion) throw new Error("expectedVersion is required.");

  const resolvedUrls =
    artifactUrl || artifactFile
      ? { artifactUrl, checksumUrl }
      : releaseArtifactUrls({ version: expectedVersion, githubRepo, releaseBaseUrl });
  const artifactBytes = await readArtifactBytes({
    artifactFile,
    artifactUrl: resolvedUrls.artifactUrl,
    fetchBytes,
  });
  const expectedSha256 = await readExpectedChecksum({
    checksumFile,
    checksumUrl: resolvedUrls.checksumUrl,
    fetchBytes,
  });
  const checksum = assertChecksum(artifactBytes, expectedSha256);
  const tempRoot = await mkdtemp(path.join(tmpdir(), "lineage-plugin-artifact-"));

  try {
    const artifactPath = path.join(tempRoot, pluginArtifactFilename(expectedVersion));
    await writeFile(artifactPath, artifactBytes);
    assertSafeTarballEntries(artifactPath);
    extractTarball(artifactPath, tempRoot);
    const pluginDir = path.join(tempRoot, "package");
    const result = activate
      ? await installPluginMarketplace({ pluginDir, expectedVersion, codexHome, dryRun, runCodex })
      : await installPluginDirectory({ pluginDir, targetRoot, expectedVersion, dryRun });
    return {
      ...result,
      checksum,
      artifact: artifactFile ? path.resolve(artifactFile) : resolvedUrls.artifactUrl,
      checksumSource: checksumFile ? path.resolve(checksumFile) : resolvedUrls.checksumUrl,
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

export async function fetchBytesFromUrl(url) {
  if (!url) throw new Error("url is required.");
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function readArtifactBytes({ artifactFile, artifactUrl, fetchBytes }) {
  if (artifactFile) return readFile(artifactFile);
  if (artifactUrl) return fetchBytes(artifactUrl);
  throw new Error("artifactFile or artifactUrl is required.");
}

async function readExpectedChecksum({ checksumFile, checksumUrl, fetchBytes }) {
  if (checksumFile) return parseChecksumText(await readFile(checksumFile, "utf8"));
  if (checksumUrl) return parseChecksumText((await fetchBytes(checksumUrl)).toString("utf8"));
  throw new Error("checksumFile or checksumUrl is required.");
}

function extractTarball(artifactPath, destination) {
  const result = spawnSync("tar", ["-xzf", artifactPath, "-C", destination], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`Failed to extract plugin artifact: ${result.stderr || result.stdout}`);
  }
}

function assertSafeTarballEntries(artifactPath) {
  const result = spawnSync("tar", ["-tzf", artifactPath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`Failed to inspect plugin artifact: ${result.stderr || result.stdout}`);
  }

  const unsafe = result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((entry) => {
      const normalized = entry.split(path.sep).join("/");
      return (
        path.isAbsolute(entry) ||
        normalized.split("/").includes("..") ||
        /(^|\/)(node_modules|docs\/goals|\.git|\.asset-scratch|.*\.sqlite|.*\.db)(\/|$)/.test(normalized)
      );
    });

  if (unsafe.length > 0) {
    throw new Error(`Plugin artifact contains unsafe entries: ${unsafe.join(", ")}`);
  }
}

export function runCommandSync(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || result.error?.message || "",
  };
}

export function runCodexCommandSync(command, args, { codexHome } = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(codexHome ? { CODEX_HOME: path.resolve(codexHome) } : {}),
    },
  });
  const stderr = result.error?.code === "ENOENT"
    ? "Codex CLI was not found on PATH. Install Codex or restore its executable directory, then verify `codex --version` in this shell before rerunning the Lineage plugin installer."
    : result.stderr || result.error?.message || "";
  return {
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr,
  };
}

function runCodexJson({ runCodex, codexHome, args, label }) {
  const result = runCodex("codex", args, { codexHome });
  if (result.status !== 0) {
    throw new Error(`Failed to ${label}: ${result.stderr || result.stdout || `exit ${result.status}`}`);
  }
  const parsed = safeJsonParse(result.stdout);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Failed to ${label}: Codex returned non-JSON output.`);
  }
  return parsed;
}

function readCodexPluginState({ codexHome, runCodex }) {
  const marketplaceOutput = runCodexJson({
    runCodex,
    codexHome,
    args: ["plugin", "marketplace", "list", "--json"],
    label: "inspect Codex marketplaces",
  });
  const pluginOutput = runCodexJson({
    runCodex,
    codexHome,
    args: ["plugin", "list", "--available", "--json"],
    label: "inspect Codex plugins",
  });
  const marketplace = (marketplaceOutput.marketplaces || []).find(
    (candidate) => candidate?.name === CODEX_MARKETPLACE_NAME,
  );
  const plugins = [...(pluginOutput.installed || []), ...(pluginOutput.available || [])];
  const plugin = plugins.find((candidate) => candidate?.pluginId === CODEX_PLUGIN_ID);
  return {
    marketplace: marketplace
      ? { name: marketplace.name, root: canonicalPath(marketplace.root) }
      : null,
    plugin: plugin
      ? {
          pluginId: plugin.pluginId,
          version: plugin.version || null,
          installed: plugin.installed === true,
          enabled: plugin.enabled === true,
        }
      : null,
  };
}

function assertActivatedState(state, { expectedVersion, marketplaceRoot }) {
  if (state.marketplace?.root !== canonicalPath(marketplaceRoot)) {
    throw new Error(
      `Codex marketplace root ${state.marketplace?.root || "<missing>"} does not match ${canonicalPath(marketplaceRoot)}.`,
    );
  }
  if (!state.plugin?.installed || !state.plugin?.enabled || state.plugin.version !== expectedVersion) {
    throw new Error(
      `Codex plugin state is installed=${state.plugin?.installed === true}, enabled=${state.plugin?.enabled === true}, version=${state.plugin?.version || "<missing>"}; expected installed=true, enabled=true, version=${expectedVersion}.`,
    );
  }
}

function restoreCodexPluginState({ priorState, codexHome, runCodex }) {
  if (priorState.plugin?.installed) {
    runCodexJson({
      runCodex,
      codexHome,
      args: ["plugin", "add", CODEX_PLUGIN_ID, "--json"],
      label: "restore the prior Lineage plugin installation",
    });
  } else {
    runCodex("codex", ["plugin", "remove", CODEX_PLUGIN_ID, "--json"], { codexHome });
  }

  if (!priorState.marketplace) {
    runCodex("codex", ["plugin", "marketplace", "remove", CODEX_MARKETPLACE_NAME, "--json"], { codexHome });
  }

  const restored = readCodexPluginState({ codexHome, runCodex });
  if (!sameCodexPluginState(priorState, restored)) {
    throw new Error(`post-rollback Codex state does not match the pre-install state`);
  }
}

function sameCodexPluginState(left, right) {
  return left.marketplace?.root === right.marketplace?.root
    && left.plugin?.pluginId === right.plugin?.pluginId
    && left.plugin?.version === right.plugin?.version
    && left.plugin?.installed === right.plugin?.installed
    && left.plugin?.enabled === right.plugin?.enabled;
}

function canonicalPath(value) {
  try {
    return realpathSync(path.resolve(value));
  } catch {
    return path.resolve(value);
  }
}

async function recoverMarketplaceReplacement({ marketplaceRoot, backup }) {
  const backupExists = await pathExists(backup);
  const marketplaceExists = await pathExists(marketplaceRoot);
  if (backupExists && !marketplaceExists) {
    await rename(backup, marketplaceRoot);
  } else if (backupExists) {
    await rm(backup, { recursive: true, force: true });
  }
}

async function restoreMarketplaceReplacement({ marketplaceRoot, backup, movedExisting, placedMarketplace, staging }) {
  await rm(staging, { recursive: true, force: true });
  if (placedMarketplace) await rm(marketplaceRoot, { recursive: true, force: true });
  if (movedExisting) await rename(backup, marketplaceRoot);
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function acquireInstallLock(lock, owner, pluginName, targetRoot) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await symlink(owner, lock);
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let existingOwner;
      try {
        existingOwner = await readlink(lock);
      } catch (readError) {
        throw new Error(`Another ${pluginName} install is already active at ${targetRoot}.`, { cause: readError });
      }
      const pid = Number.parseInt(existingOwner.split(":", 1)[0], 10);
      if (!Number.isInteger(pid) || pid <= 0 || isProcessAlive(pid)) {
        throw new Error(`Another ${pluginName} install is already active at ${targetRoot}.`, { cause: error });
      }
      await rm(lock, { force: true });
    }
  }
  throw new Error(`Could not acquire the ${pluginName} install lock at ${targetRoot}.`);
}

async function releaseInstallLock(lock, owner) {
  try {
    if ((await readlink(lock)) === owner) await rm(lock, { force: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function isAllowedInstallPath(source) {
  const normalized = source.split(path.sep).join("/");
  return !/(^|\/)(node_modules|docs\/goals|\.git|\.asset-scratch)(\/|$)/.test(normalized);
}
