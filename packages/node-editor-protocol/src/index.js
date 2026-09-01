import Ajv2020 from 'ajv/dist/2020.js';
import semver from 'semver';
import schema from '../schemas/protocol.schema.json' with { type: 'json' };

export const protocolSchema = schema;
export const knownCapabilities = Object.freeze([...schema.$defs.Capability.enum]);
export const knownFeatures = Object.freeze([...schema.$defs.Feature.enum]);

export class ProtocolError extends Error {
  /** @param {string} code @param {string} message @param {unknown} [details] */
  constructor(code, message, details) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
    this.details = details;
  }
}

const Ajv2020Constructor = /** @type {typeof import('ajv/dist/2020.js').default} */ (/** @type {unknown} */ (Ajv2020));
const ajv = new Ajv2020Constructor({ allErrors: true, strict: true });
ajv.addFormat('uri', /** @param {string} value */ value => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
});
ajv.addFormat('http-origin', /** @param {string} value */ value => {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && parsed.username === ''
      && parsed.password === ''
      && parsed.pathname === '/'
      && parsed.search === ''
      && parsed.hash === ''
      && parsed.origin === value;
  } catch {
    return false;
  }
});
ajv.addSchema(schema);

/** @type {Map<string, import('ajv').ValidateFunction>} */
const validators = new Map();

/** @param {string} definition */
function validatorFor(definition) {
  let validator = validators.get(definition);
  if (!validator) {
    const compiled = ajv.compile({ $ref: `${schema.$id}#/$defs/${definition}` });
    validators.set(definition, compiled);
    validator = compiled;
  }
  return validator;
}

/** @param {string} definition @param {unknown} value */
export function assertWireValue(definition, value) {
  const validate = validatorFor(definition);
  if (!validate(value)) {
    throw new ProtocolError('invalid-wire-value', `${definition} failed schema validation`, validate.errors ?? []);
  }
  return value;
}

/** @param {unknown} value */
export function validateManifest(value) {
  assertWireValue('PluginManifest', value);
  const manifest = /** @type {Record<string, unknown>} */ (value);
  if (!semver.valid(/** @type {string} */ (manifest.packageVersion), { loose: false })) {
    throw new ProtocolError('invalid-package-version', 'packageVersion must be canonical SemVer');
  }
  for (const advertisement of /** @type {Array<Record<string, unknown>>} */ (manifest.protocol)) {
    assertAdvertisementSemantics(advertisement);
  }
  return value;
}

/** @param {Record<string, unknown>} advertisement */
function assertAdvertisementSemantics(advertisement) {
  if (/** @type {number} */ (advertisement.maxMinor) < /** @type {number} */ (advertisement.minMinor)) {
    throw new ProtocolError('malformed-advertisement', 'maxMinor must be greater than or equal to minMinor');
  }
  const features = new Set(/** @type {string[]} */ (advertisement.features));
  for (const required of /** @type {string[]} */ (advertisement.requiredFeatures)) {
    if (!features.has(required)) {
      throw new ProtocolError('malformed-advertisement', `required feature ${required} is not advertised`);
    }
  }
}

/** @param {unknown} advertisements @param {string} side */
function normalizeSupport(advertisements, side) {
  assertWireValue('ProtocolSupport', advertisements);
  const seen = new Set();
  return /** @type {Array<Record<string, unknown>>} */ (advertisements).map(advertisement => {
    assertAdvertisementSemantics(advertisement);
    const major = /** @type {number} */ (advertisement.major);
    if (seen.has(major)) throw new ProtocolError('duplicate-advertisement', `${side} advertises major ${major} more than once`);
    seen.add(major);
    return advertisement;
  });
}

/**
 * Selects the highest compatible major, then highest overlapping minor.
 * Input order never affects the result.
 * @param {unknown} hostSupport
 * @param {unknown} pluginSupport
 */
export function negotiateProtocol(hostSupport, pluginSupport) {
  const host = normalizeSupport(hostSupport, 'host');
  const plugin = normalizeSupport(pluginSupport, 'plugin');
  const candidates = [];
  for (const hostAdvertisement of host) {
    for (const pluginAdvertisement of plugin) {
      if (hostAdvertisement.major !== pluginAdvertisement.major) continue;
      const min = Math.max(/** @type {number} */ (hostAdvertisement.minMinor), /** @type {number} */ (pluginAdvertisement.minMinor));
      const max = Math.min(/** @type {number} */ (hostAdvertisement.maxMinor), /** @type {number} */ (pluginAdvertisement.maxMinor));
      if (max < min) continue;
      const hostFeatures = new Set(/** @type {string[]} */ (hostAdvertisement.features));
      const pluginFeatures = new Set(/** @type {string[]} */ (pluginAdvertisement.features));
      const features = [...hostFeatures].filter(feature => pluginFeatures.has(feature)).sort();
      const required = [
        .../** @type {string[]} */ (hostAdvertisement.requiredFeatures),
        .../** @type {string[]} */ (pluginAdvertisement.requiredFeatures)
      ];
      if (!required.every(feature => features.includes(feature))) continue;
      candidates.push({ major: /** @type {number} */ (hostAdvertisement.major), minor: max, features });
    }
  }
  candidates.sort((a, b) => b.major - a.major || b.minor - a.minor || a.features.join(',').localeCompare(b.features.join(',')));
  if (candidates.length === 0) throw new ProtocolError('incompatible-protocol', 'no compatible protocol range and required-feature intersection');
  return candidates[0];
}

/** @type {Readonly<Record<string, (value: unknown) => unknown>>} */
export const validatorsByExport = Object.freeze({
  manifest: value => validateManifest(value),
  installEnvelope: value => assertWireValue('InstallEnvelope', value),
  installReceipt: value => assertWireValue('InstallReceipt', value),
  bootstrapEnvelope: value => assertWireValue('BootstrapEnvelope', value),
  bootstrapExchangeResult: value => assertWireValue('BootstrapExchangeResult', value),
  sessionDescriptor: value => assertWireValue('SessionDescriptor', value),
  browserMessage: value => assertWireValue('BrowserMessage', value),
  proxyRequest: value => assertWireValue('ProxyRequest', value),
  proxyResult: value => assertWireValue('ProxyResult', value)
});

export { runConformance } from './conformance.js';
