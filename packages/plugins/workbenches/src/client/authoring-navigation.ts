export type AuthoringEntry = {readonly revision:number;readonly view:'create'|'developments';readonly developmentId?:string;readonly creationId?:string};
/** Explicit entry intent survives the manager -> native frame navigation. */
export function createAuthoringNavigation(){
 let snapshot:AuthoringEntry={revision:0,view:'developments'};
 const listeners=new Set<()=>void>();
 return {getSnapshot:()=>snapshot,subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},open(view:AuthoringEntry['view'],target?:{developmentId?:string;creationId?:string}){snapshot={revision:snapshot.revision+1,view,...target};for(const listener of listeners)listener();}};
}
