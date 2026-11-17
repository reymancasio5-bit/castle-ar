export type BackgroundPanel={id:string;title:string;busy:boolean;open:()=>void};
let panels:BackgroundPanel[]=[];
const listeners=new Set<()=>void>();
export const getBackgroundPanels=()=>panels;
export function openBackgroundPanel(title:string){panels.find(panel=>panel.title===title)?.open();}
export function subscribeBackgroundPanels(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
export function updateBackgroundPanel(panel:BackgroundPanel){panels=[...panels.filter(p=>p.id!==panel.id),panel];for(const listener of listeners)listener();}
export function removeBackgroundPanel(id:string){if(!panels.some(p=>p.id===id))return;panels=panels.filter(p=>p.id!==id);for(const listener of listeners)listener();}
