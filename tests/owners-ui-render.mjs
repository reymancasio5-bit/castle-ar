import assert from 'node:assert/strict';
import {createServer} from 'vite';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
 const {default:PropertyOwners}=await server.ssrLoadModule('/src/PropertyOwners.tsx');
 const {default:OwnerPaymentReview,parseAllocations}=await server.ssrLoadModule('/src/OwnerPaymentReview.tsx');
 const {default:BankStatementImport}=await server.ssrLoadModule('/src/BankStatementImport.tsx');
 const {createPreviewApi}=await server.ssrLoadModule('/src/preview-api.ts');
 const {matchOwnerDeposits}=await server.ssrLoadModule('/src/owners.ts');
 const api=createPreviewApi();let snapshot=await api.read();const month=snapshot.months[0];
 const properties=month.properties.filter(p=>!p.bundleOnly).slice(0,2);
 const owner={id:'owner-ui-test',name:'Sample Owner',bankName:'SAMPLE OWNER',email:'',notes:'',active:true,propertyNames:properties.map(p=>p.name)};
 snapshot=await api.save(snapshot.revision,[{kind:'saveOwner',owner}]);
 const props={snapshot,monthId:month.id,onSave:async()=>{},onDirtyChange:()=>{},onOpenListing:()=>{},onBankImport:()=>{}};
 const html=renderToStaticMarkup(React.createElement(PropertyOwners,props));
 for(const label of ['Property Owners','Sample Owner','Edit Owner','Assigned Properties','Owner Payment History','Import Bank Statement',properties[0].name])assert.ok(html.includes(label),label);
 const noBackend=renderToStaticMarkup(React.createElement(PropertyOwners,{...props,snapshot:{...snapshot,ownerSchema:undefined}}));assert.ok(noBackend.includes('Update the Google Apps Script'));
 const deposit={kind:'owner',ownerName:owner.bankName,account:'5864',date:'2026-11-01',reference:'C1TEST123',source:'test.pdf',amountCents:10000};
 const row=matchOwnerDeposits([deposit],month,[owner],[])[0];
 const reviewProps={row,values:{[properties[0].id]:'40.00',[properties[1].id]:'60.00'},skipped:false,disabled:false,onChange:()=>{},onSkip:()=>{}};
 const review=renderToStaticMarkup(React.createElement(OwnerPaymentReview,reviewProps));
 for(const label of ['Allocate this deposit','Skip this deposit','Remaining:','C1TEST123','40.00','60.00'])assert.ok(review.includes(label),label);
 const splits=parseAllocations(reviewProps.values);assert.equal(splits.reduce((sum,a)=>sum+a.amountCents,0),10000);
 assert.throws(()=>parseAllocations({id:'-1'}));assert.throws(()=>parseAllocations({id:'1.001'}));
 snapshot=await api.save(snapshot.revision,[{...deposit,kind:'importOwnerTransfer',ownerId:owner.id,monthId:month.id,bankName:deposit.ownerName,allocations:splits}]);
 const history=renderToStaticMarkup(React.createElement(PropertyOwners,{...props,snapshot}));assert.ok(history.includes('C1TEST123'));
 const modal=renderToStaticMarkup(React.createElement(BankStatementImport,{snapshot,month,onClose:()=>{},onApply:async()=>{},supported:true}));assert.ok(modal.includes('owner e-Transfer'));
 console.log('Owner directory, allocation review, payment history and import rendering passed.');
}finally{await server.close();}

