{
const electron = require("electron");
const path = require("path");
const Module = require("module");
const fs = require("original-fs"); // using electron's fs causes app.asar to be locked during host updates
const https = require("https");
const { EOL } = require("os");

const logger = new Proxy(console, {
  get: (target, key) =>
    function (...args) {
      //logFile?.write(`[${new Date().toISOString()}] [${key}] ${args.join(" ")}${EOL}`);
      return target[key].apply(console, ["[shelter]", ...args]);
    },
});

logger.log("Loading...");

// #region Bundle
const remoteUrl =
  process.env.SHELTER_BUNDLE_URL ||
  "https://raw.githubusercontent.com/uwu/shelter-builds/main/shelter.js";
const localBundle = process.env.SHELTER_DIST_PATH;

let fetchPromise; // only fetch once

if (!localBundle)
  fetchPromise = new Promise((resolve, reject) => {
    const req = https.get(remoteUrl);

    req.on("response", (res) => {
      const chunks = [];

      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        let data = Buffer.concat(chunks).toString("utf-8");

        if (!data.includes("//# sourceMappingURL="))
          data += `\n//# sourceMappingURL=${remoteUrl + ".map"}`;

        resolve(data);
      });
    });

    req.on("error", reject);

    req.end();
  });

const getShelterBundle = () =>
  !localBundle
    ? fetchPromise
    : Promise.resolve(
        fs.readFileSync(path.join(localBundle, "shelter.js"), "utf8") +
          `\n//# sourceMappingURL=file://${process.platform === "win32" ? "/" : ""}${path.join(
            localBundle,
            "shelter.js.map"
          )}`
      );
// #endregion

// #region IPC
electron.ipcMain.on("SHELTER_ORIGINAL_PRELOAD", (event) => {
  event.returnValue = event.sender.originalPreload;
});

electron.ipcMain.handle("SHELTER_BUNDLE_FETCH", getShelterBundle);
// #endregion

// #region CSP
electron.app.on("ready", () => {
  electron.session.defaultSession.webRequest.onHeadersReceived(({ responseHeaders }, done) => {
    const cspHeaders = Object.keys(responseHeaders).filter((name) =>
      name.toLowerCase().startsWith("content-security-policy")
    );

    for (const header of cspHeaders) {
      delete responseHeaders[header];
    }

    done({ responseHeaders });
  });

  electron.session.defaultSession.webRequest.onHeadersReceived = () => {};
});
// #endregion

// #region DevTools
// Patch DevTools setting, enabled by default
const enableDevTools = process.env.SHELTER_FORCE_DEVTOOLS?.toLowerCase() !== "false";

if (enableDevTools) {
  const originalRequire = Module.prototype.require;

  Module.prototype.require = function (path) {
    const loadedModule = originalRequire.call(this, path);
    if (!path.endsWith("appSettings")) return loadedModule;

    const settings =
      loadedModule?.appSettings?.getSettings?.()?.settings ?? // Original
      loadedModule?.getSettings?.()?.store; // OpenAsar

    if (settings) {
      try {
        Object.defineProperty(
          settings,
          "DANGEROUS_ENABLE_DEVTOOLS_ONLY_ENABLE_IF_YOU_KNOW_WHAT_YOURE_DOING",
          {
            value: true,
            configurable: false,
            enumerable: false, // prevents our patched value from getting saved to settings.json
          }
        );
        Module.prototype.require = originalRequire;
      } catch (e) {
        logger.error(`Error patching DevTools setting: ${e}${EOL}${e.stack}`);
      }
    }
    return loadedModule;
  };
}

// #endregion

// #region BrowserWindow
const ProxiedBrowserWindow = new Proxy(electron.BrowserWindow, {
  construct(target, args) {
    const options = args[0];
    let originalPreload;

    if (options.webPreferences?.preload && options.title) {
      originalPreload = options.webPreferences.preload;
      // We replace the preload instead of using setPreloads because of some
      // differences in internal behaviour.
      options.webPreferences.preload = path.join(__dirname, "preload.js");
    }

    const window = new target(options);
    window.webContents.originalPreload = originalPreload;
    return window;
  },
});

const electronPath = require.resolve("electron");
delete require.cache[electronPath].exports;
require.cache[electronPath].exports = {
  ...electron,
  BrowserWindow: ProxiedBrowserWindow,
};

// #endregion
/*
logger.log("Starting original...");
// #region Start original
let originalPath = path.join(process.resourcesPath, "app.asar");
if (!fs.existsSync(originalPath)) originalPath = path.join(process.resourcesPath, "original.asar");

const originalPackage = require(path.resolve(path.join(originalPath, "package.json")));
const startPath = path.join(originalPath, originalPackage.main);

require.main.filename = startPath;
electron.app.setAppPath?.(originalPath);
electron.app.name = originalPackage.name;

Module._load(startPath, null, true);
// #endregion
 */
}