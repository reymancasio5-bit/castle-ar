import type {AccountManager} from './types.ts';
export default function ManagerSelect({managers,value,onChange,currentValue='',disabled=false,required=false,label="Account Manager"}:{managers:AccountManager[];value:string;onChange:(value:string)=>void;currentValue?:string;disabled?:boolean;required?:boolean;label?:string}){
 const options=managers.filter(m=>m.active||m.name===currentValue).sort((a,b)=>a.name.localeCompare(b.name));
 return <select aria-label={label} value={value} onChange={event=>onChange(event.target.value)} disabled={disabled} required={required}>
  <option value="">{required?'Select an account manager':'Unassigned'}</option>
  {value&&!options.some(m=>m.name===value)&&<option value={value} disabled>{value} — select a registered manager</option>}
  {options.map(m=><option key={m.id} value={m.name}>{m.name}{m.active?'':' (inactive)'}</option>)}
 </select>;
}
