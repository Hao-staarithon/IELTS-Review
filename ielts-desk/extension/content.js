/* Read-only project synchronizer. Session credentials stay in this page's memory.
 * Endpoint research: XReyRobert/chatgpt-conversations-sync-chrome-extension and
 * thekester/chatgpt-export (MIT; notices bundled). No global chat inventory. */
(()=>{
  'use strict';
  let busy=false,lastSignature='',changeTimer;
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  async function getJson(path,token){
    const res=await fetch('https://chatgpt.com'+path,{credentials:'include',cache:'no-store',headers:{Accept:'application/json',...(token?{Authorization:'Bearer '+token}:{})},signal:AbortSignal.timeout(20000)});
    if(!res.ok){const e=Error(res.status===401?'ChatGPT 登录已失效，请在网页重新登录':res.status===403?'ChatGPT 暂时拒绝读取，请在网页检查登录或验证状态':res.status===429?'读取过于频繁，五分钟后自动重试':res.status===404?'没有找到这个项目，请检查项目链接，或网页接口已变化':'ChatGPT 读取失败（HTTP '+res.status+'）');e.status=res.status;throw e;}
    return res.json();
  }
  const stamp=v=>typeof v==='number'?(v<1e12?v*1000:v):(Date.parse(v)||0);
  async function run(config){
    busy=true;let count=0;
    try{
      const session=await getJson('/api/auth/session');
      if(!session.accessToken && !session.user)throw Error('请先在当前浏览器登录 ChatGPT');
      const token=session.accessToken||null;
      const items=new Map(),visited=new Set();let cursor='0',pages=0;
      do{
        if(visited.has(cursor)||pages++>=100)throw Error('项目列表分页异常，保留已有记录并停止本轮同步');
        visited.add(cursor);
        const data=await getJson('/backend-api/gizmos/'+encodeURIComponent(config.projectId)+'/conversations?cursor='+encodeURIComponent(cursor),token);
        const list=data.items||data.conversations;
        if(!Array.isArray(list))throw Error('项目列表格式已变化，需要更新同步组件');
        for(const raw of list){const item=raw.conversation||raw;const cid=item.conversation_id||item.id;if(typeof cid==='string')items.set(cid,item);}
        cursor=data.next_cursor??data.cursor??null;
        if(cursor===null||cursor==='')break;
        cursor=String(cursor);await wait(350);
      }while(true);
      count=items.size;let fetched=0,pending=0;
      for(const [cid,item] of items){
        const old=config.known[cid], updated=stamp(item.update_time);
        if(!config.force&&old&&(!updated||updated<=old.updated)&&Date.now()-old.fetched<30*60000)continue;
        if(fetched>=35){pending++;continue;}
        const conversation=await getJson('/backend-api/conversation/'+encodeURIComponent(cid),token);
        const pid=conversation.gizmo_id||conversation.project_id;
        if(pid && pid!==config.projectId)throw Error('项目归属与列表不一致，已停止本轮读取');
        conversation.id=cid;
        conversation.update_time=conversation.update_time||item.update_time;
        const reply=await chrome.runtime.sendMessage({type:'sync-item',runId:config.runId,conversation});
        if(!reply?.ok)throw Error(reply?.error||'无法保存同步结果');
        fetched++;await wait(400);
      }
      await chrome.runtime.sendMessage({type:'sync-finish',runId:config.runId,count,partial:pending>0,memberIds:[...items.keys()]});
    }catch(e){
      const error=e.name==='TimeoutError'?'读取超时，稍后自动重试':e.message||'同步中断';
      try{await chrome.runtime.sendMessage({type:'sync-finish',runId:config.runId,count,error,rateLimited:e.status===429});}catch{}
    }finally{busy=false;}
  }
  chrome.runtime.onMessage.addListener((msg,sender,send)=>{
    if(sender.id!==chrome.runtime.id||msg.type!=='run-sync')return;
    if(busy){send({accepted:false});return;}
    if(!/^g-p-[a-zA-Z0-9-]+$/.test(msg.projectId)){send({accepted:false});return;}
    run(msg);send({accepted:true});
  });
  chrome.runtime.sendMessage({type:'page-ready'}).catch(()=>{});
  // Quietly request a refresh once a visible answer settles. No messages are sent to ChatGPT.
  const observe=()=>{
    clearTimeout(changeTimer);
    changeTimer=setTimeout(()=>{
      const messages=document.querySelectorAll('[data-message-author-role]');
      const tail=messages[messages.length-1];
      const signature=location.pathname+'|'+messages.length+'|'+(tail?.textContent?.slice(-180)||'');
      if(signature!==lastSignature){lastSignature=signature;chrome.runtime.sendMessage({type:'page-changed'}).catch(()=>{});}
    },12000);
  };
  if(document.body)new MutationObserver(observe).observe(document.body,{childList:true,subtree:true,characterData:true});
})();
