#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const VERSION = '0.2.0';
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = resolve(SCRIPT_DIR, '..');
const DEFAULT_NETWORK_FILE = resolve(SKILL_ROOT, 'assets', 'networks.json');
const DEFAULT_PHAROS_ENGINE_NETWORK_FILE = resolve(SKILL_ROOT, '.agents', 'skills', 'pharos-skill-engine', 'assets', 'networks.json');
const DEFAULT_NETWORK_IDS = ['pharos-mainnet', 'pharos-atlantic-testnet'];
const execFileAsync = promisify(execFile);

const PHAROS_ENGINE_NETWORK_NAMES = {
  'pharos-mainnet': 'mainnet',
  'pharos-atlantic-testnet': 'atlantic-testnet'
};

const ALLOWED_ENTRYPOINT_TYPES = new Set([
  'read',
  'write',
  'transaction',
  'payment',
  'oracle',
  'tool',
  'prompt',
  'workflow'
]);

const PROMPT_RISK_PATTERNS = [
  {
    id: 'prompt.ignore-previous',
    severity: 'fail',
    pattern: /ignore\s+(all\s+)?(previous|prior|above|system)\s+instructions/i,
    message: 'Prompt text contains an instruction-override phrase.'
  },
  {
    id: 'prompt.reveal-secrets',
    severity: 'fail',
    pattern: /reveal\s+(your\s+)?(private\s+key|seed\s+phrase|mnemonic|secret|api\s*key|token)/i,
    message: 'Prompt text asks for secret disclosure.'
  },
  {
    id: 'prompt.disable-safety',
    severity: 'warn',
    pattern: /disable\s+(safety|guardrails|validation|checks|filters)/i,
    message: 'Prompt text asks to disable safety or validation behavior.'
  },
  {
    id: 'prompt.jailbreak',
    severity: 'warn',
    pattern: /(jailbreak|developer\s+mode|do\s+anything\s+now)/i,
    message: 'Prompt text contains common jailbreak wording.'
  },
  {
    id: 'prompt.hidden-output',
    severity: 'warn',
    pattern: /do\s+not\s+(tell|show|reveal)\s+(the\s+)?user/i,
    message: 'Prompt text may hide behavior from the user.'
  }
];

const SENSITIVE_KEY_PATTERN = /(private.?key|mnemonic|seed.?phrase|api.?key|secret|bearer|password|token)/i;
const HEX_PRIVATE_KEY_PATTERN = /^0x[a-fA-F0-9]{64}$/;
const ZERO_PRIVATE_KEY_PATTERN = /^0x0{64}$/;

