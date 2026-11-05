import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

function engine() {
 const props=new Map<string,string>([['CASTLE_AI_PASSCODE','a-long-team-passcode'],['OPENAI_API_KEY','test-secret']]);
 const cache=new Map<string,string>(); let calls=0;
 const ctx:any={console,Date,JSON,Math,Number,String,Object,Array,RegExp,
  PropertiesService:{getScriptProperties:()=>({getProperty:(k:string)=>props.get(k),setProperty:(k:string,v:string)=>props.set(k,v)})},
  CacheService:{getScriptCache:()=>({get:(k:string)=>cache.get(k),put:(k:string,v:string)=>cache.set(k,v)})},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
  castleHash:(s:string)=>s,castleRequestId:(s:string)=>{if(!/^[\w-]{20,80}$/.test(s))throw Error('Invalid ID');},
  castleRead:()=>({snapshot:{revision:'rev',months:[{id:'m',label:'November',properties:[{id:'p',name:'Jarvis',manager:'Team A',totalCents:10000,payments:[{id:'pay',amountCents:3500,bankCents:3000,bundleCents:9000,verifiedByDaisy:false}]}]}]}}),
  castleBuildRequests:()=>[],
  UrlFetchApp:{fetch:()=>{calls++;return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({output:[{type:'message',content:[{type:'output_text',text:'Castle report'}]}]})};}}
 };
 vm.createContext(ctx);vm.runInContext(readFileSync('apps-script/Assistant.gs','utf8'),ctx);
 return {ctx,props,cache,calls:()=>calls};
}
test('assistant accepts requests without any passcode property',()=>{const e=engine();e.props.delete('CASTLE_AI_PASSCODE');const r=e.ctx.castleAiRun({message:'Report on Castle payments',monthId:'m',history:[]});assert.equal(r.text,'Castle report');assert.equal(e.calls(),1);});
test('editor setup preserves existing properties and cancellation writes nothing',()=>{
 const e=engine();e.props.set('castle_request_existing','receipt');e.props.set('CASTLE_AI_DAILY_LIMIT','25');
 let replies=['sk-new-test-key'];const ui={Button:{OK:'ok'},ButtonSet:{OK_CANCEL:'buttons'},prompt:()=>({getSelectedButton:()=>replies.length?'ok':'cancel',getResponseText:()=>replies.shift()}),alert:()=>{}};
 e.ctx.SpreadsheetApp={getUi:()=>ui};e.ctx.castleConfigureAssistant();
 assert.equal(e.props.get('OPENAI_API_KEY'),'sk-new-test-key');assert.equal(e.props.get('CASTLE_AI_PASSCODE'),'a-long-team-passcode');assert.equal(e.props.get('castle_request_existing'),'receipt');assert.equal(e.props.get('CASTLE_AI_DAILY_LIMIT'),'25');
 replies=[];e.ctx.castleConfigureAssistant();assert.equal(e.props.get('OPENAI_API_KEY'),'sk-new-test-key');
});
test('assistant refuses unrelated requests without a model call',()=>{const e=engine();const r=e.ctx.castleAiRun({message:'Write a recipe for pancakes',monthId:'m',history:[]});assert.match(r.text,/Castle/i);assert.equal(e.calls(),0);});
test('record summaries distinguish received and bank amounts, calculated in cents',()=>{const e=engine();const r=e.ctx.castleAiQuery(e.ctx.castleRead().snapshot,{monthId:'m',search:'',offset:0});assert.equal(r.summary.receivedCents,3500);assert.equal(r.summary.bankCents,3000);assert.equal(r.summary.outstandingCents,6500);});
test('proposals cannot bypass bank verification or change unknown records',()=>{const e=engine();const s=e.ctx.castleRead();assert.throws(()=>e.ctx.castleAiProposal([{kind:'reconcileBank',paymentId:'pay'}],s),/allowed/i);assert.throws(()=>e.ctx.castleAiProposal([{kind:'updatePayment',paymentId:'pay',fields:{verifiedBySystem:true}}],s),/verification/i);assert.throws(()=>e.ctx.castleAiProposal([{kind:'deletePayment',paymentId:'unknown'}],s),/record/i);});
test('daily budget is enforced before another paid request',()=>{const e=engine();e.props.set('CASTLE_AI_DAILY_LIMIT','1');const b={message:'Report on Castle payments',monthId:'m',history:[]};e.ctx.castleAiRun(b);assert.throws(()=>e.ctx.castleAiRun(b),/limit/i);assert.equal(e.calls(),1);});
test('assistant provides follow-up, balance and team task evidence without attachments',()=>{
 const e=engine(),s=e.ctx.castleRead().snapshot;s.months[0].properties[0].followUp={status:'awaiting_response',note:'Call tomorrow',attachments:[{dataUrl:'private-image'}]};s.tasks=[{id:'t',title:'Review payment',status:'open',description:'Check deposit'}];
 const p=e.ctx.castleAiQuery(s,{monthId:'m',scope:'properties',search:'',offset:0});assert.equal(p.records.length,1);assert.equal(p.records[0].outstandingCents,6500);assert.equal(p.records[0].followUp.status,'awaiting_response');assert.equal(JSON.stringify(p).includes('private-image'),false);
 assert.equal(e.ctx.castleAiQuery(s,{scope:'team',offset:0}).records[0].title,'Review payment');
});
test('tool calls validate proposals but never save and include revision for review',()=>{
 const e=engine();let count=0;const bodies:any[]=[];
 e.ctx.UrlFetchApp.fetch=(_url:string,options:any)=>{bodies.push(JSON.parse(options.payload));const output=++count===1?[{type:'function_call',name:'propose_changes',call_id:'c',arguments:JSON.stringify({changesJson:JSON.stringify([{kind:'setTotal',propertyId:'p',amountCents:20000}])})}]:[{type:'message',content:[{type:'output_text',text:'Review your proposed change.'}]}];return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({output})};};
 const reply=e.ctx.castleAiRun({message:'Change property expected amount',monthId:'m',history:[]});
 assert.equal(reply.proposal.revision,'rev');assert.equal(reply.proposal.changes[0].amountCents,20000);assert.equal(e.ctx.castleRead().snapshot.months[0].properties[0].totalCents,10000);assert.equal(count,2);assert.equal(bodies[0].store,false);assert.equal(JSON.stringify(bodies).includes('a-long-team-passcode'),false);
});
test('repeated tool calls are capped and provider errors do not expose credentials',()=>{
 const e=engine();let calls=0;e.ctx.UrlFetchApp.fetch=()=>{calls++;return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({output:[{type:'function_call',name:'query_records',call_id:'c'+calls,arguments:'{"monthId":"m","search":"","offset":0,"scope":"properties"}'}]})};};
 const b={message:'Report on properties',monthId:'m',history:[]};assert.match(e.ctx.castleAiRun(b).text,/limit/);assert.equal(calls,3);
 e.ctx.UrlFetchApp.fetch=()=>{throw Error('test-secret');};assert.throws(()=>e.ctx.castleAiRun(b),err=>!/test-secret/.test(String(err)));
});
test('AI report tool returns a downloadable model-authored artifact',()=>{
 const e=engine();e.ctx.UrlFetchApp.fetch=()=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({output:[{type:'function_call',name:'create_report',call_id:'r',arguments:JSON.stringify({title:'November report',markdown:'# Findings\nReceived: $35.00'})}]})});
 const result=e.ctx.castleAiRun({message:'Generate a downloadable PDF report',monthId:'m',history:[]});assert.equal(result.report.title,'November report');assert.match(result.report.markdown,/Received/);
});
test('screenshot input reaches the vision model without being treated as instructions',()=>{
 const e=engine();let body:any;e.ctx.UrlFetchApp.fetch=(_url:string,options:any)=>{body=JSON.parse(options.payload);return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({output:[{type:'message',content:[{text:'Screenshot analysis'}]}]})};};
 e.ctx.castleAiRun({message:'Read this screenshot',monthId:'m',history:[],attachment:{id:'a',name:'screen.png',kind:'image',dataUrl:'data:image/png;base64,aGVsbG8='}});
 assert.ok(body.input.some((m:any)=>Array.isArray(m.content)&&m.content.some((c:any)=>c.type==='input_image')));assert.match(body.instructions,/untrusted/i);
});
test('import tool validates original file type and cannot import screenshots',()=>{
 const e=engine();e.ctx.UrlFetchApp.fetch=()=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({output:[{type:'function_call',name:'prepare_import',call_id:'i',arguments:'{"kind":"bank","attachmentId":"a"}'}]})});
 const b={message:'Import bank file',monthId:'m',history:[],attachment:{id:'a',name:'statement.pdf',kind:'document',text:'AIRBNB PAYMENTS 10.00'}};
 assert.equal(e.ctx.castleAiRun(b).importAction.kind,'bank');
 assert.equal(e.ctx.castleAiRun({...b,attachment:{id:'a',name:'screen.png',kind:'image',dataUrl:'data:image/png;base64,aGVsbG8='}}).importAction,undefined);
});
test('attachment limits are checked before paid API calls',()=>{
 const e=engine();assert.throws(()=>e.ctx.castleAiRun({message:'Read file',history:[],attachment:{id:'a',name:'notes.txt',kind:'document',text:'x'.repeat(18001)}}),/attachment|18,000/i);assert.equal(e.calls(),0);
});

test('report format is requested before spending tokens when unspecified',()=>{const e=engine();const r=e.ctx.castleAiRun({message:'Give me a downloadable report',history:[],monthId:'m'});assert.equal(r.chooseReportFormat,true);assert.equal(e.calls(),0);});
test('report output format is distinct from attached source file format',()=>{
 const e=engine();assert.equal(e.ctx.castleAiReportFormat('Create an Excel report from the attached PDF',[]),'xlsx');assert.equal(e.ctx.castleAiReportFormat('Create a report from this PDF',[]),null);
 const history=[{role:'assistant',content:'Which file type would you like?'}];assert.equal(e.ctx.castleAiReportFormat('PDF please',history),'pdf');assert.equal(e.ctx.castleAiReportFormat('Excel',history),'xlsx');assert.equal(e.ctx.castleAiRun({message:'PDF please',history,monthId:'m'}).text,'Castle report');
});
