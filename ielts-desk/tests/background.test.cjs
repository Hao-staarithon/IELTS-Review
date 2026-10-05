const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),C=require('../extension/core.js');
test('Background worker serializes writes, enforces message origin and preserves data on failed sync',async()=>{
  let desk=C.defaults(),listener,syncRequest;const listeners={};
  const event=name=>({addListener:f=>listeners[name]=f});
  const chrome={runtime:{id:'desk',getURL:p=>'chrome-extension://desk/'+p,onMessage:{addListener:f=>listener=f},onInstalled:event('install'),onStartup:event('startup')},storage:{local:{get:async()=>({desk:structuredClone(desk)}),set:async v=>{desk=structuredClone(v.desk);},setAccessLevel:async()=>{}}},tabs:{query:async()=>[{id:1,active:true}],sendMessage:async(id,m)=>{syncRequest=m;return {accepted:true};},create:async()=>{}},alarms:{create:async()=>{},onAlarm:event('alarm')},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{},onClicked:event('action')}};
  const context={chrome,IeltsCore:C,importScripts:()=>{},console,Promise,Date,Error,Number,Object,Array,Set,URL};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension/background.js'),'utf8'),context);
  const app={id:'desk',url:'chrome-extension://desk/index.html'},chat={id:'desk',url:'https://chatgpt.com/c/test'};
  const send=(msg,sender=app)=>new Promise(resolve=>listener(msg,sender,resolve));
  assert.equal((await send({type:'read'},{id:'other',url:'https://evil.example'})).ok,false);
  const loaded=await send({type:'read'});assert.equal(loaded.state.tasks.length,5);
  const [a,b]=desk.tasks;
  await Promise.all([send({type:'task-progress',id:a.id,done:100}),send({type:'task-progress',id:b.id,done:1})]);assert.equal(desk.tasks.find(t=>t.id===a.id).done,100);assert.equal(desk.tasks.find(t=>t.id===b.id).done,1);
  await send({type:'sync'});assert.equal(desk.sync.status,'syncing');assert.ok(syncRequest.runId);
  const conv={id:'c',title:'test',messages:[{id:'m',role:'user',content:'今天背了150个单词',create_time:Date.now()}]};
  assert.equal((await send({type:'sync-item',runId:syncRequest.runId,conversation:conv},chat)).ok,true);
  await send({type:'sync-finish',runId:syncRequest.runId,error:'403',count:1},chat);assert.equal(desk.sync.status,'error');assert.equal(Object.keys(desk.conversations).length,1);assert.equal(desk.sync.lastSuccess,null);
  await send({type:'sync'});await send({type:'sync-finish',runId:syncRequest.runId,count:1,memberIds:['c']},chat);assert.equal(desk.sync.status,'ok');assert.ok(desk.sync.lastSuccess);
});
