import type {StatusFilter,View} from './preferences.ts';
export interface WorkspaceLocation {view:View;monthId:string;search:string;manager:string;status:StatusFilter}
export interface ManagerLocation {selectedId:string;search:string;tab:'listings'|'tasks'|'updates';allMonths:boolean;taskFilter:'open'|'overdue'|'completed'|'all'}
type StorageLike=Pick<Storage,'getItem'|'setItem'>;
function storage():StorageLike|undefined{try{return typeof window==='undefined'?undefined:window.sessionStorage;}catch{return undefined;}}
function read(key:string,target=storage()):Record<string,unknown>{try{const value=JSON.parse(target?.getItem(key)??'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch{return {};}}
function write(key:string,value:unknown,target=storage()){try{target?.setItem(key,JSON.stringify(value));}catch{/* Navigation still works if storage is blocked. */}}
const text=(value:unknown,fallback:string)=>typeof value==='string'&&value.length<=500?value:fallback;
const choice=<T extends string>(value:unknown,choices:readonly T[],fallback:T):T=>typeof value==='string'&&choices.includes(value as T)?value as T:fallback;
export function loadWorkspaceLocation(defaults:WorkspaceLocation,query='',target=storage()):WorkspaceLocation{
 const saved=read('castle-workspace-location-v1',target);
 const views:View[]=['overview','properties','reconciliation','bundles','managers'];
 return {view:choice(new URLSearchParams(query).get('view'),views,choice(saved.view,views,defaults.view)),monthId:text(saved.monthId,defaults.monthId),search:text(saved.search,defaults.search),manager:text(saved.manager,defaults.manager),status:choice(saved.status,['all','outstanding','paid','unverified'],defaults.status)};
}
export const saveWorkspaceLocation=(value:WorkspaceLocation,target=storage())=>write('castle-workspace-location-v1',value,target);
export function loadManagerLocation(target=storage()):ManagerLocation{
 const s=read('castle-manager-location-v1',target);
 return {selectedId:text(s.selectedId,''),search:text(s.search,''),tab:choice(s.tab,['listings','tasks','updates'],'listings'),allMonths:s.allMonths===true,taskFilter:choice(s.taskFilter,['open','overdue','completed','all'],'open')};
}
export const saveManagerLocation=(value:ManagerLocation,target=storage())=>write('castle-manager-location-v1',value,target);