export async function readJsonFile(path) {
  const raw = await readFile(path, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${path}: ${error.message}`);
  }
}

export async function loadNetworkConfig(path = DEFAULT_NETWORK_FILE) {
  const data = await readJsonFile(path);
  if (!Array.isArray(data.networks)) {
    throw new Error(`Network file ${path} must contain a networks array.`);
  }
  const defaults = Array.isArray(data.defaults) ? data.defaults : DEFAULT_NETWORK_IDS;
  return { networks: data.networks, defaults };
}

export async function loadPharosEngineNetworkConfig(path = DEFAULT_PHAROS_ENGINE_NETWORK_FILE) {
  const data = await readJsonFile(path);
  if (!Array.isArray(data.networks)) {
    throw new Error(`Pharos Skill Engine network file ${path} must contain a networks array.`);
  }
  return { networks: data.networks, defaultNetwork: data.defaultNetwork, path };
}

export function selectNetworks(networks, defaults, selector = 'default') {
  const byId = new Map(networks.map((network) => [network.id, network]));
  const ids = selector === 'all'
    ? networks.map((network) => network.id)
    : selector === 'default'
      ? defaults
      : selector.split(',').map((item) => item.trim()).filter(Boolean);

  const selected = [];
  const missing = [];
  for (const id of ids) {
    const network = byId.get(id);
    if (network) {
      selected.push(network);
    } else {
      missing.push(id);
    }
  }
  return { selected, missing };
}

function makeReport(manifestName = 'unknown') {
  return {
    callquarryVersion: VERSION,
    generatedAt: new Date().toISOString(),
    target: {
      name: manifestName
    },
    summary: {
      score: 100,
      status: 'ready',
      totalChecks: 0,
      passed: 0,
      warnings: 0,
      failed: 0,
      skipped: 0
    },
    checks: []
  };
}

function addCheck(report, status, category, id, title, detail, evidence = {}) {
  report.checks.push({ status, category, id, title, detail, evidence });
}

function finalizeReport(report) {
  const counts = {
    pass: 0,
    warn: 0,
    fail: 0,
    skip: 0
  };
  for (const check of report.checks) {
    counts[check.status] += 1;
  }
  const score = Math.max(0, 100 - counts.fail * 18 - counts.warn * 6 - counts.skip * 2);
  report.summary = {
    score,
    status: counts.fail > 0 ? 'blocked' : counts.warn > 0 ? 'needs-review' : 'ready',
    totalChecks: report.checks.length,
    passed: counts.pass,
    warnings: counts.warn,
    failed: counts.fail,
    skipped: counts.skip
  };
  return report;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function checkRequiredString(report, object, key, label, minLength = 1) {
  if (typeof object?.[key] !== 'string' || object[key].trim().length < minLength) {
    addCheck(report, 'fail', 'manifest', `manifest.${key}`, `${label} is required`, `${key} must be a string with at least ${minLength} characters.`);
    return false;
  }
  addCheck(report, 'pass', 'manifest', `manifest.${key}`, `${label} present`, `${key} is set.`, { value: object[key] });
  return true;
}

export function validateManifestShape(manifest, report = makeReport(manifest?.name)) {
  if (!isObject(manifest)) {
    addCheck(report, 'fail', 'manifest', 'manifest.root', 'Manifest must be an object', 'The target manifest JSON root must be an object.');
    return report;
  }

  report.target.name = manifest.name ?? 'unknown';
  report.target.version = manifest.version;

  checkRequiredString(report, manifest, 'name', 'Skill name', 3);
  if (typeof manifest.name === 'string') {
    const validName = /^[a-z][a-z0-9-]{2,63}$/.test(manifest.name);
    addCheck(
      report,
      validName ? 'pass' : 'fail',
      'manifest',
      'manifest.name-format',
      'Skill name format',
      validName ? 'Skill name uses portable lowercase hyphen-case.' : 'Skill name must use lowercase letters, numbers, and hyphens, starting with a letter.',
      { value: manifest.name }
    );
  }

  checkRequiredString(report, manifest, 'version', 'Version', 5);
  if (typeof manifest.version === 'string') {
    const validVersion = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/.test(manifest.version);
    addCheck(
      report,
      validVersion ? 'pass' : 'warn',
      'manifest',
      'manifest.semver',
      'Semantic version',
      validVersion ? 'Version looks like semantic versioning.' : 'Use a semantic version such as 0.1.0.',
      { value: manifest.version }
    );
  }

  checkRequiredString(report, manifest, 'description', 'Description', 40);

  if (!Array.isArray(manifest.networks) || manifest.networks.length === 0) {
    addCheck(report, 'fail', 'manifest', 'manifest.networks', 'Networks required', 'Declare the Pharos networks this Skill supports.');
  } else {
    addCheck(report, 'pass', 'manifest', 'manifest.networks', 'Networks declared', 'Target Skill declares network support.', { networks: manifest.networks });
    for (const requiredNetwork of DEFAULT_NETWORK_IDS) {
      const hasNetwork = manifest.networks.includes(requiredNetwork);
      addCheck(
        report,
        hasNetwork ? 'pass' : 'warn',
        'manifest',
        `manifest.network.${requiredNetwork}`,
        `${requiredNetwork} support`,
        hasNetwork ? `Manifest declares ${requiredNetwork}.` : `Hackathon-ready Pharos Skills should declare ${requiredNetwork}.`,
        { declaredNetworks: manifest.networks }
      );
    }
  }

  validateEntrypoints(manifest.entrypoints, report);
  validateThreatModel(manifest.threatModel, report);
  scanPromptRisks(manifest, report);
  scanSecrets(manifest, report);
  validateTestVectors(manifest.entrypoints, report);
  return report;
}

function validateEntrypoints(entrypoints, report) {
  if (!Array.isArray(entrypoints) || entrypoints.length === 0) {
    addCheck(report, 'fail', 'entrypoint', 'entrypoints.present', 'At least one entrypoint required', 'Reusable Skills must expose at least one callable entrypoint.');
    return;
  }

  addCheck(report, 'pass', 'entrypoint', 'entrypoints.present', 'Entrypoints present', `${entrypoints.length} entrypoint(s) declared.`);
  const seenIds = new Set();

  entrypoints.forEach((entrypoint, index) => {
    const prefix = `entrypoints.${index}`;
    if (!isObject(entrypoint)) {
      addCheck(report, 'fail', 'entrypoint', `${prefix}.object`, 'Entrypoint must be an object', `Entrypoint at index ${index} is not an object.`);
      return;
    }

    const id = entrypoint.id ?? `index-${index}`;
    const idValid = typeof entrypoint.id === 'string' && /^[a-z][a-zA-Z0-9_-]{2,63}$/.test(entrypoint.id);
    addCheck(report, idValid ? 'pass' : 'fail', 'entrypoint', `${prefix}.id`, `Entrypoint ${id} id`, idValid ? 'Entrypoint id is portable.' : 'Entrypoint id must start with a lowercase letter and use letters, numbers, underscores, or hyphens.');

    if (seenIds.has(entrypoint.id)) {
      addCheck(report, 'fail', 'entrypoint', `${prefix}.unique-id`, `Entrypoint ${id} duplicate`, 'Entrypoint ids must be unique.');
    } else if (entrypoint.id) {
      seenIds.add(entrypoint.id);
      addCheck(report, 'pass', 'entrypoint', `${prefix}.unique-id`, `Entrypoint ${id} unique`, 'Entrypoint id is unique.');
    }

    const typeValid = typeof entrypoint.type === 'string' && ALLOWED_ENTRYPOINT_TYPES.has(entrypoint.type);
    addCheck(report, typeValid ? 'pass' : 'fail', 'entrypoint', `${prefix}.type`, `Entrypoint ${id} type`, typeValid ? `Entrypoint type ${entrypoint.type} is supported.` : `Entrypoint type must be one of ${Array.from(ALLOWED_ENTRYPOINT_TYPES).join(', ')}.`);

    const descriptionValid = typeof entrypoint.description === 'string' && entrypoint.description.trim().length >= 30;
    addCheck(report, descriptionValid ? 'pass' : 'warn', 'entrypoint', `${prefix}.description`, `Entrypoint ${id} description`, descriptionValid ? 'Entrypoint has a specific description.' : 'Entrypoint description should explain behavior in at least 30 characters.');

    const inputSchemaValid = isObject(entrypoint.inputSchema) && typeof entrypoint.inputSchema.type === 'string';
    addCheck(report, inputSchemaValid ? 'pass' : 'fail', 'entrypoint', `${prefix}.inputSchema`, `Entrypoint ${id} input schema`, inputSchemaValid ? 'Input schema is present.' : 'inputSchema must be a JSON Schema object with a type.');

    const outputSchemaValid = isObject(entrypoint.outputSchema) && typeof entrypoint.outputSchema.type === 'string';
    addCheck(report, outputSchemaValid ? 'pass' : 'fail', 'entrypoint', `${prefix}.outputSchema`, `Entrypoint ${id} output schema`, outputSchemaValid ? 'Output schema is present.' : 'outputSchema must be a JSON Schema object with a type.');

    const isWriteLike = ['write', 'transaction', 'payment'].includes(entrypoint.type);
    const simulations = Array.isArray(entrypoint.transactionSimulations) ? entrypoint.transactionSimulations : [];
    if (isWriteLike && simulations.length === 0) {
      addCheck(report, 'warn', 'entrypoint', `${prefix}.simulation`, `Entrypoint ${id} gas simulation`, 'Write-like entrypoints should include transactionSimulations for dry-run gas checks.');
    }

    const failureModes = Array.isArray(entrypoint.failureModes) ? entrypoint.failureModes : [];
    addCheck(
      report,
      failureModes.length > 0 ? 'pass' : 'warn',
      'entrypoint',
      `${prefix}.failureModes`,
      `Entrypoint ${id} failure modes`,
      failureModes.length > 0 ? 'Failure modes are documented.' : 'Document expected failure modes for better downstream agent handling.'
    );
  });
}

function validateThreatModel(threatModel, report) {
  if (!isObject(threatModel)) {
    addCheck(report, 'fail', 'security', 'threatModel.present', 'Threat model required', 'Declare permissions, write behavior, and secret requirements.');
    return;
  }
  addCheck(report, 'pass', 'security', 'threatModel.present', 'Threat model present', 'Threat model is declared.');

  const permissionsValid = Array.isArray(threatModel.permissions);
  addCheck(report, permissionsValid ? 'pass' : 'fail', 'security', 'threatModel.permissions', 'Permissions declared', permissionsValid ? 'Permissions are listed.' : 'threatModel.permissions must be an array.');

  const writesValid = typeof threatModel.writes === 'boolean';
  addCheck(report, writesValid ? 'pass' : 'fail', 'security', 'threatModel.writes', 'Write behavior declared', writesValid ? `writes is ${threatModel.writes}.` : 'threatModel.writes must be a boolean.');

  const secretsValid = Array.isArray(threatModel.secrets);
  addCheck(report, secretsValid ? 'pass' : 'fail', 'security', 'threatModel.secrets', 'Secrets declared', secretsValid ? 'Secret requirements are listed.' : 'threatModel.secrets must be an array.');
}

function collectStrings(value, path = '$', out = []) {
  if (typeof value === 'string') {
    out.push({ path, value });
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectStrings(item, `${path}[${index}]`, out));
    return out;
  }
  if (isObject(value)) {
    for (const [key, nested] of Object.entries(value)) {
      collectStrings(nested, `${path}.${key}`, out);
    }
  }
  return out;
}

function scanPromptRisks(manifest, report) {
  const strings = collectStrings(manifest);
  let findings = 0;
  for (const item of strings) {
    for (const risk of PROMPT_RISK_PATTERNS) {
      if (risk.pattern.test(item.value)) {
        findings += 1;
        addCheck(report, risk.severity, 'prompt', risk.id, 'Prompt risk detected', risk.message, { path: item.path });
      }
    }
  }
  if (findings === 0) {
    addCheck(report, 'pass', 'prompt', 'prompt.scan', 'Prompt scan clean', 'No common instruction-override or secret-exfiltration phrases found.');
  }
}

function scanSecrets(value, report, path = '$', keyName = '') {
  if (isObject(value)) {
    for (const [key, nested] of Object.entries(value)) {
      scanSecrets(nested, report, `${path}.${key}`, key, report);
    }
    if (path === '$') {
      addCheck(report, 'pass', 'security', 'secret.scan.complete', 'Secret scan completed', 'Manifest was scanned for obvious live secrets.');
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => scanSecrets(item, report, `${path}[${index}]`, keyName, report));
    return;
  }

  if (typeof value !== 'string') {
    return;
  }

  const keyLooksSensitive = SENSITIVE_KEY_PATTERN.test(keyName);
  const valueLooksSecret = HEX_PRIVATE_KEY_PATTERN.test(value) || value.length > 24;
  const isPlaceholder = value.includes('${') || value.includes('<') || value.toLowerCase().includes('placeholder') || value.toLowerCase().includes('env');

  if (keyLooksSensitive && value.trim() !== '' && valueLooksSecret && !isPlaceholder) {
    addCheck(report, 'fail', 'security', 'secret.live-value', 'Possible live secret in manifest', 'Sensitive-looking key contains a non-placeholder value.', { path });
  }
}

function validateTestVectors(entrypoints, report) {
  if (!Array.isArray(entrypoints)) {
    return;
  }

  let vectorCount = 0;
  for (const entrypoint of entrypoints) {
    if (!isObject(entrypoint) || !Array.isArray(entrypoint.testVectors)) {
      continue;
    }
    for (const vector of entrypoint.testVectors) {
      vectorCount += 1;
      const vectorId = vector?.id ?? `vector-${vectorCount}`;
      const errors = validateJsonSchemaValue(vector?.input, entrypoint.inputSchema, '$');
      addCheck(
        report,
        errors.length === 0 ? 'pass' : 'fail',
        'test-vector',
        `testVector.${entrypoint.id}.${vectorId}`,
        `Test vector ${vectorId}`,
        errors.length === 0 ? 'Sample input matches inputSchema.' : 'Sample input does not match inputSchema.',
        errors.length === 0 ? {} : { errors }
      );
    }
  }

  if (vectorCount === 0) {
    addCheck(report, 'warn', 'test-vector', 'testVector.present', 'No test vectors found', 'Add testVectors so CallQuarry can validate real sample inputs.');
  }
}

export function validateJsonSchemaValue(value, schema, path = '$') {
  const errors = [];
  if (!isObject(schema)) {
    return [`${path}: schema must be an object`];
  }

  if (schema.type) {
    const valid = matchesType(value, schema.type);
    if (!valid) {
      errors.push(`${path}: expected type ${schema.type}, got ${Array.isArray(value) ? 'array' : typeof value}`);
      return errors;
    }
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path}: value must be one of ${schema.enum.join(', ')}`);
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push(`${path}: string shorter than minLength ${schema.minLength}`);
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errors.push(`${path}: string longer than maxLength ${schema.maxLength}`);
    }
    if (typeof schema.pattern === 'string') {
      const pattern = new RegExp(schema.pattern);
      if (!pattern.test(value)) {
        errors.push(`${path}: string does not match pattern ${schema.pattern}`);
      }
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`${path}: number below minimum ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(`${path}: number above maximum ${schema.maximum}`);
    }
  }

  if (schema.type === 'object' && isObject(value)) {
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (!(key in value)) {
        errors.push(`${path}.${key}: required property missing`);
      }
    }

    const properties = isObject(schema.properties) ? schema.properties : {};
    for (const [key, propertyValue] of Object.entries(value)) {
      if (properties[key]) {
        errors.push(...validateJsonSchemaValue(propertyValue, properties[key], `${path}.${key}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}.${key}: additional property not allowed`);
      }
    }
  }

  if (schema.type === 'array' && Array.isArray(value) && schema.items) {
    value.forEach((item, index) => {
      errors.push(...validateJsonSchemaValue(item, schema.items, `${path}[${index}]`));
    });
  }

  return errors;
}

function matchesType(value, type) {
  switch (type) {
    case 'object':
      return isObject(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return true;
  }
}

export async function rpcRequest(network, method, params = [], timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(network.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method,
        params
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message || JSON.stringify(data.error));
    }
    return data.result;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeCastOutput(output) {
  return String(output).trim();
}

function timeoutSeconds(timeoutMs) {
  return String(Math.max(1, Math.ceil(timeoutMs / 1000)));
}

export function pharosEngineNetworkName(network) {
  return PHAROS_ENGINE_NETWORK_NAMES[network.id] ?? network.engineName ?? network.id;
}

export function createCastRpcClient({ runner = execFileAsync, castBin = 'cast' } = {}) {
  return async function castRpcRequest(network, method, params = [], timeoutMs = 8000) {
    const baseArgs = ['--rpc-url', network.rpcUrl, '--rpc-timeout', timeoutSeconds(timeoutMs)];
    let commandArgs;

    switch (method) {
      case 'eth_chainId':
        commandArgs = ['chain-id', ...baseArgs];
        break;
      case 'eth_blockNumber':
        commandArgs = ['block-number', ...baseArgs];
        break;
      case 'eth_gasPrice':
        commandArgs = ['gas-price', ...baseArgs];
        break;
      case 'eth_estimateGas': {
        const tx = params[0] ?? {};
        commandArgs = ['estimate', tx.to ?? tx.from ?? '0x0000000000000000000000000000000000000000', ...baseArgs];
        if (tx.from) commandArgs.push('--from', tx.from);
        if (tx.value) commandArgs.push('--value', tx.value);
        break;
      }
      default:
        commandArgs = ['rpc', method, JSON.stringify(params), '--raw', ...baseArgs];
        break;
    }

    try {
      const { stdout } = await runner(castBin, commandArgs);
      const output = normalizeCastOutput(stdout);
      if (method === 'eth_chainId') return `0x${BigInt(output).toString(16)}`;
      if (method === 'eth_blockNumber') return `0x${BigInt(output).toString(16)}`;
      if (method === 'eth_gasPrice') return `0x${BigInt(output).toString(16)}`;
      if (method === 'eth_estimateGas') return `0x${BigInt(output).toString(16)}`;
      return output;
    } catch (error) {
      const detail = normalizeCastOutput(error.stderr || error.stdout || error.message);
      throw new Error(detail || `cast ${method} failed`);
    }
  };
}

async function checkPharosSkillEngine(report, networks, options) {
  const runner = options.commandRunner ?? execFileAsync;
  const castBin = options.castBin ?? 'cast';
  let ready = true;
  try {
    const { stdout } = await runner(castBin, ['--version']);
    addCheck(report, 'pass', 'pharos-engine', 'engine.cast.available', 'Foundry cast available', `Using ${normalizeCastOutput(stdout).split('\n')[0]}.`);
  } catch (error) {
    addCheck(report, 'fail', 'pharos-engine', 'engine.cast.available', 'Foundry cast required', 'pharos-skill-engine requires Foundry cast for Pharos blockchain tasks. Install Foundry before live engine validation.');
    return { ok: false, networks: [] };
  }

  let engineConfig = options.pharosEngineNetworkConfig;
  if (!engineConfig) {
    const engineNetworkFile = options.pharosEngineNetworkFile ?? DEFAULT_PHAROS_ENGINE_NETWORK_FILE;
    try {
      engineConfig = await loadPharosEngineNetworkConfig(engineNetworkFile);
    } catch (error) {
      addCheck(
        report,
        'fail',
        'pharos-engine',
        'engine.config.present',
        'Pharos Skill Engine installed',
        `Could not read ${engineNetworkFile}. Run: npx skills add https://github.com/PharosNetwork/pharos-skill-engine`,
        { error: error.message }
      );
      return { ok: false, networks: [] };
    }
  }

  const engineSource = engineConfig.path ?? 'provided Pharos Skill Engine config';
  addCheck(report, 'pass', 'pharos-engine', 'engine.config.present', 'Pharos Skill Engine config loaded', `Loaded official Pharos network config from ${engineSource}.`, {
    networks: engineConfig.networks.map((network) => network.name).filter(Boolean)
  });

  const byEngineName = new Map(engineConfig.networks.map((network) => [network.name, network]));
  const engineNetworks = [];
  for (const network of networks) {
    const engineName = pharosEngineNetworkName(network);
    const officialNetwork = byEngineName.get(engineName);
    if (!officialNetwork) {
      ready = false;
    }
    addCheck(
      report,
      officialNetwork ? 'pass' : 'fail',
      'pharos-engine',
      `engine.network.${network.id}`,
      `${network.name} engine mapping`,
      officialNetwork ? `Mapped to pharos-skill-engine network "${engineName}" and will use its official RPC config.` : `No installed pharos-skill-engine config exists for "${engineName}".`,
      { network: network.id, engineName, rpcUrl: officialNetwork?.rpcUrl, chainId: officialNetwork?.chainId }
    );

    if (officialNetwork) {
      engineNetworks.push({
        ...network,
        rpcUrl: officialNetwork.rpcUrl,
        chainId: officialNetwork.chainId,
        explorerUrl: officialNetwork.explorerUrl ?? network.explorerUrl,
        explorerApiUrl: officialNetwork.explorerApiUrl ?? network.explorerApiUrl,
        nativeToken: officialNetwork.nativeToken ?? network.nativeToken,
        engineName,
        engineSource
      });
    }
  }
  return { ok: ready && engineNetworks.length === networks.length, networks: engineNetworks };
}

