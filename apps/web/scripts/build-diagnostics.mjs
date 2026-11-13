import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = new URL('../../../packages/plugins/diagnostics/', import.meta.url);

/** 打成 Client Loader 认得的模块形态；react 与官方 primitives 由运行时提供。 */
async function bundle(root) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('src/client.tsx', root))],
    bundle: true, write: false, format: 'cjs', platform: 'browser', target: 'es2022',
    external: ['@deepseek-ai/dsh-client-ui-primitives', 'react', 'react/jsx-runtime'],
  });
  await mkdir(fileURLToPath(new URL('dist/', root)), { recursive: true });
  await writeFile(new URL('dist/client.browser.js', root), `window.__ModuleLoader__.load({id: "workdsh-plugin-diagnostics", factory: function(require) {
const module = { exports: {} };
${result.outputFiles[0].text}
return module.exports;
}});
`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await bundle(PACKAGE_ROOT);
  console.log('diagnostics: client bundle written');
}
