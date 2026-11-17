import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import React,{useState} from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {createServer} from 'vite';

let server:any,RetainedWorkspace:any,useBackgroundForm:any,FollowUps:any,panels:any;
const originalWindow=globalThis.window;
before(async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 (globalThis as any).window={addEventListener(){},removeEventListener(){}};
 server=await createServer({cacheDir:'node_modules/.vite-background-tests',optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null},appType:'custom'});
 ({RetainedWorkspace,useBackgroundForm}=await server.ssrLoadModule('/src/BackgroundWork.tsx'));
 ({default:FollowUps}=await server.ssrLoadModule('/src/FollowUps.tsx'));
 panels=await server.ssrLoadModule('/src/background-panels.ts');
});
after(async()=>{await server?.close();globalThis.window=originalWindow;delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;});

test('navigation retains an edited view and its asynchronous updates',async()=>{
 let finish!:()=>void;
 function Editor(){const [value,setValue]=useState('draft');finish=()=>setValue('finished in background');return React.createElement('textarea',{value,onChange:(e:any)=>setValue(e.target.value)});}
 let root:any;
 await act(async()=>{root=TestRenderer.create(React.createElement(RetainedWorkspace,{activeKey:'first'},React.createElement(Editor)));});
 await act(async()=>root.root.findByType('textarea').props.onChange({target:{value:'retained draft'}}));
 await act(async()=>root.update(React.createElement(RetainedWorkspace,{activeKey:'second'},React.createElement('p',null,'Other page'))));
 assert.equal(root.root.findByType('textarea').props.value,'retained draft');
 assert.equal(root.root.findByProps({hidden:true}).findByType('textarea').props.value,'retained draft');
 await act(async()=>finish());
 await act(async()=>root.update(React.createElement(RetainedWorkspace,{activeKey:'first'},React.createElement(Editor))));
 assert.equal(root.root.findByType('textarea').props.value,'finished in background');
 await act(async()=>root.unmount());
});

test('a busy form minimizes and remains recoverable after processing ends',async()=>{
 let state:any,root:any;
 function Form({busy}:{busy:boolean}){state=useBackgroundForm('Test Form',busy);return React.createElement('input',{value:'retained'});}
 await act(async()=>{root=TestRenderer.create(React.createElement(Form,{busy:false}));});
 await act(async()=>root.update(React.createElement(Form,{busy:true})));
 assert.equal(state.minimized,true);assert.equal(panels.getBackgroundPanels()[0].busy,true);
 await act(async()=>root.update(React.createElement(Form,{busy:false})));
 assert.equal(state.minimized,true);assert.equal(panels.getBackgroundPanels()[0].busy,false);
 await act(async()=>panels.getBackgroundPanels()[0].open());
 assert.equal(state.minimized,false);assert.equal(root.root.findByType('input').props.value,'retained');
 await act(async()=>root.unmount());assert.equal(panels.getBackgroundPanels().length,0);
});

test('clean visited views are released while explicitly retained drafts stay mounted',async()=>{
 let root:any;
 await act(async()=>{root=TestRenderer.create(React.createElement(RetainedWorkspace,{activeKey:'draft',retainKeys:['draft']},React.createElement('textarea',{defaultValue:'Keep'})));});
 await act(async()=>root.update(React.createElement(RetainedWorkspace,{activeKey:'clean',retainKeys:['draft']},React.createElement('p',null,'Clean page'))));
 assert.equal(root.root.findAllByType('textarea').length,1);
 await act(async()=>root.update(React.createElement(RetainedWorkspace,{activeKey:'next',retainKeys:['draft']},React.createElement('button',null,'Next page'))));
 assert.equal(root.root.findAllByType('p').length,0);assert.equal(root.root.findAllByType('textarea').length,1);
 await act(async()=>root.update(React.createElement(RetainedWorkspace,{activeKey:'next',retainKeys:[]},React.createElement('button',null,'Next page'))));
 assert.equal(root.root.findAllByType('textarea').length,0);
 await act(async()=>root.unmount());
});

test('a follow-up draft survives row ID shifts, filtering, and failed saves',async()=>{
 const house={id:'m:4',name:'House',manager:'Team A',totalCents:1000,payments:[]};
 const props={properties:[house],managers:[],revision:'original',onSave:async()=>{throw new Error('Network failed');},onOpen:()=>{},onDirtyChange:()=>{}};
 let root:any;
 await act(async()=>{root=TestRenderer.create(React.createElement(FollowUps,props));});
 await act(async()=>root.root.findByProps({'aria-label':'Edit follow-up for House'}).props.onClick());
 await act(async()=>root.root.findByType('textarea').props.onChange({target:{value:'Keep my note'}}));
 await act(async()=>root.update(React.createElement(FollowUps,{...props,revision:'new',properties:[{...house,name:'Different Property'},{...house,id:'m:20'}]})));
 assert.equal(root.root.findByType('textarea').props.value,'Keep my note');
 assert.equal(root.root.findAllByProps({'aria-label':'Follow-up for Different Property'}).length,0);
 await act(async()=>root.update(React.createElement(FollowUps,{...props,properties:[]})));
 assert.equal(root.root.findByType('textarea').props.value,'Keep my note');
 await act(async()=>root.root.findAllByType('button').find((b:any)=>b.children.includes('Save Follow-Up')).props.onClick());
 assert.equal(root.root.findByType('textarea').props.value,'Keep my note');
 assert.ok(root.root.findByProps({role:'alert'}).children.includes('Network failed'));
 await act(async()=>root.unmount());
});
