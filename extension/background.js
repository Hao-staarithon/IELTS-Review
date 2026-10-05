importScripts('core.js');
const C=IeltsCore;
let queue=Promise.resolve();
let running=null;
function transaction(fn){const p=queue.then(async()=>{const got=await chrome.storage.local.get('desk');const state=got.desk||C.defaults();const result=await fn(state);state.revision++;await chrome.storage.local.set({desk:state});return result===undefined?state:result;});queue=p.catch(()=>{});return p;}
async function read(){await queue;return (await chrome.storage.local.get('desk')).desk||C.defaults();}
async function badge(text,color='#527563'){await chrome.action.setBadgeText({text});await chrome.action.setBadgeBackgroundColor({color});}
async function alarm(){const s=await read();await chrome.alarms.create('ielts-sync',{periodInMinutes:Number(s.settings.interval)||2});}
async function initialize(){await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});await transaction(s=>{if(s.settings.autoPlan)C.generatePlan(s,C.today());});await alarm();}
async function startSync(force=false){
  const state=await read();if(!state.settings.enabled){await badge('');return {ok:true,paused:true};}
  if(running && Date.now()-running.at<180000)return {ok:true,busy:true};
  if(state.sync.retryAfter && Date.now()<state.sync.retryAfter)return {ok:true,cooling:true};
  const tabs=await chrome.tabs.query({url:'https://chatgpt.com/*'});
  if(!tabs.length){await transaction(s=>{s.sync.status='waiting';s.sync.message='等待打开已登录的 ChatGPT 网页';});await badge('…','#a8854d');return {ok:false,error:'请打开一个已登录的 ChatGPT 网页'};}
  const run={id:C.id(),at:Date.now(),projectId:state.settings.projectId};
  running=run;
  await transaction(s=>{s.sync.status='syncing';s.sync.message='正在读取雅思项目';s.sync.lastAttempt=Date.now();});
  await badge('↻');
  const known=Object.fromEntries(Object.values(state.conversations).filter(c=>c.projectId===run.projectId).map(c=>[c.id,{updated:c.update_time,fetched:c.fetchedAt||0}]));
  for(const tab of tabs.sort((a,b)=>Number(b.active)-Number(a.active))){
    try{
      const res=await chrome.tabs.sendMessage(tab.id,{type:'run-sync',runId:run.id,projectId:run.projectId,known,force});
      if(res?.accepted)return {ok:true};
    }catch{}
  }
  running=null;
  await transaction(s=>{s.sync.status='error';s.sync.message='请刷新一个 ChatGPT 网页，让同步组件加载后再试';});await badge('!','#a56647');
  return {ok:false,error:'请刷新 ChatGPT 网页'};
}
function trustedApp(sender){return sender.id===chrome.runtime.id && (sender.url||'').startsWith(chrome.runtime.getURL(''));}
function trustedChat(sender){try{return sender.id===chrome.runtime.id&&new URL(sender.url).origin==='https://chatgpt.com';}catch{return false;}}
async function handle(msg,sender){
  if(trustedChat(sender)){
    if(msg.type==='page-ready'){const s=await read();if(!s.sync.lastAttempt||Date.now()-s.sync.lastAttempt>30000)await startSync();return {ok:true};}
    if(msg.type==='page-changed'){const s=await read();if(!s.sync.lastAttempt||Date.now()-s.sync.lastAttempt>45000)await startSync();return {ok:true};}
    if(!running || msg.runId!==running.id)return {ok:false,error:'本轮同步已结束'};
    if(msg.type==='sync-item')return transaction(s=>{
      if(s.settings.projectId!==running.projectId||!s.settings.enabled)throw Error('同步设置已改变');
      const c=C.normalizeConversation(msg.conversation,running.projectId);
      c.fetchedAt=Date.now();s.conversations[c.id]=c;C.rebuild(s);
      s.sync.message='已读取：'+c.title;
      return {ok:true};
    });
    if(msg.type==='sync-finish'){
      const run=running;running=null;
      await transaction(s=>{
        if(s.settings.projectId!==run.projectId)return;
        s.sync.status=msg.error?'error':msg.partial?'partial':'ok';
        s.sync.message=msg.error|| (msg.partial?'部分聊天等待下轮补齐':'已同步 '+msg.count+' 个项目聊天');
        s.sync.count=Number(msg.count)||0;
        // Membership is updated only after the complete project inventory succeeded.
        if(!msg.error && Array.isArray(msg.memberIds)){
          const members=new Set(msg.memberIds);
          for(const c of Object.values(s.conversations))if(c.projectId===run.projectId && !members.has(c.id))c.projectId='archived:'+run.projectId;
          C.rebuild(s);
        }
        if(!msg.error&&!msg.partial)s.sync.lastSuccess=Date.now();
        s.sync.retryAfter=msg.rateLimited?Date.now()+5*60000:0;
        if(s.settings.autoPlan)C.generatePlan(s,C.today(),{carry:true});
      });
      await badge(msg.error?'!':msg.partial?'…':'',msg.error?'#a56647':'#527563');return {ok:true};
    }
    throw Error('不支持的同步消息');
  }
  if(!trustedApp(sender))throw Error('消息来源无效');
  if(msg.type==='read'){await transaction(s=>{if(s.settings.autoPlan)C.generatePlan(s,C.today(),{carry:true});});return {ok:true,state:await read()};}
  if(msg.type==='sync')return startSync(true);
  if(msg.type==='save-settings'){
    await transaction(s=>{const next=C.validateSettings({...s.settings,...msg.settings});if(next.projectId!==s.settings.projectId){running=null;s.sync={status:'unconnected',message:'项目已切换，等待同步',lastSuccess:null};}s.settings=next;C.rebuild(s);});
    await alarm();await startSync();return {ok:true,state:await read()};
  }
  if(msg.type==='save-task')return transaction(s=>{const task=C.validateTask(msg.task), i=s.tasks.findIndex(x=>x.id===task.id);task.progressAt=Date.now();if(i>=0)s.tasks[i]=task;else s.tasks.push(task);return {ok:true,state:s};});
  if(msg.type==='task-progress')return transaction(s=>{const t=s.tasks.find(t=>t.id===msg.id);if(!t||!Number.isFinite(msg.done)||msg.done<0||msg.done>10000)throw Error('任务进度无效');t.done=msg.done;t.progressAt=Date.now();return {ok:true,state:s};});
  if(msg.type==='delete-task')return transaction(s=>{s.tasks=s.tasks.filter(x=>x.id!==msg.id);return {ok:true,state:s};});
  if(msg.type==='plan')return transaction(s=>{C.generatePlan(s,msg.date,{carry:true});return {ok:true,state:s};});
  if(msg.type==='save-score')return transaction(s=>{const score=C.validateScore(msg.score),i=s.scores.findIndex(x=>x.id===score.id);if(i>=0)s.scores[i]=score;else s.scores.push(score);return {ok:true,state:s};});
  if(msg.type==='delete-score')return transaction(s=>{s.scores=s.scores.filter(x=>x.id!==msg.id);if(!s.dismissed.includes(msg.id))s.dismissed.push(msg.id);return {ok:true,state:s};});
  if(msg.type==='save-review')return transaction(s=>{if(!C.validDate(msg.date))throw Error('日期无效');s.reviews[msg.date]={execution:String(msg.review.execution||'').slice(0,10000),learning:String(msg.review.learning||'').slice(0,10000),next:String(msg.review.next||'').slice(0,10000),updatedAt:Date.now()};return {ok:true,state:s};});
  if(msg.type==='dismiss')return transaction(s=>{if(!s.dismissed.includes(msg.id))s.dismissed.push(msg.id);return {ok:true,state:s};});
  if(msg.type==='restore'){const b=C.validateBackup(msg.backup);await transaction(s=>Object.assign(s,b));await alarm();return {ok:true,state:await read()};}
  throw Error('不支持的操作');
}
chrome.runtime.onMessage.addListener((msg,sender,send)=>{handle(msg,sender).then(send).catch(e=>send({ok:false,error:e.message}));return true;});
chrome.runtime.onInstalled.addListener(async info=>{await initialize();if(info.reason==='install')chrome.tabs.create({url:chrome.runtime.getURL('index.html#settings')});});
chrome.runtime.onStartup.addListener(async()=>{await initialize();await startSync();});
chrome.alarms.onAlarm.addListener(a=>{if(a.name==='ielts-sync')startSync().catch(()=>{});});
chrome.action.onClicked.addListener(async()=>{const url=chrome.runtime.getURL('index.html');const tabs=await chrome.tabs.query({});const tab=tabs.find(t=>t.url?.startsWith(url));if(tab){await chrome.tabs.update(tab.id,{active:true});await chrome.windows.update(tab.windowId,{focused:true});}else await chrome.tabs.create({url});});
