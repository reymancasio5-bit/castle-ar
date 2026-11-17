import assert from 'node:assert/strict';
import React from 'react';
import {act, create} from 'react-test-renderer';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const server = await createServer({server:{middlewareMode:true},appType:'custom'});
let view;
try {
  const {default:PropertyOwners} = await server.ssrLoadModule('/src/PropertyOwners.tsx');
  const {default:BankStatementImport} = await server.ssrLoadModule('/src/BankStatementImport.tsx');
  const {createPreviewApi} = await server.ssrLoadModule('/src/preview-api.ts');
  const snapshot = await createPreviewApi(true).read();
  const month = snapshot.months[0];
  let importedMonth;
  await act(async () => {
    view = create(React.createElement(PropertyOwners, {
      snapshot, monthId:month.id, onSave:async()=>{}, onDirtyChange:()=>{}, onOpenListing:()=>{},
      onBankImport:(targetMonth=month)=>{importedMonth=targetMonth;},
    }));
  });
  const button = view.root.findAllByType('button').find(node => node.children.includes('Import Bank Statement'));
  assert.ok(button);
  assert.equal(button.props.disabled, false);
  await act(async () => button.props.onClick({type:'click',currentTarget:{tagName:'BUTTON'}}));
  assert.equal(importedMonth, month, 'Clicking import must preserve the selected reporting month, not pass a mouse event');
  const html = renderToStaticMarkup(React.createElement(BankStatementImport, {
    snapshot, month:importedMonth, supported:true, onClose:()=>{}, onApply:async()=>{},
  }));
  assert.ok(html.includes('Import Bank Statement'));
  console.log('Owner import button opens the importer with the selected reporting month.');
} finally {
  if (view) await act(async()=>view.unmount());
  await server.close();
}
