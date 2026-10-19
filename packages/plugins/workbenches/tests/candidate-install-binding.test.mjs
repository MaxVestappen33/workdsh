import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Exercise real component handlers and HTTP clients with deferred transport.
// This does not launch a browser or claim a rendered UI/installed runtime check.
const web = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const built = await web('esbuild').build({
  entryPoints: [fileURLToPath(new URL('../src/client/WorkbenchPackagePreview.tsx', import.meta.url)), fileURLToPath(new URL('../src/client/WorkbenchSourceCandidates.tsx', import.meta.url)), fileURLToPath(new URL('../src/client/WorkbenchPackageUpload.tsx', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false, outdir: '/unused', jsx: 'transform',
  alias: { 'workdsh-contracts': fileURLToPath(new URL('../../../contracts/src/index.ts', import.meta.url)) },
  tsconfigRaw: { compilerOptions: { jsx: 'react', jsxFactory: 'React.createElement', jsxFragmentFactory: 'React.Fragment' } },
  plugins: [{ name: 'candidate-hooks', setup(builder) {
    builder.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'candidate-hooks' }));
    builder.onLoad({ filter: /.*/, namespace: 'candidate-hooks' }, () => ({ contents: `
      const React={createElement:(type,props,...children)=>({type,props:{...props,children}}),Fragment:Symbol.for('test.fragment')};
      export default React;
      export const useState=(...args)=>globalThis.__candidateHooks.useState(...args);
      export const useRef=(...args)=>globalThis.__candidateHooks.useRef(...args);
      export const useEffect=(...args)=>globalThis.__candidateHooks.useEffect(...args);
      export const useMemo=(...args)=>globalThis.__candidateHooks.useMemo(...args);
    `, loader: 'js' }));
  } }],
});
const modules = await Promise.all(built.outputFiles.map(file => import(`data:text/javascript;base64,${Buffer.from(file.text).toString('base64')}`)));
const WorkbenchPackagePreview = modules.find(module => module.WorkbenchPackagePreview).WorkbenchPackagePreview;
const WorkbenchSourceCandidates = modules.find(module => module.WorkbenchSourceCandidates).WorkbenchSourceCandidates;
const WorkbenchPackageUpload = modules.find(module => module.WorkbenchPackageUpload).WorkbenchPackageUpload;
const development = {
  id: 'dev-quality', revision: 'dev-rev-2', requirementsRevision: 'req-2', iterationId: 'iteration-2',
  workbenchId: 'company.quality', packageName: 'quality-plugin', state: 'ready',
  target: { hostId: 'host', installationId: 'web', profileId: 'preview', harnessVersion: '0.2.1-rc.1' },
  source: { hostId: 'host', directory: '/owned/quality', revision: 'source-sha256:' + 'b'.repeat(64) },
  owner: { organizationId: 'personal', ownerPrincipalId: 'user', scope: 'personal' },
  createdAt: '2026-10-11T00:00:00.000Z', updatedAt: '2026-10-11T00:00:00.000Z',
};
const binding = ({ id, revision, requirementsRevision, iterationId, workbenchId, packageName, target }) => ({ id, revision, requirementsRevision, iterationId, workbenchId, packageName, target });
const candidate = {
  package: { packageName: 'quality-plugin', version: '0.2.0', sha256: 'a'.repeat(64) }, compatible: true,
  descriptor: { id: 'company.quality', title: '质量分析', description: '', protocolVersion: '1.0', layout: 'full-page', capabilities: [], hostCompatibility: { sdk: '^1.0.0', harness: '0.2.1-rc.1' } },
};
const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node == null || typeof node === 'boolean' ? '' : String(node);
function nodes(node, result = []) { if (Array.isArray(node)) node.forEach(child => nodes(child, result)); else if (node && typeof node === 'object') { result.push(node); nodes(node.props?.children, result); } return result; }
function harness(Component, props, { loseInstallReply = false, pendingPrepare, scanMutation, scanRows, scanFailed, recoveryCode = 'workbench/native-installation-not-present' } = {}) {
  const slots = [], effects = [], requests = []; let cursor = 0, dirty = true, tree, inventory = structuredClone(development), installs = 0;
  const previousFetch = globalThis.fetch;
  const hooks = {
    useState(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[index].value, next => { const value = typeof next === 'function' ? next(slots[index].value) : next; if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; } }]; },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useMemo(run, deps) { const index = cursor++, old = slots[index]; if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) slots[index] = { value: run(), deps }; return slots[index].value; },
    useEffect(run, deps) { const index = cursor++, old = slots[index]; if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) effects.push(() => { old?.cleanup?.(); slots[index] = { deps, cleanup: run() }; }); },
  };
  globalThis.fetch = async (path, options) => {
    const input = typeof options.body === 'string' ? JSON.parse(options.body) : options.body; requests.push({ path, input });
    if (path === '/api/workdsh-workbench-development') { assert.equal(input.endpoint, 'list'); return Response.json({ ok: true, value: [{ title: '质量分析', development: inventory }] }); }
    if (path === '/api/workdsh-workbench-source-candidates') {
      if (scanFailed) throw Error('scan unavailable');
      if (scanMutation) inventory = { ...inventory, ...scanMutation };
      return Response.json({ ok: true, value: scanRows ?? [{ fileName: 'quality-plugin-0.2.0.tgz', candidate }] });
    }
    if (path === '/api/workdsh-workbench-native-installation') return recoveryCode?Response.json({ok:false,error:{code:recoveryCode}},{status:409}):Response.json({ok:true,value:{developmentId:development.id,package:candidate.package,descriptor:candidate.descriptor,installedVerified:true,activationVerified:false}});
    if (path === '/api/workdsh-workbench-import-prepare') {
      if (pendingPrepare) await pendingPrepare;
      return Response.json({ ok: true, value: { kind: 'update', package: candidate.package, installedVersion: '0.1.0', expectedInstalledHash: 'c'.repeat(64) } });
    }
    if (path === '/api/workdsh-workbench-package-preview') return Response.json({ ok: true, value: candidate });
    if (path === '/api/workdsh-workbench-upload') return Response.json({ ok: true, value: { ...JSON.parse(options.headers['x-workdsh-upload']), sha256: candidate.package.sha256 } });
    if (path === '/api/workdsh-workbench-offline-prepare') return Response.json({ ok: true, value: { kind: 'install', package: candidate.package, importId: 'import:offline-owned' } });
    if (path === '/api/workdsh-workbench-import') {
      installs++;
      if (loseInstallReply && installs === 1) throw Error('lost-install-response');
      return Response.json({ ok: true, value: { id: input.operationId, developmentId: input.developmentId, iterationId: input.iterationId,
        kind: input.kind, inputHash: input.sha256, revision: 'operation-receipt', state: 'succeeded',
        receipt: { package: candidate.package, pendingRestart: true } } });
    }
    throw Error(`unexpected route ${path}`);
  };
  function render() { cursor = 0; dirty = false; const before = globalThis.__candidateHooks; globalThis.__candidateHooks = hooks; try { tree = Component(props); } finally { globalThis.__candidateHooks = before; } while (effects.length) effects.shift()(); }
  async function settle() { for (let i = 0; i < 35; i++) { if (dirty) render(); await new Promise(resolve => setImmediate(resolve)); if (!dirty && !effects.length) return; } throw Error('state did not settle'); }
  return { requests, settle, mutate: changes => { inventory = { ...inventory, ...changes }; }, tree: () => tree, text: () => text(tree),
    click(label) { const node = nodes(tree).find(node => node.type === 'button' && text(node) === label); assert.ok(node, `control ${label} exists`); assert.equal(!!node.props.disabled, false, `control ${label} enabled`); return node.props.onClick(); },
    selectFile() { nodes(tree).find(node => node.type === 'input').props.onChange({ currentTarget: { files: [new Blob(['archive'])] } }); },
    version(value) { nodes(tree).find(node => node.type === 'input' && node.props.placeholder === '例如 0.1.0').props.onChange({ currentTarget: { value } }); },
    cleanup() { for (const slot of slots) slot?.cleanup?.(); globalThis.fetch = previousFetch; },
  };
}
const base = { onClose() {}, async onRefresh() {} };

