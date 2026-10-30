import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const entry = new URL('../../../packages/plugins/prompts/', import.meta.url);
const result = await build({
  entryPoints: [fileURLToPath(new URL('src/client.tsx', entry))],
  bundle: true, write: false, format: 'cjs', platform: 'browser', target: 'es2022',
  external: ['@deepseek-ai/dsh-client-ui-primitives', 'react', 'react/jsx-runtime'],
});
await writeFile(new URL('dist/client.browser.js', entry), `window.__ModuleLoader__.load({id: "workdsh-plugin-prompts", factory: function(require) {
const module = { exports: {} };
${result.outputFiles[0].text}
return module.exports;
}});
`);
