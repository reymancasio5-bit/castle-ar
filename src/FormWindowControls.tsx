import {Minus,X} from 'lucide-react';
import './form-window-controls.css';

export default function FormWindowControls({onMinimize,onClose,closeDisabled=false}:{onMinimize?:()=>void;onClose:()=>void;closeDisabled?:boolean}){
 return <div className="form-window-controls" role="group" aria-label="Form Window Controls">
  {onMinimize&&<button type="button" className="form-window-button" onClick={onMinimize} aria-label="Minimize Form" title="Minimize Form"><Minus size={18} aria-hidden="true"/></button>}
  <button type="button" className="form-window-button" onClick={onClose} disabled={closeDisabled} aria-label="Close Form" title="Close Form"><X size={18} aria-hidden="true"/></button>
 </div>;
}
