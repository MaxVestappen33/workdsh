import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { preflightExternals } from './support/preflight-externals.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const require = createRequire(join(root, 'apps/web/package.json'));
const semver = createRequire(new URL('../package.json', import.meta.url))('semver');
const official = createRequire(require.resolve('@deepseek-ai/dsh/package.json'));
const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href);
const { default: Loader } = await import(pathToFileURL(official.resolve('@deepseek-ai/cordis-plugin-loader')).href);
const { build } = require('esbuild');
const built = await build({stdin:{contents:[
  "export {HostWorkbenchRegistration} from './runtime/host-registration.ts';",
  "export {ClientWorkbenchRegistration} from './client/client-registration.ts';",
  "export {createWorkbenchRegistrationClient} from './client/registration-client.ts';",
  "export {handleWorkbenchRegistrationRequest} from './runtime/registration-rpc.ts';",
  "export {InstalledWorkbenchManifestReader} from './runtime/installed-manifest-reader.ts';",
  "export {createWorkbenchInstallationVerifier} from './runtime/installation-verifier.ts';",
  "export {catalogStatus} from './client/catalog-status.ts';",
].join('\n'),resolveDir:join(root,'packages/plugins/workbenches/src'),loader:'ts'},
  bundle:true,platform:'node',format:'esm',write:false,plugins:[preflightExternals],
  alias:{'workdsh-contracts':join(root,'packages/contracts/src/index.ts')}});
const {HostWorkbenchRegistration,ClientWorkbenchRegistration,createWorkbenchRegistrationClient,handleWorkbenchRegistrationRequest,
  InstalledWorkbenchManifestReader,createWorkbenchInstallationVerifier,catalogStatus}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

test('official Cordis Host and Client graphs survive a verified old managed workbench without enabling its page',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'workdsh-managed-upgrade-'));
 const host=new Context(),client=new Context();let registration,clientRegistration;
 try{
  const name='workdsh-old-upgrade-probe',installed=join(directory,'node_modules',name),packed=join(directory,'packed');
  await mkdir(installed,{recursive:true});await mkdir(packed);
  await writeFile(join(directory,'package.json'),'{"private":true,"type":"module"}');
  const descriptor={id:'workdsh.upgrade-probe',title:'旧版本业务',description:'',protocolVersion:'1.0',layout:'full-page',
   hostCompatibility:{sdk:'^1.0.0',harness:'0.2.1-rc.1'},capabilities:[]};
  const manifest={name,version:'0.1.0',type:'module',files:['index.js','client.js','index.d.ts','client.d.ts','cordis.patch.yml'],
   exports:{'.':{default:'./index.js',types:'./index.d.ts'},'./client':{default:'./client.js',types:'./client.d.ts'}},
   workdsh:{workbench:descriptor},dsh:{bundle:{patch:'./cordis.patch.yml'},client:{platform:'web'}}};
  await writeFile(join(installed,'package.json'),JSON.stringify(manifest));
  await writeFile(join(installed,'index.js'),`export const inject=['workdshWorkbenchRegistration'];export async function apply(ctx){await ctx.get('workdshWorkbenchRegistration').registerManaged(ctx,${JSON.stringify(descriptor)},'old-page');ctx.get('probe').ready(ctx);}`);
  await writeFile(join(installed,'client.js'),`export const inject=['workdshWorkbenchClientRegistration'];export async function apply(ctx){await ctx.get('workdshWorkbenchClientRegistration').registerManaged(ctx,${JSON.stringify(descriptor)},()=>null);ctx.get('probe').ready(ctx);}`);
  for(const file of ['index.d.ts','client.d.ts'])await writeFile(join(installed,file),'export {};');
  await writeFile(join(installed,'cordis.patch.yml'),'- insert: []\n');
  const pnpm=join(root,'apps/web/node_modules/pnpm/bin/pnpm.cjs');
  await promisify(execFile)(process.execPath,[pnpm,'--dir',installed,'pack','--pack-destination',packed],{timeout:15000});
  const archive=join(packed,name+'-0.1.0.tgz'),sha256=createHash('sha256').update(await readFile(archive)).digest('hex');
  // pnpm normalizes package.json in its archive. Check the installed archive
  // bytes, rather than confusing the unnormalized source with an installation.
  await promisify(execFile)('tar',['-xzf',archive,'--strip-components=1','-C',installed],{timeout:15000});
  const verify=createWorkbenchInstallationVerifier(directory,async()=>({path:archive,sha256,workbenchId:descriptor.id}),
   value=>semver.satisfies('0.2.1-rc.2',value.hostCompatibility.harness,{includePrerelease:true}));
  await host.plugin(Loader,{baseUrl:pathToFileURL(directory+'/').href});
  registration=new HostWorkbenchRegistration(host.loader,new InstalledWorkbenchManifestReader(directory),verify);
  host.provide('workdshWorkbenchRegistration',registration);
  let hostCaller,clientCaller;host.provide('probe',{ready(ctx){hostCaller=ctx;}});
  const hostEntry=await host.loader.create({name});
  await host.loader.await();
  await host.loader.resolve(hostEntry).fiber?.await();
  assert.ok(hostCaller,'the official Host Loader completes the old managed plugin apply');hostCaller.fiber.assertActive();
  assert.equal(host.loader.resolve(hostEntry).disabled,false,'selection is never silently disabled');
  assert.deepEqual(registration.list(),[],'no incompatible business registration is active');
  const authority=await registration.clientAuthority(name);assert.equal(authority.compatible,false);assert.equal(authority.package.sha256,sha256);
  assert.equal(catalogStatus({compatible:false}).label,'版本不兼容');
  await client.plugin(Loader,{baseUrl:pathToFileURL(directory+'/').href});
  let pages=0;
  const transport=async(_url,options)=>handleWorkbenchRegistrationRequest(new Request('http://localhost/api/workdsh-workbench-registration',options),registration,async()=>()=>{});
  clientRegistration=new ClientWorkbenchRegistration(client.loader,createWorkbenchRegistrationClient(transport),{
   mountPage(){pages++;return()=>pages--;},selectedPanel(){},openManager(){},
  });
  client.provide('workdshWorkbenchClientRegistration',clientRegistration);client.provide('probe',{ready(ctx){clientCaller=ctx;}});
  const clientEntry=await client.loader.create({name:name+'/client'});
  await client.loader.await();
  await client.loader.resolve(clientEntry).fiber?.await();
  assert.ok(clientCaller,'the official Client Loader completes instead of failing the application boot');clientCaller.fiber.assertActive();
  assert.equal(pages,0);
  let platformReady=0;
  await host.plugin({name:'host-platform-after-old-business',apply(){platformReady++;}});
  await client.plugin({name:'client-platform-after-old-business',apply(){platformReady++;}});
  assert.equal(platformReady,2,'both official graphs can continue mounting platform capabilities');
  await hostCaller.fiber.dispose();await clientCaller.fiber.dispose();
  await assert.rejects(registration.clientAuthority(name),/unregistered-package/);assert.equal(pages,0);
 }finally{clientRegistration?.close();registration?.close();await client.fiber.dispose();await host.fiber.dispose();await rm(directory,{recursive:true,force:true});}
});
