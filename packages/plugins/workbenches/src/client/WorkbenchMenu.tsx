import React,{useState}from'react';
import{Menu,type MenuEntry}from'@deepseek-ai/dsh-client-ui-primitives';
/** Use the published native menu's portal, placement and keyboard handling. */
export function WorkbenchMenu({label,children,items,onSelect}:{label:string;children:React.ReactNode;items:readonly MenuEntry[];onSelect:(id:string)=>void}){
 const[open,setOpen]=useState(false);
 return <Menu open={open} portal align="end" autoFocus items={items} onClose={()=>setOpen(false)} onSelect={id=>{setOpen(false);onSelect(id);}} className="wd-native-menu" anchor={<button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{children}</button>}/>;
}
