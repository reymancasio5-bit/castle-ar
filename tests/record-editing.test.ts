import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewApi } from '../src/preview-api.ts';
test('preview supports rename and payment/property deletion without affecting other records',async()=>{
 const api=createPreviewApi();let state=await api.read();const month=state.months[0],property=month.properties.find(p=>p.payments.length)!;const other=month.properties.filter(p=>p.id!==property.id);
 state=await api.save(state.revision,[{kind:'updateProperty',propertyId:property.id,name:'Edited property',manager:property.manager}]);assert.equal(state.months[0].properties.find(p=>p.id===property.id)?.name,'Edited property');
 state=await api.save(state.revision,[{kind:'deletePayment',paymentId:property.payments[0].id}]);assert.equal(state.months[0].properties.find(p=>p.id===property.id)?.payments.length,property.payments.length-1);
 state=await api.save(state.revision,[{kind:'deleteProperty',propertyId:property.id}]);assert.deepEqual(state.months[0].properties,other);
});