test('AI candidate prepares and installs under its actual development and current iteration, retaining the same operation for recovery', async () => {
  const h = harness(WorkbenchPackagePreview, { ...base, candidate, development: binding(development) }, { loseInstallReply: true });
  try {
    await h.settle(); const prepared = h.requests.find(row => row.path === '/api/workdsh-workbench-import-prepare');
    assert.deepEqual(prepared.input, { developmentId: development.id, ...candidate.package, workbenchId: development.workbenchId });
    assert.equal(h.requests.some(row => row.path.includes('offline')), false);
    h.click('更新并试用'); await h.settle(); assert.match(h.text(), /结果未确认/);
    h.click('核对安装状态'); await h.settle();
    const installs = h.requests.filter(row => row.path === '/api/workdsh-workbench-import').map(row => row.input);
    assert.equal(installs.length, 2); assert.equal(installs[0].developmentId, development.id); assert.equal(installs[0].iterationId, development.iterationId);
    assert.deepEqual({ ...installs[0], recover: true }, installs[1]); assert.match(h.text(), /安装文件已核验/);
  } finally { h.cleanup(); }
});

test('changed requirements, iteration or plugin identity reject a prepared AI candidate before install', async () => {
  for (const changes of [{ revision: 'dev-rev-3', requirementsRevision: 'req-3', iterationId: 'iteration-3' }, { packageName: 'other-plugin' }, { iterationId: 'other-iteration' }]) {
    const h = harness(WorkbenchPackagePreview, { ...base, candidate, development: binding(development) });
    try { await h.settle(); h.mutate(changes); h.click('更新并试用'); await h.settle(); assert.match(h.text(), /开发需求或源码关联已变化/); assert.equal(h.requests.some(row => row.path === '/api/workdsh-workbench-import'), false); }
    finally { h.cleanup(); }
  }
});

