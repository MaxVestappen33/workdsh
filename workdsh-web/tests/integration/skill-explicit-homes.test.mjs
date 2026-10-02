import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import SkillRegistry from '@deepseek-ai/dsh-skill';
import * as filesystem from '@deepseek-ai/dsh-skill-filesystem';
import { SkillManager } from '../../packages/plugins/skills/dist/index.js';

test('explicit skill homes separate same-name definitions and mutations without changing environment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skill-explicit-homes-'));
  const contexts = [];
  const environment = [process.env.DSH_HOME, process.env.DSH_AGENTS_HOME, process.env.WORKDSH_SKILL_CATALOG];
  try {
    for (const member of ['a','b']) {
      const agentsHome = join(root, member, 'agents'); const dshHome = join(root, member, 'dsh');
      await mkdir(join(agentsHome, 'skills/shared-name'), { recursive: true });
      await writeFile(join(agentsHome, 'skills/shared-name/SKILL.md'), `---\nname: shared-name\ndescription: Member ${member} fixture\n---\nOwned by ${member}\n`);
      const ctx = new Context(); contexts.push(ctx);
      await ctx.plugin(SkillRegistry);
      await ctx.plugin(filesystem, { agentsHome, dshHome, watch: false });
      new SkillManager(ctx, { agentsHome, dshHome });
    }
    const [a,b] = contexts;
    assert.equal((await a.workdshSkills.detail('shared-name')).description, 'Member a fixture');
    assert.equal((await b.workdshSkills.detail('shared-name')).description, 'Member b fixture');
    await a.workdshSkills.setEnabled('shared-name', false);
    assert.equal((await a.workdshSkills.detail('shared-name')).state, 'disabled');
    assert.equal((await b.workdshSkills.detail('shared-name')).state, 'enabled');
    assert.ok((await readFile(join(root, 'b/agents/skills/shared-name/SKILL.md'), 'utf8')).includes('Owned by b'));
    await a.workdshSkills.setEnabled('shared-name', true);
    assert.deepEqual([process.env.DSH_HOME, process.env.DSH_AGENTS_HOME, process.env.WORKDSH_SKILL_CATALOG], environment);
  } finally { for (const ctx of contexts) await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); }
});


test('old default catalogs stay disabled while installed skills and explicitly selected catalogs work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skill-catalog-opt-in-'));
  const agentsHome = join(root, 'agents'); const dshHome = join(root, 'dsh');
  const catalogRoot = join(agentsHome, '.workdsh-catalog');
  const contexts = [];
  const environment = {...process.env};
  try {
    await mkdir(join(agentsHome, 'skills/installed-fixture'), {recursive:true});
    await writeFile(join(agentsHome, 'skills/installed-fixture/SKILL.md'), '---\nname: installed-fixture\ndescription: Existing personal skill\n---\nInstalled\n');
    await mkdir(catalogRoot, {recursive:true});
    await writeFile(join(catalogRoot, 'catalog.json'), JSON.stringify({schema:1,kind:'workdsh-skill-catalog',entries:[{name:'recommendation',description:'Optional fixture'}]}));
    process.env.DSH_HOME=dshHome; process.env.DSH_AGENTS_HOME=agentsHome;
    delete process.env.WORKDSH_SKILL_CATALOG;
    for (const options of [{}, {agentsHome,dshHome,catalogRoot}, {agentsHome,dshHome}]) {
      const ctx = new Context(); contexts.push(ctx);
      await ctx.plugin(SkillRegistry);
      await ctx.plugin(filesystem, {agentsHome,dshHome,watch:false});
      new SkillManager(ctx, options);
      process.env.WORKDSH_SKILL_CATALOG=catalogRoot;
    }
    const [personal,selected,isolated]=contexts;
    assert.equal((await personal.workdshSkills.catalog()).status,'missing');
    assert.deepEqual((await personal.workdshSkills.catalog()).entries,[]);
    assert.equal((await personal.workdshSkills.detail('installed-fixture')).description,'Existing personal skill');
    assert.equal((await selected.workdshSkills.catalog()).entries[0].name,'recommendation');
    assert.deepEqual((await isolated.workdshSkills.catalog()).entries,[]);
    await assert.rejects(personal.workdshSkills.installFromCatalog('recommendation'), /catalog-entry-unknown/);
  } finally {
    for(const ctx of contexts)await ctx.fiber.dispose();
    for(const key of ['DSH_HOME','DSH_AGENTS_HOME','WORKDSH_SKILL_CATALOG']) {
      if(environment[key]===undefined)delete process.env[key]; else process.env[key]=environment[key];
    }
    await rm(root,{recursive:true,force:true});
  }
});
