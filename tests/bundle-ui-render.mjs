import assert from 'node:assert/strict';
import {createServer} from 'vite';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
 const {default:BundleMatching,BundlePaymentTable}=await server.ssrLoadModule('/src/BundleMatching.tsx');
 const {default:App}=await server.ssrLoadModule('/src/App.tsx');
 const {createPreviewApi}=await server.ssrLoadModule('/src/preview-api.ts');
 const {ConfirmationProvider}=await server.ssrLoadModule('/src/Confirmation.tsx');
 const payment={id:'pay',type:'Airbnb',amountCents:20000,bundleCents:50000,payoutDate:'2026-11-05',bankDetails:'Checking 5864',bankDate:'2026-11-06',bankCents:20000,verifiedBySystem:true,verifiedByDaisy:false};
 const month={id:'m',label:'November 2026',month:'2026-11',properties:[{id:'ar',name:'AR listing',manager:'Team A',totalCents:10000,payments:[]},{id:'bundle',name:'Bundle listing',bundleOnly:true,manager:'Team A',totalCents:0,payments:[payment,{...payment,id:'pay-two',amountCents:10000}]}]};
 const props={month,onImport(){},onBankImport(){},onOpen(){},onExport(){}};
 const html=renderToStaticMarkup(React.createElement(BundleMatching,props));
 for(const text of ['Bundle listing','300.00','Checking 5864','Matched','Import Bank Statement','Bundle Matching Properties'])assert.ok(html.includes(text),text);
 for(const text of ['AR listing','Overpaid','Outstanding','Total Expected','Payout Date','Bundle Amount'])assert.ok(!html.includes(text),text);
 assert.equal((html.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0].match(/<tr/g)||[]).length,1,'one row per property, not per payment');
 const detail=renderToStaticMarkup(React.createElement(BundlePaymentTable,{rows:month.properties[1].payments.map(payment=>({property:month.properties[1],payment})),onOpen(){}}));
 for(const text of ['Payout Date','Bundle Amount','500.00','200.00','100.00','Checking 5864'])assert.ok(detail.includes(text),text);
 assert.equal((detail.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0].match(/<tr/g)||[]).length,2);
 assert.ok(renderToStaticMarkup(React.createElement(BundleMatching,{...props,month:{...month,properties:[]}})).includes('leave Expected Amount blank or enter 0'));
 globalThis.window={location:{search:'?preview=1&view=bundles'},sessionStorage:{getItem(){return null;}}};
 const app=renderToStaticMarkup(React.createElement(ConfirmationProvider,null,React.createElement(App,{api:createPreviewApi(),configured:false})));
 assert.ok(app.includes('<h1>Bundle Matching</h1>'));
 assert.ok(!app.includes('class="Bundle Matching"'));
 console.log('Bundle UI render checks passed: scoped records, matching columns, empty state, navigation.');
}finally{delete globalThis.window;await server.close();}
