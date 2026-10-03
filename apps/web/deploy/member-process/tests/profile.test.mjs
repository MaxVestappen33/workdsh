import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {parse}=createRequire(new URL('../../../../../packages/bundle/package.json',import.meta.url))('yaml');
import {renderMemberPatch} from '../profile.mjs';

const member={id:'member-a',org:'org-a',root:'/state/member-a'};
const backendUrl='https://admin.example.test/';

test('directory session composition keeps native persistence and fixed member identity',()=>{
 const rows=parse(renderMemberPatch(member,{backendUrl}));
 const identity=rows[0].insert[0];
 assert.equal(identity.name,'workdsh-provider-identity-enterprise/process');
 assert.equal(identity.config.principalId,member.id);
 assert.equal(identity.config.organizationId,member.org);
 assert.equal(rows.some(r=>r.id==='session-persistence-jsonl'),false);
 assert.equal(rows.some(r=>r.name==='workdsh-provider-identity-local'),false);
 assert.deepEqual(rows.find(r=>r.id==='workdsh-session-access').config,{autoBindFixedMemberSessions:true});
 assert.deepEqual(rows.find(r=>r.id==='workdsh-tool-access').config,{autoBindPersonalSessions:false,autoBindFixedMemberSessions:true});
});

test('database session composition uses a member loopback bridge without platform credentials',()=>{
 const patch=renderMemberPatch(member,{backendUrl,bridgeUrl:'http://127.0.0.1:32000'});
 const rows=parse(patch),sessions=rows.flatMap(r=>r.insert??[]).find(r=>r.name.endsWith('/process-sessions'));
 assert.equal(sessions.config.bridgeUrl,'http://127.0.0.1:32000');
 assert.equal(rows.find(r=>r.id==='session-persistence-jsonl').disabled,true);
 assert.equal(/runtimeToken|apiKey|serviceKey|proof-/.test(patch),false);
});

test('backend-supplied identifiers remain inert YAML strings and bridges cannot point elsewhere',()=>{
 const id='member-a\n- id: workdsh-identity-local';
 assert.equal(parse(renderMemberPatch({...member,id},{backendUrl}))[0].insert[0].config.principalId,id);
 for(const bridgeUrl of ['http://example.test:32000','http://127.0.0.1:32000/path','http://user:password@127.0.0.1:32000']){
  assert.throws(()=>renderMemberPatch(member,{backendUrl,bridgeUrl}),/loopback/);
 }
 assert.throws(()=>renderMemberPatch(member,{backendUrl:'http://admin.example.test/'}),/HTTPS/);
});
