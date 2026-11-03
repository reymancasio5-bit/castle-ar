import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultManagerProfile,isValidManagerProfile,managerProfile,prepareManagerProfile} from '../src/manager-profiles.ts';
import {createPreviewApi} from '../src/preview-api.ts';
const png='data:image/png;base64,iVBORw0KGgo=';
test('existing teams receive their reference badges and other managers receive a blank profile',()=>{
 assert.equal(defaultManagerProfile('Team B'),'team-b');assert.equal(defaultManagerProfile('teama'),'team-a');
 assert.equal(defaultManagerProfile('Alice'),'');assert.equal(managerProfile({name:'Team A',profileImage:''}),'');
});
test('profile validation allows blank/presets/raster data and rejects URLs, SVG and oversized images',()=>{
 for(const value of ['', 'team-a','team-b',png])assert.equal(isValidManagerProfile(value),true);
 for(const value of ['https://example.com/avatar.png','data:image/svg+xml;base64,AAAA','data:image/png;base64,AAAA',png+'A'.repeat(45000),42])assert.equal(isValidManagerProfile(value),false);
});
test('preview saves, replaces and removes a manager profile without restoring its preset',async()=>{
 const api=createPreviewApi();let s=await api.read();assert.equal(s.managerProfiles,1);let m=s.managers![0];assert.equal(m.profileImage,'team-b');
 for(const profileImage of [png,'team-a','']){s=await api.save(s.revision,[{kind:'saveManager',manager:{...m,profileImage}}]);m=s.managers![0];assert.equal(m.profileImage,profileImage);assert.equal(managerProfile(m),profileImage);}
 const before=await api.read();await assert.rejects(api.save(s.revision,[{kind:'saveManager',manager:{...m,profileImage:'javascript:alert(1)'}}]),/profile/i);assert.deepEqual(await api.read(),before);
 s=await api.save(s.revision,[{kind:'saveManager',manager:{id:'new',name:'New manager',email:'',notes:'',active:true}}]);assert.equal(s.managers!.find(m=>m.id==='new')!.profileImage,'');
});

test('profile upload rejects unsupported, empty, and oversized source files before decoding',async()=>{
 await assert.rejects(prepareManagerProfile(new File(['svg'],'profile.svg',{type:'image/svg+xml'})),/PNG/);
 await assert.rejects(prepareManagerProfile(new File([],'empty.png',{type:'image/png'})),/5 MB/);
 await assert.rejects(prepareManagerProfile(new File([new Uint8Array(5*1024*1024+1)],'large.png',{type:'image/png'})),/5 MB/);
});