test('source scan carries the confirmed saved development to package preview and rejects a scan crossing a requirements update', async () => {
  for (const changed of [false, true]) {
    const h = harness(WorkbenchSourceCandidates, { ...base, developmentId: development.id }, changed ? { scanMutation: { revision: 'new-revision', requirementsRevision: 'req-3', iterationId: 'iteration-3' } } : {});
    try {
      await h.settle();
      assert.equal(h.requests.filter(row=>row.path==='/api/workdsh-workbench-source-candidates').length,1,'entering the page scans automatically');
      assert.equal(h.requests.some(row=>row.path==='/api/workdsh-workbench-import'),false,'automatic check never installs');
      if (changed) { assert.match(h.text(), /需求或开发记录刚刚发生变化/); assert.doesNotMatch(h.text(), /查看并安装/); }
      else { h.click('查看并安装'); await h.settle(); const preview = nodes(h.tree()).find(node => typeof node.type === 'function' && node.type.name === 'WorkbenchPackagePreview'); assert.ok(preview); assert.deepEqual(preview.props.development, binding(development)); }
    } finally { h.cleanup(); }
  }
});

test('unassociated offline import retains its Host-owned import reference and does not create authoring records', async () => {
  const h = harness(WorkbenchPackagePreview, base);
  try {
    await h.settle(); h.selectFile(); await h.settle(); h.click('检查插件包'); await h.settle(); h.click('安装试用'); await h.settle();
    const operation = h.requests.find(row => row.path === '/api/workdsh-workbench-import').input;
    assert.equal(operation.developmentId, 'import:offline-owned'); assert.ok(operation.iterationId); assert.equal(h.requests.some(row => row.path === '/api/workdsh-workbench-development'), false);
    assert.match(h.text(), /安装文件已核验/);
  } finally { h.cleanup(); }
});

test('professional upload associated with an existing development uses its saved iteration and rechecks changed requirements', async () => {
  for (const changed of [false, true]) {
    const h = harness(WorkbenchPackageUpload, { developmentId: development.id, packageName: development.packageName, workbenchId: development.workbenchId });
    try {
      await h.settle(); h.selectFile(); h.version(candidate.package.version); await h.settle(); h.click('上传并核验'); await h.settle();
      if (changed) h.mutate({ revision: 'new-revision', requirementsRevision: 'req-3', iterationId: 'iteration-3' });
      h.click('确认更新插件'); await h.settle();
      const install = h.requests.find(row => row.path === '/api/workdsh-workbench-import');
      if (changed) { assert.equal(install, undefined); assert.match(h.text(), /开发需求已变化/); }
      else { assert.equal(install.input.developmentId, development.id); assert.equal(install.input.iterationId, development.iterationId); assert.match(h.text(), /安装文件已核验/); }
      assert.equal(h.requests.some(row => row.path.includes('offline')), false);
    } finally { h.cleanup(); }
  }
});


test('install trial distinguishes no generated package from a failed check without installing', async () => {
 for(const [options,expected] of [[{scanRows:[]},'还没有可安装的版本'],[{scanFailed:true},'暂时无法检查版本']]){
  const h=harness(WorkbenchSourceCandidates,{...base,developmentId:development.id},options);
  try{await h.settle();assert.ok(h.text().includes(expected));assert.equal(h.requests.some(row=>row.path==='/api/workdsh-workbench-import'),false);}
  finally{h.cleanup();}
 }
});

test('candidate page automatically reconciles an interrupted native install without a second install',async()=>{
 const h=harness(WorkbenchPackagePreview,{...base,candidate,development:binding(development)},{recoveryCode:null});
 try{await h.settle();assert.match(h.text(),/无需重复安装/);assert.match(h.text(),/启用工作台/);assert.equal(h.requests.filter(row=>row.path==='/api/workdsh-workbench-native-installation').length,1);assert.equal(h.requests.some(row=>row.path.includes('import-prepare')||row.path==='/api/workdsh-workbench-import'),false);}finally{h.cleanup();}
});
test('ambiguous native recovery never silently falls back to installing',async()=>{
 const h=harness(WorkbenchPackagePreview,{...base,candidate,development:binding(development)},{recoveryCode:'workbench/native-installation-unconfirmed'});
 try{await h.settle();assert.match(h.text(),/暂勿重复安装/);assert.equal(h.requests.some(row=>row.path.includes('import-prepare')||row.path==='/api/workdsh-workbench-import'),false);}finally{h.cleanup();}
});
