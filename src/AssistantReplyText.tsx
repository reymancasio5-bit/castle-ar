import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {markdownHtml} from './assistant-content';

/** Visual reveal of an already received response, not simulated network streaming. */
export default function AssistantReplyText({text}:{text:string}) {
 const [visible,setVisible]=useState(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches?text.length:0);
 const container=useRef<HTMLDivElement>(null),lastHeight=useRef(0);
 const finished=useRef(false);
 const complete=visible>=text.length;
 useEffect(()=>{
  const preference=window.matchMedia('(prefers-reduced-motion: reduce)');
  let timer:number|undefined;
  finished.current=false;
  const finish=()=>{finished.current=true;if(timer!==undefined)window.clearInterval(timer);setVisible(text.length);};
  if(preference.matches){finish();return;}
  const start=performance.now(),duration=Math.min(6500,Math.max(450,text.length*8));
  timer=window.setInterval(()=>{
   if(finished.current){if(timer!==undefined)window.clearInterval(timer);return;}
   const fraction=Math.min(1,(performance.now()-start)/duration);
   let end=Math.floor(text.length*fraction);
   // Keep Unicode characters intact; long replies reveal in small groups of words.
   if(end>0&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;
   setVisible(end);
   if(fraction===1)finish();
  },32);
  const onPreference=()=>{if(preference.matches)finish();};
  preference.addEventListener('change',onPreference);
  return ()=>{if(timer!==undefined)window.clearInterval(timer);preference.removeEventListener('change',onPreference);};
 },[text]);
 useLayoutEffect(()=>{
  const body=container.current?.closest('.assistant-body');
  if(body){if(body.scrollTop+body.clientHeight>=lastHeight.current-64)body.scrollTop=body.scrollHeight;lastHeight.current=body.scrollHeight;}
 },[visible]);
 return <div ref={container} className="assistant-reply-text">
  <div aria-hidden={!complete} className="assistant-rich-text" dangerouslySetInnerHTML={{__html:markdownHtml(text.slice(0,visible))}}/>
  {!complete&&<><span className="sr-only">{text}</span><span className="assistant-reveal-cursor" aria-hidden="true"/><button className="assistant-show-full" onClick={()=>{finished.current=true;setVisible(text.length);}}>Show full reply</button></>}
 </div>;
}
