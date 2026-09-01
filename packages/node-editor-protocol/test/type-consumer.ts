import type { PluginManifest, ProxyRequest, ProxyResult } from '../generated/protocol.js';

declare const manifest: PluginManifest;
declare const request: ProxyRequest;
declare const result: ProxyResult;

void [manifest, request, result];
