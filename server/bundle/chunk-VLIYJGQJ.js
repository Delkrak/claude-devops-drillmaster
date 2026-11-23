import { createRequire as __drillmasterRequire } from 'node:module'; const require = __drillmasterRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/projectLocator.ts
import { readFile } from "node:fs/promises";
import os from "node:os";
import path2 from "node:path";

// src/adapters/projects.ts
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
var MAX_READABLE_NAME_LENGTH = 40;
var DRILLMASTER_FILE = ".drillmaster";
var readable = (name) => name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, MAX_READABLE_NAME_LENGTH) || "project";
var shortHash = (text) => createHash("sha256").update(text).digest("hex").slice(0, 12);
var projectKey = (place) => `${readable(place.folder)}-${shortHash(`${place.url}
${place.folder}`)}`;
var defaultFolderOf = (projectDir) => readable(path.basename(path.resolve(projectDir)));
function readPlace(file) {
  try {
    const content = JSON.parse(readFileSync(file, "utf8"));
    return typeof content.drillmaster_repository === "string" && typeof content.folder === "string" && content.folder.trim() ? { url: content.drillmaster_repository, folder: content.folder } : void 0;
  } catch {
    return void 0;
  }
}
var DotDrillmasterResolver = class {
  resolve(projectDir) {
    const file = path.join(projectDir, DRILLMASTER_FILE);
    try {
      if (statSync(file).isDirectory()) return void 0;
    } catch {
      return void 0;
    }
    const place = readPlace(file);
    return place ? { key: projectKey(place), repository: place } : void 0;
  }
  async link(projectDir, repository) {
    await writeFile(path.join(projectDir, DRILLMASTER_FILE), JSON.stringify({ drillmaster_repository: repository.url, folder: repository.folder }, null, 2) + "\n");
    return { key: projectKey(repository), repository };
  }
};

// src/client.ts
var HEALTH_TIMEOUT_MS = 1500;
async function drillmasterServerAt(url) {
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    const health = await response.json();
    return response.ok && health.name === "drillmaster" ? health : void 0;
  } catch {
    return void 0;
  }
}
async function requestJson(url, method, route, body) {
  const response = await fetch(`${url}${route}`, {
    method,
    headers: body === void 0 ? void 0 : { "content-type": "application/json" },
    body: body === void 0 ? void 0 : JSON.stringify(body)
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error ?? `${method} ${route} failed with ${response.status}`);
  return json;
}

// src/projectLocator.ts
var drillmasterHome = (env = process.env) => path2.resolve(env.DRILLMASTER_HOME ?? path2.join(os.homedir(), ".drillmaster"));
var projectServerInfoFile = (projectKeyOfServer, env = process.env) => path2.join(drillmasterHome(env), "projects", projectKeyOfServer, "daemon.json");
async function readProjectServerInfo(projectKeyOfServer, env = process.env) {
  try {
    return JSON.parse(await readFile(projectServerInfoFile(projectKeyOfServer, env), "utf8"));
  } catch {
    return void 0;
  }
}
async function runningProjectServer(projectKeyOfServer, env = process.env) {
  const info = await readProjectServerInfo(projectKeyOfServer, env);
  const health = info && await drillmasterServerAt(info.url);
  return health?.project === projectKeyOfServer && health.pid === info.pid ? info.url : void 0;
}
function projectToServe(projectDir, setupPlace) {
  const linked = new DotDrillmasterResolver().resolve(projectDir);
  if (linked?.repository) return { key: linked.key, place: linked.repository };
  if (setupPlace) return { key: projectKey(setupPlace), place: setupPlace };
  return void 0;
}

export {
  __commonJS,
  __export,
  __toESM,
  projectKey,
  defaultFolderOf,
  DotDrillmasterResolver,
  requestJson,
  drillmasterHome,
  projectServerInfoFile,
  readProjectServerInfo,
  runningProjectServer,
  projectToServe
};
