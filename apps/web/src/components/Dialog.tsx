import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
export function Drawer({title,description,open,onClose,children}:{
 title:string;description:string;open:boolean;onClose:()=>void;children:ReactNode;
}) {
 const previousFocus=useRef<HTMLElement|null>(null);
 return <Dialog.Root open={open} onOpenChange={value=>{if(!value)onClose();}}>
  <Dialog.Portal><Dialog.Overlay className="dialog-backdrop"/>
   <Dialog.Content className="drawer" onOpenAutoFocus={()=>{
    previousFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
   }} onCloseAutoFocus={event=>{
    if(previousFocus.current?.isConnected){event.preventDefault();previousFocus.current.focus();}
   }}>
    <div className="drawer-heading"><div><p className="eyebrow">YOUR EVENT STUDIO</p><Dialog.Title>{title}</Dialog.Title></div>
     <Dialog.Close className="icon-button" aria-label="Close panel"><X size={20}/></Dialog.Close></div>
    <Dialog.Description className="muted drawer-description">{description}</Dialog.Description>{children}
   </Dialog.Content>
  </Dialog.Portal>
 </Dialog.Root>;
}
