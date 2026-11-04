import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
writeFileSync('public/Code.gs', readFileSync('apps-script/Code.gs','utf8')+'\n'+readFileSync('apps-script/Assistant.gs','utf8'));
copyFileSync('apps-script/appsscript.json','public/appsscript.json');
