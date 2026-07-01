// @ts-check
const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

function copyXtermCss() {
  const src = path.join(__dirname, "node_modules", "@xterm", "xterm", "css", "xterm.css");
  const destDir = path.join(__dirname, "media", "vendor");
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, path.join(destDir, "xterm.css"));
}

/** @type {import('esbuild').Plugin} */
const problemMatcherPlugin = {
  name: "problem-matcher",
  setup(build) {
    build.onStart(() => {
      console.log(`[${build.initialOptions.outfile}] build started`);
    });
    build.onEnd((result) => {
      for (const error of result.errors) {
        console.error(error);
      }
      console.log(`[${build.initialOptions.outfile}] build finished`);
    });
  },
};

async function main() {
  copyXtermCss();

  const extensionCtx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "out/extension.js",
    external: ["vscode", "@homebridge/node-pty-prebuilt-multiarch"],
    logLevel: "silent",
    plugins: [problemMatcherPlugin],
  });

  const webviewCtx = await esbuild.context({
    entryPoints: ["src/webview/main.ts"],
    bundle: true,
    format: "iife",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "browser",
    outfile: "media/terminal/main.js",
    logLevel: "silent",
    plugins: [problemMatcherPlugin],
  });

  if (watch) {
    await Promise.all([extensionCtx.watch(), webviewCtx.watch()]);
  } else {
    await Promise.all([extensionCtx.rebuild(), webviewCtx.rebuild()]);
    await Promise.all([extensionCtx.dispose(), webviewCtx.dispose()]);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
