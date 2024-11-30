const preloadScaffold = `
const fs = require("original-fs"); // using electron's fs causes app.asar to be locked during host updates

const VENCORD_DIR = path.join(electron.app.getPath("userData"), "..", "Vencord");
const vencord_settings_file = fs.readFileSync(path.join(VENCORD_DIR, "settings", "settings.json"), "utf8");
const vencord_settings = JSON.parse(vencord_settings_file);

electron.ipcMain.on("SHELTUPDATE_FRAMEWORK_ORIGINAL_PRELOAD", (event) => {
	event.returnValue = event.sender.originalPreload;
});

const ProxiedBrowserWindow = new Proxy(electron.BrowserWindow, {
  construct(target, args) {
    const options = args[0];
    let originalPreload;

    if (options.webPreferences?.preload && options.title) {
      originalPreload = options.webPreferences.preload;
      // We replace the preload instead of using setPreloads because of some
      // differences in internal behaviour.
      options.webPreferences.preload = path.join(__dirname, "preload.js");

      // vencord stuff
      if (vencord_settings.frameless) {
        options.frame = false;
      } else if (process.platform === "win32" && vencord_settings.winNativeTitleBar) {
        delete options.frame;
      }

      if (vencord_settings.transparent) {
        options.transparent = true;
        options.backgroundColor = "#00000000";
      }

      const needsVibrancy = process.platform === "darwin" && vencord_settings.macosVibrancyStyle;

      if (needsVibrancy) {
        options.backgroundColor = "#00000000";
        if (vencord_settings.macosVibrancyStyle) {
          options.vibrancy = vencord_settings.macosVibrancyStyle;
        }
      }
    }
    const window = new target(options);
    window.webContents.originalPreload = originalPreload;
    window.webContents.on("devtools-opened", () => {
      if (!electron.nativeTheme.shouldUseDarkColors) return;
      electron.nativeTheme.themeSource = "light";
      setTimeout(() => {
        electron.nativeTheme.themeSource = "dark";
      }, 100);
    });
    return window;
  },
});

const electronPath = require.resolve("electron");
delete require.cache[electronPath].exports;
require.cache[electronPath].exports = {
  ...electron,
  BrowserWindow: ProxiedBrowserWindow,
};
`;

export const finalizeDesktopCoreIndex = (patches, hasPreload) =>
  `// SHELTUPDATE PATCH FRAMEWORK INDEX HEADER:
{
const electron = require("electron");
const path = require("path");
${hasPreload ? preloadScaffold : ""}
}

// END HEADER, BRANCH PATCHES:
${patches}

// END PATCHES, CHAINLOAD:
module.exports = require('./core.asar');`;

export const finalizeDesktopCorePreload = (preloads) =>
  `// SHELTUPDATE PATCH FRAMEWORK PRELOAD HEADER:
{
const { ipcRenderer } = require("electron");

const originalPreload = ipcRenderer.sendSync("SHELTUPDATE_FRAMEWORK_ORIGINAL_PRELOAD");
if (originalPreload) require(originalPreload);
}

// END HEADER, BRANCH PRELOADS:
${preloads}`;
