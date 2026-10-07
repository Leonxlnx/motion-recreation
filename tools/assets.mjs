#!/usr/bin/env node
// Install the exact texture files listed in assets-release.json, one archive at a time.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {x as extract} from 'tar';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(root, '.asset-cache');
const gib = bytes => `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
const shaPattern = /^[a-f0-9]{64}$/;

function options(args) {
  const result = {verify: false, baseURL: null};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--verify') result.verify = true;
    else if (args[i] === '--base-url') {
      if (!args[i + 1]) throw Error('--base-url requires an HTTP(S) URL.');
      result.baseURL = args[++i];
    } else if (args[i].startsWith('--base-url=')) result.baseURL = args[i].slice(11);
    else throw Error(`Unknown argument: ${args[i]}. Usage: node tools/assets.mjs [--verify] [--base-url URL]`);
  }
  if (result.baseURL !== null) {
    const url = new URL(result.baseURL);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw Error('--base-url must be an HTTP(S) URL without credentials, query or fragment.');
    }
    result.baseURL = url.href.replace(/\/+$/, '');
  }
  return result;
}

function validateManifest(manifest) {
  if (manifest.version !== 1 || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(manifest.repository) ||
      !/^[A-Za-z0-9_.-]+$/.test(manifest.tag) || !Array.isArray(manifest.files) || !Array.isArray(manifest.archives)) {
    throw Error('Invalid assets-release.json header.');
  }
  const files = new Map();
  for (const file of manifest.files) {
    if (typeof file.path !== 'string' || !/^assets\/grain\/(?:[A-Za-z0-9][A-Za-z0-9_.-]*\/)*[A-Za-z0-9][A-Za-z0-9_.-]*\.png$/.test(file.path) ||
        !Number.isSafeInteger(file.bytes) || file.bytes < 1 || !shaPattern.test(file.sha256) || files.has(file.path)) {
      throw Error(`Invalid or duplicate texture entry: ${file.path}`);
    }
    files.set(file.path, file);
  }
  const assigned = new Set(), names = new Set();
  for (const archive of manifest.archives) {
    if (!/^grain-[0-9]+\.tar(?:\.gz)?$/.test(archive.name) || names.has(archive.name) ||
        !Number.isSafeInteger(archive.bytes) || archive.bytes < 1 || !shaPattern.test(archive.sha256) ||
        !Array.isArray(archive.files) || !archive.files.length) {
      throw Error(`Invalid or duplicate archive: ${archive.name}`);
    }
    names.add(archive.name);
    for (const name of archive.files) {
      if (!files.has(name) || assigned.has(name)) throw Error(`Invalid or multiply assigned archive path: ${name}`);
      assigned.add(name);
    }
  }
  const total = [...files.values()].reduce((sum, file) => sum + file.bytes, 0);
  if (!files.size || assigned.size !== files.size || !Number.isSafeInteger(total) || manifest.totalBytes !== total) {
    throw Error('Texture count, archive coverage or totalBytes is inconsistent.');
  }
  return files;
}

// Reject existing links/junctions and non-directory ancestors before reading or writing.
async function safePath(relative, finalType = 'file') {
  const segments = relative.split('/');
  if (!segments.length || segments.some(s => !s || s === '.' || s === '..' || s.includes('\\') || s.includes(':'))) {
    throw Error(`Unsafe destination path: ${relative}`);
  }
  let current = root;
  for (let i = 0; i < segments.length; i++) {
    current = path.join(current, segments[i]);
    let stat;
    try { stat = await fsp.lstat(current); }
    catch (error) { if (error.code === 'ENOENT') return path.join(root, ...segments); throw error; }
    const isDirectory = i < segments.length - 1 || finalType === 'directory';
    if (stat.isSymbolicLink() || (isDirectory ? !stat.isDirectory() : !stat.isFile())) {
      throw Error(`Refusing link or unexpected file type: ${relative}`);
    }
  }
  return current;
}

async function matches(filename, expected) {
  let stat;
  try { stat = await fsp.lstat(filename); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  if (stat.isSymbolicLink() || !stat.isFile()) throw Error(`Refusing non-regular file: ${filename}`);
  if (stat.size !== expected.bytes) return false;
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex') === expected.sha256;
}

async function verifyFiles(names, files) {
  const failed = [];
  for (const name of names) {
    if (!await matches(await safePath(name), files.get(name))) failed.push(name);
  }
  return failed;
}

async function acquireLock() {
  await safePath('.asset-cache', 'directory');
  await fsp.mkdir(cache, {recursive: true});
  const filename = await safePath('.asset-cache/install.lock');
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    let handle;
    try { handle = await fsp.open(filename, 'wx'); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let previous;
      try { previous = JSON.parse(await fsp.readFile(filename, 'utf8')); } catch {}
      if (attempt === 0 && Number.isSafeInteger(previous?.pid) && previous.pid > 0) {
        try { process.kill(previous.pid, 0); }
        catch (probe) {
          if (probe.code === 'ESRCH') { await fsp.unlink(filename); continue; }
        }
      }
      throw Error('Another asset install may be running. If none is running, remove .asset-cache/install.lock and retry.');
    }
    try { await handle.writeFile(JSON.stringify({pid: process.pid, token})); }
    finally { await handle.close(); }
    return async () => {
      try {
        const current = JSON.parse(await fsp.readFile(filename, 'utf8'));
        if (current.token === token) await fsp.unlink(filename);
      } catch (error) { if (error.code !== 'ENOENT') console.error(`Could not release asset lock: ${error.message}`); }
    };
  }
}

async function download(archive, baseURL) {
  const filename = await safePath(`.asset-cache/${archive.name}`);
  const partial = await safePath(`.asset-cache/${archive.name}.download`);
  if (await matches(filename, archive)) return filename;
  await fsp.rm(filename, {force: true});
  for (let attempt = 1; attempt <= 3; attempt++) {
    await fsp.rm(partial, {force: true});
    try {
      console.log(`Downloading ${archive.name} (${gib(archive.bytes)}), attempt ${attempt}/3…`);
      const response = await fetch(`${baseURL}/${encodeURIComponent(archive.name)}`, {
        signal: AbortSignal.timeout(30 * 60 * 1000),
      });
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw Error(`HTTP ${response.status} for ${archive.name}`);
      }
      let bytes = 0, lastProgress = Date.now();
      const hash = createHash('sha256');
      const meter = new Transform({
        transform(chunk, encoding, callback) {
          bytes += chunk.length;
          if (bytes > archive.bytes) return callback(Error(`${archive.name} exceeds its declared size.`));
          hash.update(chunk);
          if (Date.now() - lastProgress >= 10000) {
            console.log(`  ${archive.name}: ${(100 * bytes / archive.bytes).toFixed(0)}%`);
            lastProgress = Date.now();
          }
          callback(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(partial, {flags: 'wx'}));
      if (bytes !== archive.bytes || hash.digest('hex') !== archive.sha256) throw Error(`${archive.name} failed its size/SHA-256 check.`);
      await fsp.rename(partial, filename);
      return filename;
    } catch (error) {
      await fsp.rm(partial, {force: true});
      if (attempt === 3) throw error;
      console.error(`  ${error.message}; retrying…`);
      await delay(attempt * 1000);
    }
  }
}

async function installArchive(filename, archive, files) {
  const allowed = new Set(archive.files), directories = new Set(), seen = new Set(), rejected = [];
  for (const name of allowed) {
    await safePath(name);
    const segments = name.split('/');
    for (let i = 1; i < segments.length; i++) directories.add(segments.slice(0, i).join('/'));
  }
  await extract({
    file: filename, cwd: root, strict: true, preservePaths: false,
    preserveOwner: false, chmod: false, noMtime: true, unlink: false,
    filter(name, entry) {
      // Directory headers are unnecessary: tar creates parents for allowed files.
      if (entry.type === 'Directory' && directories.has(name.replace(/\/$/, ''))) return false;
      if (!allowed.has(name) || !['File', 'OldFile'].includes(entry.type) || entry.linkpath ||
          seen.has(name) || entry.size !== files.get(name)?.bytes) {
        rejected.push(`${entry.type}: ${name}`);
        return false;
      }
      seen.add(name);
      return true;
    },
  });
  if (rejected.length || seen.size !== allowed.size) {
    throw Error(`${archive.name} has unexpected or missing entries${rejected.length ? `: ${rejected.slice(0, 5).join(', ')}` : '.'}`);
  }
  const failed = await verifyFiles(archive.files, files);
  if (failed.length) throw Error(`Installed file verification failed: ${failed.slice(0, 5).join(', ')}`);
  await fsp.unlink(filename);
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 22) throw Error('Node.js 22 or newer is required.');
  const config = options(process.argv.slice(2));
  const manifest = JSON.parse(await fsp.readFile(await safePath('assets-release.json'), 'utf8'));
  const files = validateManifest(manifest);
  if (config.verify) {
    const failed = await verifyFiles(files.keys(), files);
    if (failed.length) throw Error(`${failed.length}/${files.size} textures are missing or changed:\n${failed.slice(0, 12).join('\n')}\nRun npm run assets to install or repair them.`);
    console.log(`Verified ${files.size} texture files (${gib(manifest.totalBytes)}): every size and SHA-256 matches.`);
    return;
  }
  const downloadBytes = manifest.archives.reduce((sum, archive) => sum + archive.bytes, 0);
  console.log(`Texture assets: ${gib(manifest.totalBytes)} installed; up to ${gib(downloadBytes)} to download.`);
  console.log('Verified archives are skipped. Installation also temporarily needs space for one downloaded archive.');
  const baseURL = config.baseURL || `https://github.com/${manifest.repository}/releases/download/${encodeURIComponent(manifest.tag)}`;
  const releaseLock = await acquireLock();
  try {
    for (let i = 0; i < manifest.archives.length; i++) {
      const archive = manifest.archives[i];
      const failed = await verifyFiles(archive.files, files);
      if (!failed.length) {
        console.log(`[${i + 1}/${manifest.archives.length}] ${archive.name}: installed files verified; skipping download.`);
        await fsp.rm(await safePath(`.asset-cache/${archive.name}`), {force: true});
        await fsp.rm(await safePath(`.asset-cache/${archive.name}.download`), {force: true});
        continue;
      }
      const filename = await download(archive, baseURL);
      console.log(`[${i + 1}/${manifest.archives.length}] Extracting and verifying ${archive.name}…`);
      await installArchive(filename, archive, files);
    }
    console.log(`Ready: all ${files.size} texture files verified. Downloaded archives have been removed.`);
  } finally { await releaseLock(); }
}

main().catch(error => { console.error(`Asset setup failed: ${error.message}`); process.exitCode = 1; });
