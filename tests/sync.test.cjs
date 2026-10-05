const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../extension/content.js'),'utf8');
async function simulate({responses,known={},force=false}){
  const calls=[],messages=[];let listener,finish;
  const done=new Promise(r=>finish=r), projectId='g-p-test';
  const context={console,URL,Map,Set,Date,Error,String,Number,Array,Promise,AbortSignal,encodeURIComponent,setTimeout:(f)=>setTimeout(f,0),clearTimeout,location:{pathname:'/c/demo'},document:{body:null},MutationObserver:class{},fetch:async(url,opts)=>{const p=new URL(url).pathname+new URL(url).search;calls.push({path:p,headers:opts.headers});const data=responses[p];if(data===undefined)throw Error('Unexpected path '+p);return {ok:!data.status,status:data.status||200,json:async()=>data};},chrome:{runtime:{id:'test-id',onMessage:{addListener:f=>listener=f},sendMessage:async m=>{messages.push(m);if(m.type==='sync-finish')finish();return {ok:true};}}}};
  vm.runInNewContext(code,context);listener({type:'run-sync',runId:'r',projectId,known,force},{id:'test-id'},()=>{});await done;return {calls,messages};
}
test('Reads only selected project, paginates, preserves credentials in memory',async()=>{
  const {calls,messages}=await simulate({responses:{'/api/auth/session':{accessToken:'TEST-ONLY-FAKE',user:{}},'/backend-api/gizmos/g-p-test/conversations?cursor=0':{items:[{id:'a',update_time:100}],cursor:'next'},'/backend-api/gizmos/g-p-test/conversations?cursor=next':{items:[{id:'b',update_time:200}],cursor:null},'/backend-api/conversation/a':{id:'a',gizmo_id:'g-p-test',mapping:{}},'/backend-api/conversation/b':{id:'b',gizmo_id:'g-p-test',mapping:{}}}});
  assert.equal(messages.filter(m=>m.type==='sync-item').length,2);assert.equal(messages.at(-1).count,2);assert.equal(calls.some(c=>c.path.startsWith('/backend-api/conversations?')),false);assert.equal(JSON.stringify(messages).includes('TEST-ONLY-FAKE'),false);
});
test('Unchanged conversations skipped during incremental sync',async()=>{
  const {calls,messages}=await simulate({known:{a:{updated:100000,fetched:Date.now()}},responses:{'/api/auth/session':{user:{}},'/backend-api/gizmos/g-p-test/conversations?cursor=0':{items:[{id:'a',update_time:100}],cursor:null}}});assert.equal(calls.length,2);assert.equal(messages.at(-1).count,1);
});
test('Wrong project and rate limit cannot produce a success state',async()=>{
  const wrong=await simulate({responses:{'/api/auth/session':{user:{}},'/backend-api/gizmos/g-p-test/conversations?cursor=0':{items:[{id:'a'}],cursor:null},'/backend-api/conversation/a':{id:'a',gizmo_id:'g-p-other'}}});assert.match(wrong.messages.at(-1).error,/归属/);assert.equal(wrong.messages.some(m=>m.type==='sync-item'),false);
  const limited=await simulate({responses:{'/api/auth/session':{user:{}},'/backend-api/gizmos/g-p-test/conversations?cursor=0':{status:429}}});assert.equal(limited.messages.at(-1).rateLimited,true);
});
test('Invalid project response fails explicitly rather than erasing records',async()=>{const {messages}=await simulate({responses:{'/api/auth/session':{user:{}},'/backend-api/gizmos/g-p-test/conversations?cursor=0':{someOtherField:[]}}});assert.match(messages.at(-1).error,/格式/);assert.equal(messages.at(-1).memberIds,undefined);});
