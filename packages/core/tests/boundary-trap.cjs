// SPEC-136 design.md, "Invariants": the `--require` trap. Loaded with `node --require` before the
// bundle. Every forbidden call is RECORDED to the original stderr fd and then thrown, so a library
// `catch` that swallows the throw cannot hide it from the test. User-land `require` only is
// intercepted (Module._load); Node's own internals keep the real modules, so stdout still works.
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');

const writeSync = fs.writeSync.bind(fs);
const realpathSync = fs.realpathSync.bind(fs);
const PREFIX = 'MINSPEC-TRAP';
const allow = JSON.parse(process.env.MINSPEC_TRAP_ALLOW || '[]');

function record(kind, detail) {
  const line = `${PREFIX} ${kind} ${detail}\n`;
  writeSync(2, line);
  throw new Error(line.trim());
}

const NETWORK = new Set(['net', 'tls', 'http', 'https', 'http2', 'dgram', 'dns', 'dns/promises']);

function forbidden(modName, real) {
  return new Proxy(real, {
    get(target, prop) {
      const v = Reflect.get(target, prop);
      if (typeof v !== 'function') return v;
      return new Proxy(v, {
        apply: () => record('network', `${modName}.${String(prop)}`),
        construct: () => record('network', `${modName}.${String(prop)} (constructor)`),
      });
    },
  });
}

const PROGRAM_CALLS = new Set(['spawn', 'spawnSync', 'execFile', 'execFileSync']);
const SHELL_CALLS = new Set(['exec', 'execSync']);
const isGit = (p) => ['git', 'git.exe'].includes(path.basename(String(p)));

function guardedChildProcess(real) {
  return new Proxy(real, {
    get(target, prop) {
      const v = Reflect.get(target, prop);
      if (typeof v !== 'function') return v;
      return (...args) => {
        const name = String(prop);
        if (PROGRAM_CALLS.has(name) && !isGit(args[0])) record('child_process', `${name} ${String(args[0])}`);
        if (SHELL_CALLS.has(name) && !isGit(String(args[0]).trim().split(/\s+/)[0])) record('child_process', `${name} ${String(args[0])}`);
        if (name === 'fork') record('child_process', `fork ${String(args[0])}`);
        return v.apply(target, args);
      };
    },
  });
}

function inside(p) {
  const abs = path.resolve(String(p));
  let real = abs;
  try {
    real = realpathSync(abs);
  } catch {
    /* does not exist yet: judge the lexical path */
  }
  return allow.some((a) => [abs, real].some((c) => c === a || c.startsWith(a + path.sep)));
}

const TWO_PATH = /^(copyFile|rename|link|symlink|cp)/;
function pathOf(a) {
  if (typeof a === 'string') return a;
  if (a instanceof URL) return a.protocol === 'file:' ? require('url').fileURLToPath(a) : null;
  if (Buffer.isBuffer(a)) return a.toString();
  return null;
}
function checkArgs(label, name, args) {
  const n = TWO_PATH.test(name) ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const p = pathOf(args[i]);
    if (p !== null && !inside(p)) record('fs', `${label}.${name} ${path.resolve(p)}`);
  }
}
function guardedFs(real, label) {
  return new Proxy(real, {
    get(target, prop) {
      const v = Reflect.get(target, prop);
      if (prop === 'promises' && v) return guardedFs(v, `${label}.promises`);
      if (typeof v !== 'function' || typeof prop !== 'string') return v;
      return function (...args) {
        checkArgs(label, prop, args);
        return v.apply(target, args);
      };
    },
  });
}

// listen / bind on instances created through any other route.
const net = require('net');
const dgram = require('dgram');
net.Server.prototype.listen = function () {
  return record('socket', 'net.Server.prototype.listen');
};
dgram.Socket.prototype.bind = function () {
  return record('socket', 'dgram.Socket.prototype.bind');
};

globalThis.fetch = function () {
  return record('network', 'fetch');
};

const cache = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  const name = typeof request === 'string' && request.startsWith('node:') ? request.slice(5) : request;
  if (NETWORK.has(name)) {
    if (!cache.has(name)) cache.set(name, forbidden(name, realLoad.call(this, name, parent, isMain)));
    return cache.get(name);
  }
  if (name === 'child_process') {
    if (!cache.has(name)) cache.set(name, guardedChildProcess(realLoad.call(this, name, parent, isMain)));
    return cache.get(name);
  }
  if (name === 'fs' || name === 'fs/promises') {
    if (!cache.has(name)) cache.set(name, guardedFs(realLoad.call(this, name, parent, isMain), name));
    return cache.get(name);
  }
  return realLoad.apply(this, arguments);
};
