import type {Property} from './types.ts';
import {systemStatus} from './domain.ts';
export type SystemCheckFilter='all'|'Matched'|'Mismatch'|'Pending';
export type DaisyCheckFilter='all'|'verified'|'pending';
export function reconciliationRows(properties:Property[],system:SystemCheckFilter,daisy:DaisyCheckFilter){
 return properties.flatMap(property=>property.payments.map((payment,index)=>({property,payment,index}))).filter(({payment})=>(system==='all'||systemStatus(payment)===system)&&(daisy==='all'||payment.verifiedByDaisy===(daisy==='verified')));
}