async function runNetworkChecks(report, manifest, networks, options) {
  if (options.offline) {
    for (const network of networks) {
      addCheck(report, 'skip', 'network', `network.${network.id}.offline`, `${network.name} skipped`, 'Offline mode enabled; live RPC checks were skipped.');
    }
    return;
  }

  let client = options.rpcClient ?? rpcRequest;
  let networksToCheck = networks;
  if (options.pharosEngine && !options.rpcClient) {
    const engineReady = await checkPharosSkillEngine(report, networks, options);
    if (!engineReady.ok) return;
    networksToCheck = engineReady.networks;
    client = createCastRpcClient({
      runner: options.commandRunner,
      castBin: options.castBin
    });
  }
  for (const network of networksToCheck) {
    await probeNetwork(report, network, options.timeoutMs, client);
    await runDeclaredReadCalls(report, manifest, network, options.timeoutMs, client);
    await runTransactionSimulations(report, manifest, network, options.timeoutMs, client);
  }
}

async function probeNetwork(report, network, timeoutMs, client = rpcRequest) {
  try {
    const chainIdHex = await client(network, 'eth_chainId', [], timeoutMs);
    const chainId = Number.parseInt(chainIdHex, 16);
    const matches = chainId === network.chainId;
    addCheck(
      report,
      matches ? 'pass' : 'fail',
      'network',
      `network.${network.id}.chainId`,
      `${network.name} chain ID`,
      matches ? `RPC returned expected chain ID ${network.chainId}.` : `RPC returned chain ID ${chainId}, expected ${network.chainId}.`,
      { rpcUrl: network.rpcUrl, chainIdHex }
    );
  } catch (error) {
    addCheck(report, 'fail', 'network', `network.${network.id}.chainId`, `${network.name} chain ID`, `Unable to read eth_chainId: ${error.message}`, { rpcUrl: network.rpcUrl });
    return;
  }

  try {
    const blockNumberHex = await client(network, 'eth_blockNumber', [], timeoutMs);
    const blockNumber = Number.parseInt(blockNumberHex, 16);
    addCheck(
      report,
      Number.isFinite(blockNumber) && blockNumber >= 0 ? 'pass' : 'warn',
      'network',
      `network.${network.id}.blockNumber`,
      `${network.name} block height`,
      Number.isFinite(blockNumber) ? `RPC returned block ${blockNumber}.` : 'RPC returned an invalid block number.',
      { blockNumberHex }
    );
  } catch (error) {
    addCheck(report, 'warn', 'network', `network.${network.id}.blockNumber`, `${network.name} block height`, `Unable to read eth_blockNumber: ${error.message}`);
  }

  try {
    const gasPriceHex = await client(network, 'eth_gasPrice', [], timeoutMs);
    addCheck(report, 'pass', 'network', `network.${network.id}.gasPrice`, `${network.name} gas price`, 'RPC returned gas price.', { gasPriceHex });
  } catch (error) {
    addCheck(report, 'warn', 'network', `network.${network.id}.gasPrice`, `${network.name} gas price`, `Unable to read eth_gasPrice: ${error.message}`);
  }
}

