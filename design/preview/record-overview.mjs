/** Record real, isolated UI chapters; never changes product files or animation timelines. */
import { chromium } from '/Users/jerry/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { mkdir, readFile, writeFile, rename, rmdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiFixture, streamFixture, exampleImage, tasks, chat, debug, run } from './fixtures.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const args=Object.fromEntries(process.argv.slice(2).map(arg=>{const[k,...v]=arg.replace(/^--/,'').split('=');return[k,v.join('=')||true];}));
const base=String(args.base||'http://localhost:5273');
const output=path.resolve(root,String(args.output||'work/overview-video'));
const only=args.only?new Set(String(args.only).split(',')):null;
const viewport={width:1920,height:1080};
const chapters=[
 {id:'01-tasks-board',title:'任务看板',route:'/tasks/list',durationSeconds:6,ready:'.task-board-metric[data-state="running"] [data-slot="digit-swap"]',entry:'board'},
 {id:'02-tasks-overview',title:'任务概览',route:'/tasks',durationSeconds:4,ready:'main [data-slot="digit-swap"]',entry:'digits'},
 {id:'03-task-detail',title:'任务对话与交付物',route:'/tasks/1',durationSeconds:7,ready:'.ai-task-conversation .ai-assistant-message',variant:'task-running'},
 {id:'04-worker-debug-running',title:'机器人对话工作台',route:'/tasks/workers/1001/debug',durationSeconds:11,ready:'.ai-debug-conversation .ai-assistant-message',variant:'debug-running'},
 {id:'05-workers-live',title:'机器人工作概览',route:'/tasks/live',durationSeconds:5,ready:'main [data-working="true"]',entry:'ready'},
 {id:'06-project-detail',title:'项目资料与质量检查',route:'/projects/1',durationSeconds:6,ready:'.responsive-detail-main .responsive-table-scroll tbody tr'},
 {id:'07-knowledge-search',title:'知识搜索',route:'/docs/search?q=%E4%BB%BB%E5%8A%A1',durationSeconds:5,ready:'.responsive-knowledge-search article'},
];
await mkdir(path.join(output,'raw'),{recursive:true});
const manifestPath=path.join(output,'chapters.json');
const prior=only?await readFile(manifestPath,'utf8').then(JSON.parse).catch(()=>null):null;
const watched=['frontend/src/components/motion-ui/DigitSwap.tsx','frontend/src/pages/TasksPage.tsx','frontend/src/pages/TaskCenterPage.tsx','frontend/src/pages/WorkerDebugPage.tsx','frontend/src/components/task-detail/TaskChatPanel.tsx','frontend/src/components/ai-ui/rabbit-identity.css','frontend/src/components/ai-ui/ai-conversation.css','design/preview/fixtures.mjs'];
const fingerprint=async()=>createHash('sha256').update(Buffer.concat(await Promise.all(watched.map(file=>readFile(path.join(root,file)))))).digest('hex');
const manifest={viewport,requestedFinalFps:30,fixtureNotice:'All data is isolated existing browser fixtures. API writes and external HTTP requests are blocked. Real runtime animations continue unmodified. Playwright native WebM frame rate is recorded for final 30fps composition.',startedAt:new Date().toISOString(),sourceFingerprint:await fingerprint(),chapters:prior?.chapters||[]};
await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
const browser=await chromium.launch({headless:true,executablePath:'/Users/jerry/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'});
try{
 for(const scene of chapters.filter(c=>!only||only.has(c.id))){
  const dataChat=structuredClone(chat),dataDebug=structuredClone(debug);
  if(scene.variant==='task-running'){const message=dataChat.messages.find(m=>m.id==='msg-assistant');message.status='running';for(const tool of message.tools||[])tool.status='running';}
  if(scene.variant==='debug-running'){dataDebug.status='running';for(const message of dataDebug.messages)if(message.role==='assistant')message.status='running';}
  const errors=[],consoleErrors=[],unmatchedApi=[],blockedWrites=[],apiRequests=[],externalRequests=[],actions=[],notes=[];
  const tempDir=path.join(output,'capture-tmp',scene.id);await mkdir(tempDir,{recursive:true});
  const context=await browser.newContext({viewport,recordVideo:{dir:tempDir,size:viewport},deviceScaleFactor:1,colorScheme:'dark',reducedMotion:'no-preference',locale:'zh-CN',timezoneId:'Asia/Shanghai',serviceWorkers:'block'});
  await context.addInitScript(({data,scene})=>{
   localStorage.setItem('theme','dark');window.__overviewRecord={firstReady:null,firstCounter:null,boardTarget:null};
   const observer=new MutationObserver(()=>{
    const now=performance.timeOrigin+performance.now(),ready=document.querySelector(scene.ready);
    if(ready&&ready.getBoundingClientRect().width>0&&window.__overviewRecord.firstReady===null)window.__overviewRecord.firstReady=now;
    if(document.querySelector('main [data-slot="digit-swap"]')&&window.__overviewRecord.firstCounter===null)window.__overviewRecord.firstCounter=now;
    const target=document.querySelector('.task-board-metric[data-state="running"] [data-slot="digit-swap"] .sr-only');
    if(target?.textContent==='2'&&window.__overviewRecord.boardTarget===null)window.__overviewRecord.boardTarget=now;
   });observer.observe(document,{childList:true,subtree:true,characterData:true});
   class FixtureSource extends EventTarget{
    static CONNECTING=0;static OPEN=1;static CLOSED=2;CONNECTING=0;OPEN=1;CLOSED=2;readyState=0;withCredentials=false;onopen=null;onmessage=null;onerror=null;
    constructor(url){super();this.url=new URL(url,location.origin).href;this.timer=setTimeout(()=>{if(this.readyState===2)return;this.readyState=1;const open=new Event('open');this.onopen?.(open);this.dispatchEvent(open);const p=new URL(this.url).pathname;let payload={type:'ping',at:Date.now()};if(p==='/api/tasks/stream')payload={type:'snapshot',tasks:data.tasks,at:Date.now()};else if(/\/tasks\/\d+\/chat\/stream$/.test(p))payload={type:'ready',at:Date.now()};else if(/\/workers\/\d+\/debug\/stream$/.test(p))payload={type:'snapshot',snapshot:data.debug};else if(/\/(checks|tests|exports)\/runs\/\d+\/stream$/.test(p))payload=data.run;const event=new MessageEvent('message',{data:JSON.stringify(payload),origin:location.origin});this.onmessage?.(event);this.dispatchEvent(event);},100);}
    close(){this.readyState=2;clearTimeout(this.timer);}
   }
   window.EventSource=FixtureSource;window.__UI_PREVIEW_FIXTURE__=true;
  },{data:{tasks,debug:dataDebug,run},scene:{ready:scene.ready}});
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.origin!==new URL(base).origin){externalRequests.push(req.url());return route.abort();}
   if(url.pathname==='/images/preview-example.svg')return route.fulfill({contentType:'image/svg+xml',body:exampleImage});
   if(!url.pathname.startsWith('/api/'))return route.continue();
   apiRequests.push({method:req.method(),path:url.pathname});
   if(!['GET','HEAD','OPTIONS'].includes(req.method())){blockedWrites.push({method:req.method(),path:url.pathname});return route.fulfill({status:405,contentType:'application/json',body:'{"message":"Recording blocks business writes"}'});}
   if(url.pathname.endsWith('/stream'))return route.fulfill({contentType:'text/event-stream',body:`data: ${JSON.stringify(streamFixture(req.url()))}\n\n`});
   const fixture=url.pathname==='/api/tasks/1/chat'?dataChat:url.pathname==='/api/tasks/1'?dataChat.task:url.pathname==='/api/workers/1001/debug'?dataDebug:apiFixture(req.url());
   if(fixture===undefined)unmatchedApi.push(url.pathname);
   return route.fulfill({status:fixture===undefined?404:200,contentType:'application/json',body:JSON.stringify(fixture??{})});
  });
  const pageCreateBefore=Date.now(),page=await context.newPage(),pageCreateAfter=Date.now();
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
  const result={id:scene.id,title:scene.title,route:scene.route,fixtureVariant:scene.variant||'default',path:path.join(output,'raw',scene.id+'.webm'),durationSeconds:scene.durationSeconds,errors,unmatchedApi,blockedWrites,apiRequests,externalRequests,consoleErrors,actions,notes,pageCreateClock:{before:pageCreateBefore,after:pageCreateAfter},status:'recording'};
  let stableEpoch;
  try{
   await page.goto(base+scene.route,{waitUntil:'domcontentloaded',timeout:30000});
   await page.locator(scene.ready).first().waitFor({state:'visible',timeout:20000});await page.evaluate(()=>document.fonts.ready);
   if(scene.id==='01-tasks-board')await page.waitForFunction(()=>window.__overviewRecord.boardTarget!==null);
   if(scene.id==='03-task-detail')await page.locator('.ai-task-conversation .ai-conversation-viewport').evaluate(el=>el.scrollTo({top:0,behavior:'instant'}));
   if(scene.id==='04-worker-debug-running')await page.locator('.ai-debug-conversation .ai-conversation-viewport').evaluate(el=>el.scrollTo({top:0,behavior:'instant'}));
   const markers=await page.evaluate(()=>window.__overviewRecord);
   stableEpoch=scene.entry==='board'?markers.boardTarget:scene.entry==='digits'?markers.firstCounter:scene.entry==='ready'?markers.firstReady:Date.now();
   result.readyMarkers=markers;result.stableStartEpochMs=stableEpoch;result.trimStartSeconds=Math.max(0,(stableEpoch-pageCreateAfter)/1000);result.trimClockNotice='Trim is measured from page creation to first real visible DOM commit; raw captures include load lead-in. No animation time is paused or replaced.';
   const at=async(seconds,label,fn)=>{const remaining=stableEpoch+seconds*1000-Date.now();if(remaining>0)await page.waitForTimeout(remaining);const start=Date.now();try{const detail=await fn();actions.push({label,atSeconds:(start-stableEpoch)/1000,detail:detail??null,passed:true});}catch(e){actions.push({label,atSeconds:(start-stableEpoch)/1000,passed:false,error:e.message});throw e;}};
   if(scene.id==='01-tasks-board'){
    await at(1.2,'Hover the first running task',()=>page.locator('.task-board-card--running').first().hover({timeout:1500}));
    await at(2.7,'Expand existing live log',async()=>{const button=page.locator('.task-board-card--running').first().locator('button[aria-controls^="task-log-"]');await button.click({timeout:1500});return{expanded:await button.getAttribute('aria-expanded')};});
    await at(4.5,'Read expanded live output',()=>page.locator('.task-board-card--running').first().locator('button[aria-controls^="task-log-"]').hover({timeout:1500}));
   }else if(scene.id==='02-tasks-overview'){
    await at(1.6,'Hover the existing status surface',()=>page.locator('main [data-slot="card-content"]').first().hover({timeout:1500}));
   }else if(scene.id==='03-task-detail'){
    notes.push('Task chat has no reasoning renderer or reasoning fixture; no thought content is fabricated. Actual reasoning is shown in chapter 04.');
    await at(1.1,'Read existing running tool chip',()=>page.locator('.ai-tool-chip').first().hover({timeout:1500}));
    await at(2.6,'Open existing deliverables tab',()=>page.locator('.task-side-panel').getByRole('tab',{name:/^交付物/}).click({timeout:1500}));
    await at(4.8,'Return to existing pipeline',()=>page.locator('.task-side-panel').getByRole('tab',{name:/^流水线/}).click({timeout:1500}));
   }else if(scene.id==='04-worker-debug-running'){
    const thought=page.locator('.ai-reasoning-trigger').first();
    await at(1.0,'Fold the existing thought trace',async()=>{if(await thought.getAttribute('aria-expanded')==='true')await thought.click({timeout:1500});return{expanded:await thought.getAttribute('aria-expanded')};});
    await at(2.0,'Expand the existing thought trace',async()=>{if(await thought.getAttribute('aria-expanded')!=='true')await thought.click({timeout:1500});return{expanded:await thought.getAttribute('aria-expanded')};});
    await at(3.2,'Focus existing composer without sending',async()=>{await page.locator('.ai-composer textarea').focus();return{sendDisabled:await page.locator('.ai-composer-send').isDisabled()};});
    await at(6.7,'Keep active AI identity in view',()=>page.locator('.ai-session-avatar').hover({timeout:1500}));
   }else if(scene.id==='05-workers-live'){
    await at(1.1,'Hover working robot',()=>page.locator('main [data-working="true"]').first().hover({timeout:1500}));
    await at(3.1,'Compare idle robot',()=>page.locator('main [data-working="false"]').first().hover({timeout:1500}));
   }else if(scene.id==='06-project-detail'){
    await at(1.1,'Read project documents and resources',()=>page.locator('main.square-page').evaluate(el=>el.scrollBy({top:240,behavior:'smooth'})));
    await at(3.1,'Scroll to actual quality checks',()=>page.getByRole('heading',{name:'检查',exact:true}).evaluate(el=>el.scrollIntoView({behavior:'smooth',block:'center'})));
    await at(4.9,'Hover existing check link',()=>page.getByRole('link',{name:'CHK-001',exact:true}).first().hover({timeout:1500}));
   }else if(scene.id==='07-knowledge-search'){
    await at(1.0,'Read an existing result',()=>page.locator('.responsive-knowledge-search article').first().hover({timeout:1500}));
    await at(2.0,'Focus the current query',()=>page.getByRole('textbox',{name:'知识搜索关键词'}).focus());
    await at(3.2,'Scroll existing search snippets',()=>page.locator('main.square-page').evaluate(el=>el.scrollBy({top:230,behavior:'smooth'})));
   }
   const remaining=stableEpoch+(scene.durationSeconds+.35)*1000-Date.now();if(remaining>0)await page.waitForTimeout(remaining);
   result.layout=await page.evaluate(()=>({documentWidth:document.documentElement.scrollWidth,viewportWidth:innerWidth,mainScrollWidth:document.querySelector('main')?.scrollWidth,mainWidth:document.querySelector('main')?.clientWidth}));
   result.realAnimations=await page.evaluate(()=>document.getAnimations().map(a=>({name:a.animationName||'web-animation',state:a.playState,duration:a.effect?.getTiming().duration})).slice(0,80));
   result.status=errors.length||unmatchedApi.length||blockedWrites.length||externalRequests.length?'needs-review':'recorded';
  }catch(e){result.status='failed';result.failure=e.message;result.trimStartSeconds??=0;}
  const rawPath=await page.video().path();await context.close();await rename(rawPath,result.path);await rmdir(tempDir).catch(()=>{});
  result.metadata=JSON.parse(execFileSync('/opt/homebrew/bin/ffprobe',['-v','error','-show_entries','format=duration,size:stream=codec_name,codec_type,width,height,avg_frame_rate','-of','json',result.path],{encoding:'utf8'}));
  result.availableTailSeconds=Number(result.metadata.format.duration)-result.trimStartSeconds;
  if(result.availableTailSeconds<result.durationSeconds){result.status='needs-review';result.notes.push('The raw video is shorter than the requested trim window.');}
  manifest.chapters=manifest.chapters.filter(c=>c.id!==result.id);manifest.chapters.push(result);manifest.chapters.sort((a,b)=>a.id.localeCompare(b.id));await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify({id:result.id,status:result.status,raw:result.path,trimStartSeconds:result.trimStartSeconds,durationSeconds:result.durationSeconds,errors:errors.length,unmatchedApi:unmatchedApi.length,blockedWrites:blockedWrites.length,failure:result.failure}));
 }
}finally{
 await browser.close();manifest.finishedAt=new Date().toISOString();manifest.finishedSourceFingerprint=await fingerprint();manifest.sourceChangedDuringRecording=manifest.sourceFingerprint!==manifest.finishedSourceFingerprint;manifest.summary={chapters:manifest.chapters.length,recorded:manifest.chapters.filter(c=>c.status==='recorded').length,failed:manifest.chapters.filter(c=>c.status!=='recorded').length,totalDurationSeconds:manifest.chapters.reduce((sum,c)=>sum+c.durationSeconds,0)};await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
}
console.log(JSON.stringify({manifest:manifestPath,...manifest.summary}));
if(manifest.summary.failed)process.exitCode=1;
