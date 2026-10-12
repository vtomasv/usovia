const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('usovia',{
  invoke:(action,input)=>ipcRenderer.invoke('usovia:action',{action,input}),
  onPage:callback=>{const listener=(_event,page)=>callback(page);ipcRenderer.on('usovia:page',listener);return ()=>ipcRenderer.removeListener('usovia:page',listener);},
  onState:callback=>{const listener=(_event,state)=>callback(state);ipcRenderer.on('usovia:state',listener);return ()=>ipcRenderer.removeListener('usovia:state',listener);}
});
