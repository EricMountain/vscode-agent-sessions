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

function copyCodicons() {
  const srcDir = path.join(__dirname, "node_modules", "@vscode", "codicons", "dist");
  const destDir = path.join(__dirname, "media", "vendor");
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(path.join(srcDir, "codicon.css"), path.join(destDir, "codicon.css"));
  fs.copyFileSync(path.join(srcDir, "codicon.ttf"), path.join(destDir, "codicon.ttf"));
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
  copyCodicons();

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

  const buttonsCtx = await esbuild.context({
    entryPoints: ["src/webview/buttonsMain.ts"],
    bundle: true,
    format: "iife",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "browser",
    outfile: "media/buttons/main.js",
    logLevel: "silent",
    plugins: [problemMatcherPlugin],
  });

  const configCtx = await esbuild.context({
    entryPoints: ["src/webview/configMain.ts"],
    bundle: true,
    format: "iife",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "browser",
    outfile: "media/config/main.js",
    logLevel: "silent",
    plugins: [problemMatcherPlugin],
  });

  const contexts = [extensionCtx, webviewCtx, buttonsCtx, configCtx];

  if (watch) {
    await Promise.all(contexts.map((ctx) => ctx.watch()));
  } else {
    await Promise.all(contexts.map((ctx) => ctx.rebuild()));
    await Promise.all(contexts.map((ctx) => ctx.dispose()));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