async function runDeclaredReadCalls(report, manifest, network, timeoutMs, client = rpcRequest) {
  const calls = [];
  for (const entrypoint of manifest.entrypoints ?? []) {
    for (const call of entrypoint.readCalls ?? []) {
      calls.push({ entrypointId: entrypoint.id, ...call });
    }
  }

  if (calls.length === 0) {
    addCheck(report, 'warn', 'rpc-read', `read.${network.id}.present`, `${network.name} read probes`, 'No readCalls declared for live RPC validation.');
    return;
  }

  for (const call of calls) {
    const id = call.id ?? call.method ?? 'read-call';
    if (typeof call.method !== 'string' || !Array.isArray(call.params)) {
      addCheck(report, 'fail', 'rpc-read', `read.${network.id}.${id}.shape`, `${network.name} ${id}`, 'readCalls require method and params.');
      continue;
    }
    try {
      const result = await client(network, call.method, call.params, timeoutMs);
      addCheck(report, 'pass', 'rpc-read', `read.${network.id}.${id}`, `${network.name} ${id}`, `${call.method} returned successfully.`, { resultPreview: previewValue(result) });
    } catch (error) {
      addCheck(report, 'fail', 'rpc-read', `read.${network.id}.${id}`, `${network.name} ${id}`, `${call.method} failed: ${error.message}`);
    }
  }
}

