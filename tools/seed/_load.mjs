// Loads the app's TypeScript in plain Node (no React Native), stubbing native-only modules.
// Used by the verify-*.mjs scripts. It transpiles with the repo's own TypeScript.
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = dirname(fileURLToPath(import.meta.url));
export const root = resolve(here, '../..');
const nodeRequire = createRequire(join(root, 'package.json'));
const ts = nodeRequire('typescript');

const ALIASES = {
  '@hive/shared': join(root, 'packages/shared/src/index.ts'),
};
// modules that need React Native / native code; the pure logic under test never calls them
const STUBS = new Set(['./db', './embedder', './ingest', './shards', '@/core/db']);

const MOCKS = new Map();
/** Replaces an import (e.g. '@/core/names') with a plain object for the loaded modules. */
export function mock(spec, exports) {
  MOCKS.set(spec, exports);
}

const cache = new Map();
export function loadTs(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  if (file.endsWith('.json')) {
    module.exports = JSON.parse(readFileSync(file, 'utf8'));
    return module.exports;
  }
  const js = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const localRequire = (spec) => {
    if (MOCKS.has(spec)) return MOCKS.get(spec);
    if (STUBS.has(spec)) return {};
    if (ALIASES[spec]) return loadTs(ALIASES[spec]);
    if (spec.startsWith('.')) {
      const base = resolve(dirname(file), spec);
      const hit = [`${base}.ts`, base, join(base, 'index.ts')].find((p) => existsSync(p) && /\.(ts|json)$/.test(p));
      if (hit) return loadTs(hit);
    }
    return nodeRequire(spec);
  };
  new Function('module', 'exports', 'require', js)(module, module.exports, localRequire);
  return module.exports;
}

export const app = (p) => join(root, 'apps/mobile/src', p);
