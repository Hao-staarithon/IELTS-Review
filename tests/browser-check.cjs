const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const runtime='C:/Users/AHS/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=require(path.join(runtime,'playwright'));
const root=path.resolve(__dirname,'..'),output=path.resolve(root,'ielts-qa');fs.mkdirSync(output,{recursive:true});
(async()=>{
  const server=http.createServer((req,res)=>{const rel=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=path.resolve(root,'.'+rel);if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}fs.readFile(file,(e,buf)=>{if(e){res.writeHead(404);res.end();return;}const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png'}[path.extname(file)]||'text/plain';res.setHeader('Content-Type',mime+'; charset=utf-8');res.end(buf);});});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let browser;
  try{
    browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1024},locale:'zh-CN'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    const url='http://127.0.0.1:'+server.address().port+'/extension/index.html';await page.goto(url);await page.locator('.task-row').first().waitFor();
    assert.equal(await page.locator('.task-row').count(),5);
    const words=page.locator('[data-progress]').last();await words.fill('150');await words.dispatchEvent('change');await page.waitForFunction(()=>JSON.parse(localStorage.getItem('ielts-desk-preview')).tasks.some(t=>t.kind==='words'&&t.done===150));
    await page.locator('#quick-note').fill('界面测试记录：单词分组复习。');await page.locator('#save-quick').click();await page.reload();await page.locator('#quick-note').waitFor();assert.equal(await page.locator('#quick-note').inputValue(),'界面测试记录：单词分组复习。');
    await page.locator('[data-nav="scores"]').click();await page.locator('#add-score').click();await page.locator('[name="book"]').fill('剑雅 19');await page.locator('[name="test"]').fill('Test 1');await page.locator('[name="correct"]').fill('28');await page.locator('[name="parts"]').fill('10, 9, 9');await page.locator('[name="first"]').selectOption('yes');await page.locator('[name="timed"]').selectOption('yes');await page.locator('#score-form button[type="submit"]').click();await page.waitForFunction(()=>!document.querySelector('dialog').open);assert.match(await page.locator('tbody').innerText(),/6\.5/);
    await page.locator('[data-nav="review"]').click();await page.locator('[name="learning"]').fill('界面测试：判断题需要复查定位。');await page.locator('#review-form button[type="submit"]').click();await page.reload();assert.equal(await page.locator('[name="learning"]').inputValue(),'界面测试：判断题需要复查定位。');
    await page.locator('[data-nav="settings"]').click();await page.locator('[name="words"]').fill('350');await page.locator('#settings-form button[type="submit"]').click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('ielts-desk-preview')).settings.words===350);
    // Remove test data from screenshot: this is an empty real first-run preview, not fictional user progress.
    await page.evaluate(()=>localStorage.removeItem('ielts-desk-preview'));await page.goto(url+'#today');await page.reload();await page.locator('.task-row').first().waitFor();await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(output,'today.png'),fullPage:true});
    for(const name of ['review','scores','settings']){await page.locator('[data-nav="'+name+'"]').click();await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(output,name+'.png'),fullPage:true});}
    await page.setViewportSize({width:1024,height:768});await page.locator('[data-nav="today"]').click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(output,'today-1024.png'),fullPage:true});
    assert.deepEqual(errors,[]);console.log('PASS: add/edit progress, save/reload review, score entry/estimate, settings, four pages, 1024px layout; no JS errors.');
  }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