async function runTransactionSimulations(report, manifest, network, timeoutMs, client = rpcRequest) {
  const simulations = [];
  for (const entrypoint of manifest.entrypoints ?? []) {
    for (const simulation of entrypoint.transactionSimulations ?? []) {
      simulations.push({ entrypointId: entrypoint.id, ...simulation });
    }
  }

  if (simulations.length === 0) {
    return;
  }

  for (const simulation of simulations) {
    const id = simulation.id ?? 'transaction-simulation';
    const tx = {
      from: simulation.from,
      to: simulation.to,
      data: simulation.data ?? '0x',
      value: simulation.value ?? '0x0'
    };
    try {
      const gasHex = await client(network, 'eth_estimateGas', [tx], timeoutMs);
      addCheck(report, 'pass', 'gas', `gas.${network.id}.${id}`, `${network.name} ${id}`, 'eth_estimateGas returned successfully.', { gasHex });
    } catch (error) {
      const status = simulation.allowFailure ? 'warn' : 'fail';
      addCheck(report, status, 'gas', `gas.${network.id}.${id}`, `${network.name} ${id}`, `eth_estimateGas failed: ${error.message}`);
    }
  }
}

function previewValue(value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  return serialized.length > 140 ? `${serialized.slice(0, 137)}...` : serialized;
}

