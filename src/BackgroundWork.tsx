import {useCallback,useEffect,useId,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {removeBackgroundPanel,updateBackgroundPanel} from './background-panels.ts';

/** A minimized form stays mounted until its owner explicitly closes it. */
export function useBackgroundForm(title:string,busy:boolean){
 const id=useId();const [minimized,setMinimized]=useState(false);
 const previousBusy=useRef(false);
 const restore=useCallback(()=>setMinimized(false),[]);
 const minimize=useCallback(()=>setMinimized(true),[]);
 useEffect(()=>{
  if(busy&&!previousBusy.current)setMinimized(true);
  previousBusy.current=busy;
 },[busy]);
 useEffect(()=>{
  if(minimized)updateBackgroundPanel({id,title,busy,open:restore});else removeBackgroundPanel(id);
  return()=>removeBackgroundPanel(id);
 },[id,title,busy,minimized,restore]);
 return {minimized,minimize,restore};
}

/** Retain committed view trees, including their drafts and async callbacks. */
export function RetainedWorkspace({activeKey,children,retainKeys}:{activeKey:string;children:ReactNode;retainKeys?:string[]}){
 const [views,setViews]=useState<Record<string,ReactNode>>({});
 const retention=retainKeys?.join('|');
 useLayoutEffect(()=>{setViews(current=>{
  const next=Object.fromEntries(Object.entries(current).filter(([key])=>retainKeys===undefined||retainKeys.includes(key)));
  return {...next,[activeKey]:children};
 });},[activeKey,children,retention]);
 const keys=[...new Set([...Object.keys(views).filter(key=>retainKeys===undefined||retainKeys.includes(key)),activeKey])];
 return <>{keys.map(key=><div key={key} hidden={key!==activeKey} inert={key!==activeKey}>{key===activeKey?children:views[key]}</div>)}</>;
}
