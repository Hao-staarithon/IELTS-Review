/* Local study logic. No network calls, secrets or remote model requests. */
(function (root) {
  'use strict';
  const today = (v = Date.now()) => new Date(typeof v === 'number' ? v : Date.parse(v)).toLocaleDateString('en-CA', {timeZone:'Asia/Shanghai'});
  const addDays = (date, n) => today(Date.parse(date + 'T12:00:00+08:00') + n * 86400000);
  const id = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  const validDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)) && today(s+'T12:00:00+08:00') === s;
  const num = (v, min, max) => Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max;
  const stamp = v => {if(typeof v === 'number') return v < 1e12 ? v * 1000 : v; const p=Date.parse(v); return Number.isFinite(p)?p:0;};
  const defaults = () => ({schema:1, settings:{projectId:'g-p-6ab944f4ba4c8191b4ff4e1357edabce', projectName:'雅思', enabled:true, interval:2, examDate:'2026-10-21', readingType:'academic', targetReading:6.5, words:300, reading:1, listening:1, news:20, autoPlan:true}, tasks:[], scores:[], reviews:{}, conversations:{}, facts:[], dismissed:[], progressOverrides:{}, sync:{status:'unconnected',message:'等待连接 ChatGPT 网页',lastSuccess:null, lastAttempt:null, count:0}, revision:0});
  function validateSettings(v) {
    if (!/^g-p-[a-zA-Z0-9-]+$/.test(v.projectId || '')) throw Error('请输入正确的 ChatGPT 项目 ID（以 g-p- 开头）');
    if (!validDate(v.examDate)) throw Error('考试日期无效');
    if (!['academic','general'].includes(v.readingType)) throw Error('阅读类别无效');
    for (const [key,min,max] of [['interval',1,30],['words',0,3000],['reading',0,6],['listening',0,6],['news',0,120],['targetReading',0,9]]) if (!num(v[key],min,max)) throw Error('请检查计划数量或同步间隔');
    return {...v, projectName:String(v.projectName||'雅思').slice(0,80), enabled:!!v.enabled, autoPlan:!!v.autoPlan};
  }
  function validateTask(t) {
    if (!String(t.title||'').trim() || !validDate(t.date) || !num(t.target,1,10000) || !num(t.done,0,10000)) throw Error('请填写任务名称、有效日期和数量');
    return {...t, id:t.id||id(), title:String(t.title).slice(0,140), unit:String(t.unit||'项').slice(0,12), slot:['上午','下午','晚上','随时'].includes(t.slot)?t.slot:'随时', target:Number(t.target),done:Number(t.done),updatedAt:Date.now()};
  }
  function validateScore(s) {
    if (!validDate(s.date)) throw Error('成绩日期无效');
    if (!['listening','academic','general','writing','speaking'].includes(s.skill)) throw Error('科目无效');
    if (s.minutes!=='' && s.minutes!=null && !num(s.minutes,0,600)) throw Error('用时需在 0—600 分钟之间');
    if (['writing','speaking'].includes(s.skill)) {if(s.band===''||s.band==null||!num(s.band,0,9)||Number(s.band)*2%1!==0) throw Error('分数需为 0—9，支持 0.5 分');}
    else {
      if(s.correct===''||s.correct==null||!num(s.total,1,40)||!Number.isInteger(Number(s.total))||!num(s.correct,0,Number(s.total))||!Number.isInteger(Number(s.correct))) throw Error('请填写正确题数，必须为整数且不能超过题目总数');
      if(s.mode==='full' && Number(s.total)!==40) throw Error('整套听力／阅读必须为 40 题');
      if(s.parts && s.parts.length) {
        if(s.parts.some(x=>!Number.isInteger(Number(x))||Number(x)<0)) throw Error('各部分正确数必须为非负整数');
        if(s.skill==='listening' && (s.parts.length!==4||s.parts.some(x=>x>10))) throw Error('听力需填写四部分，每部分 0—10 题');
        if(s.skill!=='listening' && s.parts.length!==3) throw Error('阅读需填写三篇的正确数');
        if(s.parts.reduce((a,b)=>a+Number(b),0)!==Number(s.correct)) throw Error('各部分正确数之和与总正确数不一致');
      }
    }
    return {...s,id:s.id||id(),book:String(s.book||'未注明套题').slice(0,80),test:String(s.test||'').slice(0,40),correct:Number(s.correct)||0,total:Number(s.total)||40,band:s.band===''?null:Number(s.band),minutes:s.minutes===''?null:Number(s.minutes),note:String(s.note||'').slice(0,2000),updatedAt:Date.now()};
  }
  // Indicative conversion. Official cutoffs can differ by test version.
  const tables = {
    listening:[[39,9],[37,8.5],[35,8],[32,7.5],[30,7],[26,6.5],[23,6],[18,5.5],[16,5],[13,4.5],[10,4]],
    academic:[[39,9],[37,8.5],[35,8],[33,7.5],[30,7],[27,6.5],[23,6],[19,5.5],[15,5],[13,4.5],[10,4]],
    general:[[40,9],[39,8.5],[37,8],[36,7.5],[34,7],[32,6.5],[30,6],[27,5.5],[23,5],[19,4.5],[15,4]]
  };
  const band = s => ['writing','speaking'].includes(s.skill) ? (s.band==null?null:Number(s.band)) : s.mode==='full' && Number(s.total)===40 ? (tables[s.skill]?.find(x=>Number(s.correct)>=x[0])?.[1]??null) : null;
  function estimate(scores, skill) {
    const seen = new Set();
    const all=scores.filter(s=>s.skill===skill && s.mode==='full' && s.first===true && s.timed===true && !s.assisted && band(s)!==null).sort((a,b)=>b.date.localeCompare(a.date)||b.updatedAt-a.updatedAt);
    const qualified=all.filter(s=>{const key=s.book && s.book!=='未注明套题'?s.book.toLowerCase().replace(/\s/g,'')+'/'+s.test+'/'+s.skill:s.id;if(seen.has(key))return false;seen.add(key);return true;}).slice(0,5);
    const vals=qualified.map(band).sort((a,b)=>a-b), n=vals.length;
    return {n,median:n? (n%2?vals[(n-1)/2]:(vals[n/2-1]+vals[n/2])/2):null, min:n?vals[0]:null,max:n?vals[n-1]:null,rows:qualified};
  }
  function overallEstimate(records,readingType){
    const l=estimate(records,'listening'),r=estimate(records,readingType);
    const latest=skill=>records.filter(s=>s.skill===skill&&band(s)!==null).sort((a,b)=>b.date.localeCompare(a.date)||b.updatedAt-a.updatedAt)[0];
    const w=latest('writing'),p=latest('speaking');
    const values=[l.median,r.median,w?band(w):null,p?band(p):null];
    return {band:values.every(x=>x!==null)?Math.round(values.reduce((a,b)=>a+b,0)/4*2)/2:null,writing:w,speaking:p,values};
  }
  function extractMessages(conv) {
    if (Array.isArray(conv.messages)) return conv.messages.filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string').map((m,i)=>({id:String(m.id||'message-'+i),role:m.role,content:m.content,create_time:stamp(m.create_time)}));
    const nodes=[], seen=new Set(), mapping=conv.mapping||{};let cur=conv.current_node;
    while(cur && mapping[cur] && !seen.has(cur)){seen.add(cur);nodes.push(mapping[cur]);cur=mapping[cur].parent;}
    return nodes.reverse().flatMap(n=>{
      const m=n.message;if(!m || !['user','assistant'].includes(m.author?.role) || m.metadata?.is_visually_hidden_from_conversation || (m.channel && !['final','commentary'].includes(m.channel)))return [];
      const text=(m.content?.parts||[m.content?.text||'']).filter(p=>typeof p==='string').join('\n').trim();
      return text?[{id:m.id||n.id,role:m.author.role,content:text,create_time:stamp(m.create_time)}]:[];
    });
  }
  function normalizeConversation(raw, projectId) {
    const cid=raw.id||raw.conversation_id;if(!cid||typeof cid!=='string')throw Error('聊天缺少 ID');
    return {id:cid,title:String(raw.title||'未命名聊天'),projectId,update_time:stamp(raw.update_time),messages:extractMessages(raw),url:'https://chatgpt.com/c/'+encodeURIComponent(cid)};
  }
  function rebuild(state) {
    const facts=[];
    for(const conv of Object.values(state.conversations)) {
      if(conv.projectId!==state.settings.projectId)continue;
      for(const m of conv.messages) {
        if(!m.create_time)continue;
        const base={conversationId:conv.id,messageId:m.id,date:today(m.create_time),at:m.create_time,title:conv.title,url:conv.url,role:m.role};
        const full=m.content||'';
        if(m.role==='assistant') {
          if(/复盘|错题|定位|同义替换|易混|区别|听力|阅读|安排|时间表/.test(conv.title+' '+full))facts.push({...base,id:conv.id+':'+m.id+':advice',kind:'advice',text:full.slice(0,12000)});
          continue;
        }
        if(full.length>3500 || /以下是|背景总结|下面这段|示例|比如|假设|如果|假如|```/.test(full)) {facts.push({...base,id:conv.id+':'+m.id+':note',kind:'note',text:full.slice(0,12000)});continue;}
        // Keep unknown statements as source notes. Never treat a plan as completion.
        facts.push({...base,id:conv.id+':'+m.id+':note',kind:/没做完|走神|卡住|来不及|休息|拖延|太多|没听|没做|错了|不懂|为什么/.test(full)?'problem':'note',text:full});
        let clauseNo=0;
        for(const line of full.split(/[。！!\n；;，,]/).filter(Boolean)){
          const fid=conv.id+':'+m.id+':'+clauseNo++;
          if(/明天|后天|昨天|昨日|上周|上次|前天|计划|准备|打算|目标|应该|需要|要背|想背|想复习|想听|要复习|要听|建议|安排|能不能|可不可以|没有|没背|没复习|没听|未背|未复习|未听|[?？]/.test(line))continue;
          const vocabulary=/(?:今天|今日|刚刚|现在|已经|一共|总共|我|又|再|刚|才|只|累计|目前)*\s*(?:背(?:完|了)?|复习(?:了|完)?)(?:单词|词汇)?\s*(?:了|到|完|才|只有|总共|一共)?\s*(\d{1,4})\s*(?:个|词)/.exec(line) || /(?:单词|词汇).{0,8}(?:完成|背了|复习了|做到|背到|才)\s*(\d{1,4})\s*(?:个|词)/.exec(line);
          if(vocabulary && !/没背|没复习|未完成|还差|剩下/.test(line))facts.push({...base,id:fid+':words',kind:'words',amount:Number(vocabulary[1]),delta:/又|再背|另外/.test(line),text:line.trim()});
          const news=/(?:新闻).{0,8}(?:听了|听完|完成)\s*(\d{1,3})\s*(?:分钟|min)/i.exec(line)||/(?:听了|听完)\s*(\d{1,3})\s*(?:分钟|min).{0,4}新闻/i.exec(line);
          if(news) facts.push({...base,id:fid+':news',kind:'news',amount:Number(news[1]),delta:/又|另外/.test(line),text:line.trim()});
        }
        // A raw score alone is recorded but remains ineligible for a forecast until conditions are known.
        if(!/明天|后天|计划|目标|假如|如果|能不能/.test(full)) {
          const match=/(听力|阅读)\s*(?:考了|做了|得了|是|成绩|正确|对了|答对|总共|一共|：|:|\s)*\s*(\d{1,2})\s*(?:\/|／)\s*40/.exec(full);
          if(match && Number(match[2])<=40) {
            const book=/(?:剑雅|剑桥|剑|Cambridge\s*)(\d{1,2})/i.exec(full), test=/(?:test|测试)\s*(\d)/i.exec(full);
            facts.push({...base,id:conv.id+':'+m.id+':score',kind:'score',skill:match[1]==='听力'?'listening':state.settings.readingType,correct:Number(match[2]),total:40,mode:'full',book:book?'剑雅 '+book[1]:'未注明套题',test:test?'Test '+test[1]:'',first:/第一次|首次|首做/.test(full)?true:/重做|二刷|再做/.test(full)?false:null,timed:/不限时|没计时|未计时|超时/.test(full)?false:/限时|计时/.test(full)?true:null,assisted:/查词|查字典|看答案/.test(full),note:full,source:'sync',updatedAt:m.create_time});
          }
        }
      }
    }
    state.facts=facts.sort((a,b)=>a.at-b.at);
    return state;
  }
  function scores(state) {
    const manualIds=new Set(state.scores.map(x=>x.id));
    return [...state.scores,...state.facts.filter(x=>x.kind==='score'&&!manualIds.has(x.id)&&!state.dismissed.includes(x.id))];
  }
  function taskProgress(state,t) {
    const primary=state.tasks.find(x=>x.date===t.date&&x.kind===t.kind);
    if(primary && primary.id!==t.id)return Number(t.done)||0;
    const relevant=state.facts.filter(f=>f.date===t.date&&f.kind===t.kind&&!state.dismissed.includes(f.id)).sort((a,b)=>a.at-b.at);
    if(!relevant.length)return Number(t.done)||0;
    const manualAt=t.progressAt||0;
    let actual=0;
    for(const f of relevant)actual=f.delta?actual+f.amount:f.amount;
    return manualAt>relevant.at(-1).at?Number(t.done)||0:actual;
  }
  function generatePlan(state,date,{carry=false}={}) {
    if(!validDate(date))throw Error('计划日期无效');
    if(state.tasks.some(t=>t.date===date)) return false;
    const s=state.settings;
    const specs=[['words','词汇复习',s.words,'个','随时'],['reading','阅读做题',s.reading,'篇','上午'],['reading-review','阅读复盘',s.reading,'篇','上午'],['listening','听力训练',s.listening,'组','下午'],['news','新闻听力',s.news,'分钟','晚上']];
    const previous=state.tasks.filter(t=>t.date===addDays(date,-1));
    for (const [kind,title,quantity,unit,slot] of specs){
      if(!Number(quantity))continue;
      let target=Number(quantity), note='建议量，可按实际情况调整';
      const old=previous.find(t=>t.kind===kind);
      if(carry&&old) {const left=Math.max(0,old.target-taskProgress(state,old));if(left){note='优先完成昨日剩余 '+left+unit+'；已包含在今日目标内';target=Math.max(target,left);}}
      state.tasks.push({id:id(),date,kind,title,target,unit,slot,done:0,source:'template',note,updatedAt:Date.now()});
    }
    return true;
  }
  function completion(state,date){const list=state.tasks.filter(x=>x.date===date);return {count:list.length,finished:list.filter(t=>taskProgress(state,t)>=t.target).length,percent:list.length?Math.round(list.reduce((sum,t)=>sum+Math.min(1,taskProgress(state,t)/t.target),0)/list.length*100):0};}
  function dailySummary(state,date) {
    const tasks=state.tasks.filter(t=>t.date===date), facts=state.facts.filter(f=>f.date===date&&!state.dismissed.includes(f.id));
    return {tasks,completion:completion(state,date),facts,problems:facts.filter(x=>x.kind==='problem'),advice:facts.filter(x=>x.kind==='advice'),notes:facts.filter(x=>x.kind==='note'),scores:scores(state).filter(x=>x.date===date),manual:state.reviews[date]||{execution:'',learning:'',next:''}};
  }
  function validateBackup(b){
    if(!b||b.schema!==1||!Array.isArray(b.tasks)||!Array.isArray(b.scores)||!b.conversations||typeof b.conversations!=='object'||!b.settings)throw Error('这不是有效的雅思复盘台备份');
    const restored={...defaults(),settings:validateSettings(b.settings),tasks:b.tasks.map(t=>({...validateTask(t),updatedAt:t.updatedAt})),scores:b.scores.map(s=>({...validateScore(s),updatedAt:s.updatedAt})),reviews:b.reviews&&typeof b.reviews==='object'?b.reviews:{},dismissed:Array.isArray(b.dismissed)?b.dismissed.filter(x=>typeof x==='string'):[],conversations:{}};
    for(const raw of Object.values(b.conversations)){const conv=normalizeConversation(raw,String(raw.projectId||''));conv.fetchedAt=0;restored.conversations[conv.id]=conv;}
    restored.sync.message='备份已导入，等待下次同步';return rebuild(restored);
  }
  root.IeltsCore={today,addDays,id,validDate,stamp,defaults,validateSettings,validateTask,validateScore,band,estimate,overallEstimate,extractMessages,normalizeConversation,rebuild,scores,taskProgress,generatePlan,completion,dailySummary,validateBackup};
  if(typeof module!=='undefined')module.exports=root.IeltsCore;
})(globalThis);