export async function runValidation(options) {
  const manifest = options.manifestObject ?? await readJsonFile(options.manifestPath);
  const report = validateManifestShape(manifest);

  const networkConfig = options.networks
    ? { networks: options.networks, defaults: options.defaultNetworkIds ?? DEFAULT_NETWORK_IDS }
    : await loadNetworkConfig(options.networkFile);

  const selector = options.networkSelector ?? 'default';
  const { selected, missing } = selectNetworks(networkConfig.networks, networkConfig.defaults, selector);
  for (const missingId of missing) {
    addCheck(report, 'fail', 'network', `network.${missingId}.configured`, `Network ${missingId} configured`, 'Requested network id is not present in the network config.');
  }
  if (selected.length === 0) {
    addCheck(report, 'fail', 'network', 'network.selected', 'Networks selected', 'No valid networks selected for validation.');
  } else {
    addCheck(report, 'pass', 'network', 'network.selected', 'Networks selected', 'Selected networks are configured.', { networks: selected.map((network) => network.id) });
  }

  await runNetworkChecks(report, manifest, selected, {
    offline: Boolean(options.offline),
    timeoutMs: options.timeoutMs ?? 8000,
    rpcClient: options.rpcClient,
    pharosEngine: Boolean(options.pharosEngine),
    pharosEngineNetworkConfig: options.pharosEngineNetworkConfig,
    pharosEngineNetworkFile: options.pharosEngineNetworkFile,
    commandRunner: options.commandRunner,
    castBin: options.castBin
  });

  return finalizeReport(report);
}

function assertHexData(data) {
  return typeof data === 'string' && /^0x([a-fA-F0-9]{2})*$/.test(data);
}

function assertWeiString(value) {
  try {
    return BigInt(value) >= 0n;
  } catch {
    return false;
  }
}

function coerceString(value) {
  return typeof value === 'bigint' ? value.toString() : String(value);
}

export async function defaultWalletProofAdapter({
  network,
  privateKey,
  to,
  valueWei,
  data,
  broadcast,
  confirmations
}) {
  const { createPublicClient, http, keccak256 } = await import('viem');
  const { privateKeyToAccount } = await import('viem/accounts');
  const account = privateKeyToAccount(privateKey);
  const address = account.address;
  const recipient = to ?? address;
  const chain = {
    id: network.chainId,
    name: network.name,
    nativeCurrency: network.nativeCurrency ?? {
      name: 'Native Token',
      symbol: 'NATIVE',
      decimals: 18
    },
    rpcUrls: {
      default: {
        http: [network.rpcUrl]
      }
    }
  };
  const client = createPublicClient({
    chain,
    transport: http(network.rpcUrl)
  });
  const chainId = await client.getChainId();
  const request = {
    account,
    to: recipient,
    value: BigInt(valueWei),
    data
  };
  const balanceBefore = await client.getBalance({ address });
  const gasEstimate = await client.estimateGas(request);
  const gasPrice = await client.getGasPrice();
  const nonce = await client.getTransactionCount({ address });
  const signedTransaction = await account.signTransaction({
    chainId: network.chainId,
    to: recipient,
    value: BigInt(valueWei),
    data,
    gas: gasEstimate,
    gasPrice,
    nonce
  });
  const signedTransactionHash = keccak256(signedTransaction);

  let transactionHash;
  let receiptStatus;
  let blockNumber;
  let balanceAfter;
  if (broadcast) {
    transactionHash = await client.sendRawTransaction({ serializedTransaction: signedTransaction });
    if (confirmations > 0) {
      const receipt = await client.waitForTransactionReceipt({ hash: transactionHash, confirmations });
      receiptStatus = receipt.status === 'success' ? 1 : 0;
      blockNumber = Number(receipt.blockNumber);
      balanceAfter = await client.getBalance({ address });
    }
  }

  return {
    address,
    to: recipient,
    chainId,
    balanceBeforeWei: coerceString(balanceBefore),
    balanceAfterWei: balanceAfter === undefined ? undefined : coerceString(balanceAfter),
    gasEstimate: coerceString(gasEstimate),
    signedTransactionHash,
    transactionHash,
    receiptStatus,
    blockNumber
  };
}

