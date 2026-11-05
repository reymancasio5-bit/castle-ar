import test from 'node:test';
import assert from 'node:assert/strict';
import {markdownHtml,reportRows} from '../src/assistant-content.ts';
test('model Markdown formats headings, lists, emphasis and tables',()=>{
 const result=markdownHtml('# Summary\n\n**Received** is $10.\n\n- Check bank\n- Review Daisy\n\n| Property | Amount |\n| --- | ---: |\n| Castle | $10 |');
 for(const tag of ['<h2>','<strong>Received</strong>','<ul>','<table>','<td>Castle</td>'])assert.ok(result.includes(tag),tag);
});
test('model text cannot introduce executable HTML or unsafe links in chat or reports',()=>{
 const hostile='<script>alert(1)</script>\n\n<img src=x onerror=alert(1)> [click](javascript:alert(1))';
 const result=markdownHtml(hostile);
 assert.ok(!result.includes('<script>'));assert.ok(!result.includes('<img'));assert.ok(!result.includes('href="javascript:'));assert.ok(result.includes('&lt;script&gt;'));
});
