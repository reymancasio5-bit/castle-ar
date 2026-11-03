import assert from 'node:assert/strict';
import {createServer} from 'vite';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

// Render production components without a browser; interaction and visual QA
// remain separate. This catches missing records, controls, and rendering errors.
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
 const {default:AccountManagers}=await server.ssrLoadModule('/src/AccountManagers.tsx');
 const {default:ManagerSelect}=await server.ssrLoadModule('/src/ManagerSelect.tsx');
 const {default:ManagerAvatar}=await server.ssrLoadModule('/src/ManagerAvatar.tsx');
 const {default:App}=await server.ssrLoadModule('/src/App.tsx');
 const {createPreviewApi}=await server.ssrLoadModule('/src/preview-api.ts');
 const snapshot=await createPreviewApi().read();
 const props={snapshot,monthId:snapshot.months[0].id,onSave:async()=>{},onDirtyChange:()=>{},onOpenListing:()=>{}};
 const html=renderToStaticMarkup(React.createElement(AccountManagers,props));
 for(const text of ['Account Managers','Assigned Listings','Tasks','Updates','Team B'])assert.ok(html.includes(text),text);
 const noMonths=renderToStaticMarkup(React.createElement(AccountManagers,{...props,snapshot:{...snapshot,months:[]},monthId:''}));
 assert.ok(noMonths.includes('No listings in this view'));
 const dropdown=renderToStaticMarkup(React.createElement(ManagerSelect,{managers:snapshot.managers,value:'Team B',onChange:()=>{}}));
 assert.ok(dropdown.includes('<select'));assert.ok(!dropdown.includes('<input'));assert.ok(dropdown.includes('Team A'));
 const inactive={...snapshot.managers[0],active:false};
 const newAssignment=renderToStaticMarkup(React.createElement(ManagerSelect,{managers:[inactive],value:'',onChange:()=>{}}));
 assert.ok(!newAssignment.includes(inactive.name));
 const currentAssignment=renderToStaticMarkup(React.createElement(ManagerSelect,{managers:[inactive],value:inactive.name,currentValue:inactive.name,onChange:()=>{}}));
 assert.ok(currentAssignment.includes('(inactive)'));
 assert.ok(renderToStaticMarkup(React.createElement(AccountManagers,props)).includes('Delete Manager'));
 const upgrade=renderToStaticMarkup(React.createElement(AccountManagers,{...props,snapshot:{...snapshot,managerSchema:undefined}}));
 assert.ok(upgrade.includes('updated Google Sheets connection script'));
 for(const [name,profile] of [['Team B','team-b'],['Team A','team-a']]){
  const avatar=renderToStaticMarkup(React.createElement(ManagerAvatar,{manager:{name,profileImage:profile}}));
  assert.ok(avatar.includes('am-avatar-'+profile));assert.ok(avatar.includes(name));
 }
 const blank=renderToStaticMarkup(React.createElement(ManagerAvatar,{manager:{name:'Team B',profileImage:''}}));
 assert.ok(blank.includes('No profile image'));assert.ok(!blank.includes('Team B'));
 const uploaded=renderToStaticMarkup(React.createElement(ManagerAvatar,{manager:{name:'Alice',profileImage:'data:image/png;base64,iVBORw0KGgo='}}));
 assert.ok(uploaded.includes('<img'));assert.ok(uploaded.includes('Alice profile image'));
 const originalWindow=globalThis.window;
 try{
  globalThis.window={location:{search:''},sessionStorage:{getItem:key=>key==='castle-workspace-location-v1'?JSON.stringify({view:'reconciliation',monthId:'0',search:'Jarvis',manager:'Team B',status:'outstanding'}):null}};
  const restored=renderToStaticMarkup(React.createElement(App,{api:createPreviewApi(),configured:false}));
  assert.ok(restored.includes('Payment Reconciliation'),'App restores the saved page on reload');
 }finally{if(originalWindow===undefined)delete globalThis.window;else globalThis.window=originalWindow;}
 console.log('Manager UI render checks passed: directory, empty listings, record-only selects, inactive assignments, backend upgrade notice.');
} finally {await server.close();}