export async function runWalletProof(options) {
  const report = makeReport('wallet-proof');
  const networkConfig = options.networks
    ? { networks: options.networks, defaults: options.defaultNetworkIds ?? ['pharos-atlantic-testnet'] }
    : await loadNetworkConfig(options.networkFile);
  const selector = options.networkSelector ?? 'pharos-atlantic-testnet';
  const { selected, missing } = selectNetworks(networkConfig.networks, networkConfig.defaults, selector);

  for (const missingId of missing) {
    addCheck(report, 'fail', 'wallet-proof', `wallet.network.${missingId}`, `Network ${missingId} configured`, 'Requested network id is not present in the network config.');
  }

  if (selected.length !== 1) {
    addCheck(report, 'fail', 'wallet-proof', 'wallet.network.count', 'Exactly one network required', 'Signed wallet proof must target exactly one network.');
    return finalizeReport(report);
  }

  const network = selected[0];
  report.target.name = `wallet-proof:${network.id}`;
  report.target.network = network.id;
  addCheck(report, 'pass', 'wallet-proof', 'wallet.network.selected', 'Proof network selected', `Selected ${network.name}.`, { network: network.id, chainId: network.chainId });

  const isMainnet = network.environment === 'mainnet' || network.id.includes('mainnet');
  if (isMainnet && !options.allowMainnet) {
    addCheck(report, 'fail', 'wallet-proof', 'wallet.mainnet.guard', 'Mainnet guard active', 'Refusing signed mainnet proof unless --allow-mainnet is supplied.');
    return finalizeReport(report);
  }
  addCheck(report, 'pass', 'wallet-proof', 'wallet.mainnet.guard', 'Mainnet guard checked', isMainnet ? 'Mainnet proof explicitly allowed.' : 'Network is not mainnet.');

  const privateKeyEnv = options.privateKeyEnv ?? 'PHAROS_PRIVATE_KEY';
  const privateKey = options.env?.[privateKeyEnv] ?? process.env[privateKeyEnv];
  if (!privateKey) {
    addCheck(report, 'fail', 'wallet-proof', 'wallet.privateKey.present', 'Private key env var required', `Set ${privateKeyEnv} in your shell environment. Never commit it.`);
    return finalizeReport(report);
  }
  if (!HEX_PRIVATE_KEY_PATTERN.test(privateKey) || ZERO_PRIVATE_KEY_PATTERN.test(privateKey)) {
    addCheck(report, 'fail', 'wallet-proof', 'wallet.privateKey.format', 'Private key format', 'Private key must be a non-zero 0x-prefixed 32-byte hex string.');
    return finalizeReport(report);
  }
  addCheck(report, 'pass', 'wallet-proof', 'wallet.privateKey.format', 'Private key format', `Loaded private key from ${privateKeyEnv}; value is not printed or stored.`);

  const valueWei = options.valueWei ?? '0';
  if (!assertWeiString(valueWei)) {
    addCheck(report, 'fail', 'wallet-proof', 'wallet.valueWei', 'Transaction value', '--value-wei must be a non-negative integer string.');
    return finalizeReport(report);
  }

  const data = options.data ?? '0x';
  if (!assertHexData(data)) {
    addCheck(report, 'fail', 'wallet-proof', 'wallet.data', 'Transaction data', '--data must be 0x-prefixed even-length hex bytes.');
    return finalizeReport(report);
  }

  const broadcast = Boolean(options.broadcast);
  if (broadcast && !options.consent) {
    addCheck(report, 'fail', 'wallet-proof', 'wallet.consent', 'Broadcast consent required', 'Use --i-understand-this-spends-gas before broadcasting a signed transaction.');
    return finalizeReport(report);
  }
  addCheck(report, 'pass', 'wallet-proof', 'wallet.consent', 'Broadcast mode checked', broadcast ? 'Broadcast consent flag was supplied.' : 'Dry proof mode only; transaction will not be broadcast.');

  const adapter = options.proofAdapter ?? defaultWalletProofAdapter;
  try {
    const proof = await adapter({
      network,
      privateKey,
      to: options.to,
      valueWei,
      data,
      broadcast,
      confirmations: options.confirmations ?? 1,
      timeoutMs: options.timeoutMs ?? 8000
    });

    report.target.address = proof.address;
    const chainMatches = proof.chainId === network.chainId;
    addCheck(report, chainMatches ? 'pass' : 'fail', 'wallet-proof', 'wallet.chainId', 'RPC chain ID', chainMatches ? `RPC returned expected chain ID ${network.chainId}.` : `RPC returned chain ID ${proof.chainId}, expected ${network.chainId}.`, { chainId: proof.chainId });
    addCheck(report, 'pass', 'wallet-proof', 'wallet.balance', 'Wallet balance read', 'Wallet balance was read before proof transaction.', { address: proof.address, balanceBeforeWei: proof.balanceBeforeWei });
    addCheck(report, 'pass', 'wallet-proof', 'wallet.gasEstimate', 'Gas estimate', 'Transaction gas was estimated successfully.', { gasEstimate: proof.gasEstimate });
    addCheck(report, 'pass', 'wallet-proof', 'wallet.signed', 'Transaction signed', 'Transaction was signed locally; raw signed bytes are not printed.', { signedTransactionHash: proof.signedTransactionHash, from: proof.address, to: proof.to, valueWei });

    if (broadcast) {
      if (proof.transactionHash) {
        addCheck(report, 'pass', 'wallet-proof', 'wallet.broadcast', 'Transaction broadcast', 'Signed proof transaction was broadcast.', {
          transactionHash: proof.transactionHash,
          explorerUrl: network.explorerUrl ? `${network.explorerUrl.replace(/\/$/, '')}/tx/${proof.transactionHash}` : undefined
        });
      } else {
        addCheck(report, 'fail', 'wallet-proof', 'wallet.broadcast', 'Transaction broadcast', 'Proof adapter did not return a transaction hash.');
      }

      if (proof.receiptStatus === undefined) {
        addCheck(report, 'warn', 'wallet-proof', 'wallet.receipt', 'Transaction receipt', 'Broadcast completed, but receipt waiting was disabled or unavailable.');
      } else {
        addCheck(report, proof.receiptStatus === 1 ? 'pass' : 'fail', 'wallet-proof', 'wallet.receipt', 'Transaction receipt', proof.receiptStatus === 1 ? 'Proof transaction confirmed successfully.' : 'Proof transaction receipt reported failure.', { blockNumber: proof.blockNumber, balanceAfterWei: proof.balanceAfterWei });
      }
    } else {
      addCheck(report, 'skip', 'wallet-proof', 'wallet.broadcast', 'Transaction broadcast skipped', 'Dry proof mode signed the transaction but did not broadcast it.');
    }
  } catch (error) {
    addCheck(report, 'fail', 'wallet-proof', 'wallet.adapter', 'Wallet proof execution', error.message);
  }

  return finalizeReport(report);
}

