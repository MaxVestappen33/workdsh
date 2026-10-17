import { build } from 'esbuild'; import { writeFile } from 'node:fs/promises'; import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const entry=new URL('../../../packages/plugins/projects/',import.meta.url);const result=await build({entryPoints:[fileURLToPath(new URL('src/client.tsx',entry))],bundle:true,write:false,format:'cjs',platform:'browser',target:'es2022',external:['@deepseek-ai/dsh-client-ui-primitives','react','react-dom','react/jsx-runtime']});await writeFile(new URL('dist/client.browser.js',entry),`window.__ModuleLoader__.load({id: "workdsh-plugin-projects", factory: function(require) { const module = {exports:{}};\n${result.outputFiles[0].text}\nreturn module.exports; }});\n`);

// Public governance validation is shared source, not an unpublished runtime
// dependency of the independently installed Projects package.
const requireProjects = createRequire(new URL('package.json', entry));
await build({
  entryPoints: [fileURLToPath(new URL('src/index.ts', entry))],
  bundle: true, format: 'esm', platform: 'node', target: 'node22', packages: 'external',
  plugins: [{ name: 'owned-contracts', setup(builder) {
    builder.onResolve({ filter: /^workdsh-contracts(?:\/.*)?$/ }, args => ({ path: requireProjects.resolve(args.path) }));
  } }],
  outfile: fileURLToPath(new URL('dist/index.js', entry)),
});
