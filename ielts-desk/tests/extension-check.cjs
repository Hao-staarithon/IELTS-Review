const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/AHS/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const ext=path.resolve(__dirname,'../extension'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'ielts-extension-test-'));
(async()=>{
  const context=await chromium.launchPersistentContext(profile,{channel:'msedge',headless:true,viewport:{width:1440,height:1000},args:['--disable-extensions-except='+ext,'--load-extension='+ext]});
  try{
    let worker=context.serviceWorkers()[0];if(!worker)worker=await context.waitForEvent('serviceworker',{timeout:15000});
    const extensionId=new URL(worker.url()).host;
    let version=1,deny=false;
    const project='g-p-6ab944f4ba4c8191b4ff4e1357edabce',now=Date.now();
    await context.route('https://chatgpt.com/**',async route=>{
      const p=new URL(route.request().url()).pathname;let data;
      if(p==='/api/auth/session')data={accessToken:'LOCAL-TEST-TOKEN',user:{}};
      else if(p==='/backend-api/gizmos/'+project+'/conversations'){if(deny)return route.fulfill({status:403,body:'denied'});data={items:[{id:'test-conversation',update_time:now+version*1000}],cursor:null};}
      else if(p==='/backend-api/conversation/test-conversation')data={id:'test-conversation',gizmo_id:project,title:'本地模拟聊天',update_time:now+version*1000,current_node:'m2',mapping:{m1:{id:'m1',parent:null,message:{id:'m1',author:{role:'user'},create_time:now/1000,content:{parts:[version===1?'今天背了150个单词':'今天背了180个单词']}}},m2:{id:'m2',parent:'m1',message:{id:'m2',author:{role:'user'},create_time:now/1000,content:{parts:['首次限时完成，剑雅19 Test1 阅读28/40']}}}}};
      else return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html><body><main>Local mock of the ChatGPT origin. No real account.</main></body></html>'});
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    });
    const chat=await context.newPage();await chat.goto('https://chatgpt.com/');
    const app=await context.newPage();await app.goto('chrome-extension://'+extensionId+'/index.html');
    await app.waitForFunction(()=>document.querySelector('#sync-text').textContent.startsWith('已同步'),null,{timeout:25000});
    assert.equal(await app.locator('[data-progress]').last().inputValue(),'150');
    await app.locator('[data-nav="scores"]').click();assert.match(await app.locator('tbody').innerText(),/28 \/ 40/);
    version=2;await app.evaluate(()=>chrome.runtime.sendMessage({type:'sync'}));
    await app.waitForFunction(async()=>Object.values((await chrome.storage.local.get('desk')).desk.conversations)[0].messages[0].content.includes('180'));
    await app.locator('[data-nav="today"]').click();assert.equal(await app.locator('[data-progress]').last().inputValue(),'180');
    const s=await app.evaluate(async()=>(await chrome.storage.local.get('desk')).desk);assert.equal(Object.keys(s.conversations).length,1);assert.equal(s.facts.filter(f=>f.kind==='score').length,1);assert.equal(JSON.stringify(s).includes('LOCAL-TEST-TOKEN'),false);
    deny=true;await app.evaluate(()=>chrome.runtime.sendMessage({type:'sync'}));await app.waitForFunction(()=>document.querySelector('#sync-text').textContent==='同步需处理');
    assert.equal(await app.locator('[data-progress]').last().inputValue(),'180');
    console.log('PASS: real Edge MV3 worker + content script + app storage, automatic selected-project sync, correction, deduplication, token not persisted, 403 preserves records.');
  }finally{await context.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