export function formatTextReport(report) {
  const lines = [];
  lines.push(`CallQuarry ${report.callquarryVersion} report`);
  lines.push(`Target: ${report.target.name}${report.target.version ? `@${report.target.version}` : ''}`);
  lines.push(`Status: ${report.summary.status}`);
  lines.push(`Score: ${report.summary.score}/100`);
  lines.push(`Checks: ${report.summary.passed} passed, ${report.summary.warnings} warnings, ${report.summary.failed} failed, ${report.summary.skipped} skipped`);
  lines.push('');

  for (const check of report.checks) {
    const label = check.status.toUpperCase().padEnd(4, ' ');
    lines.push(`[${label}] ${check.category}/${check.id} - ${check.title}`);
    lines.push(`       ${check.detail}`);
  }

  return `${lines.join('\n')}\n`;
}

export function parseArgs(argv) {
  const args = [...argv];
  const command = args[0] && !args[0].startsWith('-') ? args.shift() : 'validate';
  const options = {
    command,
    networkSelector: command === 'prove-wallet' ? 'pharos-atlantic-testnet' : 'default',
    networkFile: DEFAULT_NETWORK_FILE,
    timeoutMs: 8000,
    format: 'text',
    offline: false,
    strict: false,
    pharosEngine: false,
    castBin: 'cast',
    privateKeyEnv: 'PHAROS_PRIVATE_KEY',
    valueWei: '0',
    data: '0x',
    confirmations: 1
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case '--manifest':
      case '-m':
        options.manifestPath = resolve(args[++index]);
        break;
      case '--networks':
      case '-n':
        options.networkSelector = args[++index];
        break;
      case '--network':
        options.networkSelector = args[++index];
        break;
      case '--network-file':
        options.networkFile = resolve(args[++index]);
        break;
      case '--timeout-ms':
        options.timeoutMs = Number.parseInt(args[++index], 10);
        break;
      case '--format':
        options.format = args[++index];
        break;
      case '--out':
      case '-o':
        options.out = resolve(args[++index]);
        break;
      case '--offline':
        options.offline = true;
        break;
      case '--strict':
        options.strict = true;
        break;
      case '--pharos-engine':
        options.pharosEngine = true;
        break;
      case '--cast-bin':
        options.castBin = args[++index];
        break;
      case '--pharos-engine-network-file':
        options.pharosEngineNetworkFile = resolve(args[++index]);
        break;
      case '--private-key-env':
        options.privateKeyEnv = args[++index];
        break;
      case '--to':
        options.to = args[++index];
        break;
      case '--value-wei':
        options.valueWei = args[++index];
        break;
      case '--data':
        options.data = args[++index];
        break;
      case '--broadcast':
        options.broadcast = true;
        break;
      case '--i-understand-this-spends-gas':
        options.consent = true;
        break;
      case '--allow-mainnet':
        options.allowMainnet = true;
        break;
      case '--wait-confirmations':
        options.confirmations = Number.parseInt(args[++index], 10);
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function usage() {
  return `CallQuarry ${VERSION}

Usage:
  callquarry validate --manifest <file> [options]
  callquarry prove-wallet [options]

Options:
  --networks <ids>      Comma-separated network IDs, "default", or "all"
  --network <id>        Single network ID for wallet proof mode
  --network-file <file> Custom network metadata JSON
  --offline             Skip live RPC checks
  --timeout-ms <n>      RPC timeout in milliseconds
  --format <text|json>  Output format
  --out <file>          Save report to a file
  --strict              Exit non-zero on warnings as well as failures
  --pharos-engine       Use pharos-skill-engine-compatible Foundry cast checks
  --cast-bin <path>     cast binary path/name for --pharos-engine, default cast
  --pharos-engine-network-file <file>
                        Override installed pharos-skill-engine networks.json path
  --private-key-env <n> Env var containing private key, default PHAROS_PRIVATE_KEY
  --to <address>        Proof transaction recipient, defaults to signer address
  --value-wei <wei>     Proof transaction value, default 0
  --data <hex>          Proof transaction calldata, default 0x
  --broadcast           Broadcast signed proof transaction
  --i-understand-this-spends-gas
                        Required with --broadcast
  --allow-mainnet       Required to run signed proof on mainnet
  --wait-confirmations <n>
                        Confirmations to wait after broadcast, default 1
  --help                Show this help
`;
}

async function writeReport(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(usage());
    return 0;
  }
  if (!['validate', 'prove-wallet'].includes(options.command)) {
    throw new Error(`Unsupported command: ${options.command}`);
  }
  if (options.command === 'validate' && !options.manifestPath) {
    throw new Error('Missing --manifest <file>.');
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive number.');
  }
  if (!['text', 'json'].includes(options.format)) {
    throw new Error('--format must be "text" or "json".');
  }

  if (!Number.isInteger(options.confirmations) || options.confirmations < 0) {
    throw new Error('--wait-confirmations must be a non-negative integer.');
  }

  const report = options.command === 'validate'
    ? await runValidation(options)
    : await runWalletProof(options);
  const output = options.format === 'json'
    ? `${JSON.stringify(report, null, 2)}\n`
    : formatTextReport(report);

  if (options.out) {
    await writeReport(options.out, output);
  }
  process.stdout.write(output);

  if (report.summary.failed > 0 || (options.strict && report.summary.warnings > 0)) {
    return 1;
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    process.stderr.write(`CallQuarry error: ${error.message}\n`);
    process.exitCode = 1;
  });
}
