/**
 * Reproducible, isolated UI screenshot verification. All /api traffic is mocked
 * with explicitly fictional fixtures. No product code or backend is modified.
 *
 * Usage: node design/preview/capture.mjs
 *        node design/preview/capture.mjs --only=tasks-board,projects,worker-edit
 *        node design/preview/capture.mjs --base=http://localhost:5273
 *        node design/preview/capture.mjs --premium-checks --screenshots=none --only=projects-mobile,project-detail,settings,task-feedback,worker-debug-running --report=design/premium-interaction-report.json
 *        node design/preview/capture.mjs --chat-states --viewport=360x800 --only=task-question-pending,task-question-answered
 */
import { chromium } from '/Users/jerry/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiFixture, streamFixture, FIXED_NOW, exampleImage, tasks, chat, debug, run, workers } from './fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = Object.fromEntries(process.argv.slice(2).map((arg) => { const [key, ...rest] = arg.replace(/^--/, '').split('='); return [key, rest.join('=') || true]; }));
const base = String(args.base || 'http://localhost:5273');
const requestedSettleMs = Number(args['settle-ms'] || 0);
if (!Number.isFinite(requestedSettleMs) || requestedSettleMs < 0 || requestedSettleMs > 10000) throw new Error('settle-ms must be between 0 and 10000');
const screenshotDir = path.resolve(root, String(args.output || 'design/screenshots'));
const reportPath = path.resolve(root, String(args.report || 'design/preview/report.json'));
const selected = args.only ? new Set(String(args.only).split(',')) : null;
const viewportMatch = args.viewport ? /^(\d+)x(\d+)$/.exec(String(args.viewport)) : null;
if (args.viewport && !viewportMatch) throw new Error('Use --viewport=WIDTHxHEIGHT');
const forcedViewport = viewportMatch ? { width: Number(viewportMatch[1]), height: Number(viewportMatch[2]) } : null;
if (args.video && (!selected || selected.size !== 1)) throw new Error('Video recording requires --only with one existing scenario');
const videoDir = path.resolve(root, String(args['video-dir'] || 'work/ai-deep/video'));
const executablePath = '/Users/jerry/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const scenarios = [
  { name: 'overview', route: '/' },
  { name: 'projects', route: '/projects' },
  { name: 'project-detail', route: '/projects/1' },
  { name: 'documents', route: '/documents' },
  { name: 'document-detail', route: '/documents/1', editor: true },
  { name: 'knowledge-browser', route: '/docs/detail/' },
  { name: 'knowledge-article', route: '/docs/detail/guides/agent-workflow', editor: true },
  { name: 'knowledge-search', route: '/docs/search?q=%E4%BB%BB%E5%8A%A1' },
  { name: 'checks', route: '/checks' },
  { name: 'check-run', route: '/projects/1/checks/1' },
  { name: 'tests', route: '/tests' },
  { name: 'project-tests', route: '/projects/1/tests' },
  { name: 'test-run', route: '/projects/1/tests/1' },
  { name: 'exports', route: '/exports' },
  { name: 'export-run', route: '/projects/1/exports/1' },
  { name: 'schedules', route: '/schedules' },
  { name: 'schedule-detail', route: '/projects/1/schedules/1' },
  { name: 'defects', route: '/defects' },
  { name: 'project-defects', route: '/projects/1/defects' },
  { name: 'defect-detail', route: '/projects/1/defects/1' },
  { name: 'resources', route: '/resources' },
  { name: 'milestones', route: '/milestones' },
  { name: 'commits', route: '/commits' },
  { name: 'scripts', route: '/scripts' },
  { name: 'apps', route: '/apps' },
  { name: 'settings', route: '/settings' },
  { name: 'profile', route: '/profile' },
  { name: 'repos', route: '/code/repos' },
  { name: 'users', route: '/admin/users' },
  { name: 'tasks-board', route: '/tasks/list' },
  { name: 'tasks-all', route: '/tasks/list', action: 'all-tasks' },
  { name: 'tasks-overview', route: '/tasks' },
  { name: 'task-new', route: '/tasks/new', editor: true },
  { name: 'task-detail', route: '/tasks/1', fixtureVariant: 'task-running', conversationTop: true },
  { name: 'task-feedback', route: '/tasks/1', fixtureVariant: 'task-feedback', action: 'feedback-draft', conversationTop: true },
  { name: 'workers', route: '/tasks/workers' },
  { name: 'workers-live', route: '/tasks/live' },
  { name: 'worker-edit', route: '/tasks/workers/1001', editor: true },
  { name: 'worker-new', route: '/tasks/workers/new', editor: true },
  { name: 'worker-debug', route: '/tasks/workers/1001/debug' },
  { name: 'worker-debug-running', route: '/tasks/workers/1001/debug', fixtureVariant: 'debug-running', action: 'debug-running-draft' },
  { name: 'worker-debug-mobile', route: '/tasks/workers/1001/debug', viewport: { width: 390, height: 844 } },
  { name: 'templates', route: '/tasks/templates' },
  { name: 'template-edit', route: '/tasks/templates/1', editor: true },
  { name: 'template-new', route: '/tasks/templates/new', editor: true },
  { name: 'executors', route: '/tasks/executors' },
  { name: 'login', route: '/login', loggedIn: false },
  { name: 'projects-modal', route: '/projects', action: 'project-modal' },
  { name: 'tasks-expanded', route: '/tasks/list', action: 'expand-log' },
  { name: 'tasks-hover', route: '/tasks/list', action: 'hover-first-running' },
  { name: 'tasks-reduced-motion', route: '/tasks/list', reducedMotion: 'reduce' },
  { name: 'tasks-os-light', route: '/tasks/list', colorScheme: 'light' },
  { name: 'tasks-mobile', route: '/tasks/list', viewport: { width: 390, height: 844 } },
  { name: 'projects-mobile', route: '/projects', viewport: { width: 390, height: 844 } },
  { name: 'task-new-mobile', route: '/tasks/new', viewport: { width: 390, height: 844 }, editor: true },
];
if (args['chat-states']) scenarios.push(
  { name: 'task-question-pending', route: '/tasks/1', fixtureVariant: 'task-running', action: 'question-pending' },
  { name: 'task-question-answered', route: '/tasks/1', fixtureVariant: 'question-answered', action: 'question-answered' },
);

async function inspectPremiumInteractions(page, scenario) {
  const checks = {};
  const hitTest = async (locator) => locator.evaluate((node) => {
    const r = node.getBoundingClientRect();
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    const hit = document.elementFromPoint(x,y);
    const actualHit = r.width > 0 && r.height > 0 && !!hit && node.contains(hit);
    const disabled = !!node.disabled;
    return { label: node.getAttribute('aria-label') || node.textContent?.trim(), x, y, disabled, actualHit, pointerEvents: getComputedStyle(node).pointerEvents, actionableExpected: !disabled, passed: disabled || actualHit, notice: disabled ? 'This existing disabled control is intentionally non-actionable; the actual hit result is retained.' : null };
  });
  const composer = page.locator('.ai-composer').first();
  if (await composer.count()) {
    await composer.hover({ position: { x: 35, y: 10 } });
    await page.waitForTimeout(180);
    const first = await composer.evaluate((node) => ({ x: node.style.getPropertyValue('--pointer-x'), y: node.style.getPropertyValue('--pointer-y') }));
    await composer.hover({ position: { x: 95, y: 18 } });
    const second = await composer.evaluate((node) => ({ x: node.style.getPropertyValue('--pointer-x'), y: node.style.getPropertyValue('--pointer-y'), pointerEvents: getComputedStyle(node,'::after').pointerEvents, opacity: getComputedStyle(node,'::after').opacity }));
    checks.composerPointer = { first, second, passed: first.x !== second.x && first.y !== second.y && second.pointerEvents === 'none' && Number(second.opacity) > 0 };
    await composer.locator('textarea').focus();
    const before = await composer.evaluate((node) => getComputedStyle(node).getPropertyValue('--ai-energy-angle'));
    await page.waitForTimeout(270);
    const focus = await composer.evaluate((node) => ({ after: getComputedStyle(node).getPropertyValue('--ai-energy-angle'), borderOpacity: getComputedStyle(node,'::before').opacity, pointerEvents: getComputedStyle(node,'::before').pointerEvents, focused: node.matches(':focus-within') }));
    checks.composerFocus = { before, ...focus, passed: focus.focused && focus.after !== before && Number(focus.borderOpacity) > 0 && focus.pointerEvents === 'none' };
    checks.send = await hitTest(page.locator('.ai-composer-send').first());
  }
  const energyField = page.locator('.ai-energy[data-active="true"] .ai-energy__field').first();
  const avatar = await energyField.count() ? energyField : page.locator('.ai-assistant-message[data-running="true"] .ai-avatar-frame').first();
  const avatarProperty = await energyField.count() ? '--ai-orbit-angle' : '--ai-energy-angle';
  if (await avatar.count()) {
    const before = await avatar.evaluate((node,property) => getComputedStyle(node).getPropertyValue(property),avatarProperty);
    await page.waitForTimeout(270);
    const after = await avatar.evaluate((node,property) => getComputedStyle(node).getPropertyValue(property),avatarProperty);
    checks.runningAvatar = { property: avatarProperty, before, after, passed: before !== after };
  }
  const reasoning = page.locator('.ai-reasoning-trigger').first();
  if (await reasoning.count()) {
    const initial = await reasoning.getAttribute('aria-expanded');
    await reasoning.hover({ position: { x: 35, y: 10 } });
    await page.waitForTimeout(180);
    checks.reasoningPointer = await reasoning.evaluate((node) => ({ x: node.style.getPropertyValue('--pointer-x'), y: node.style.getPropertyValue('--pointer-y'), overlayPointerEvents: getComputedStyle(node,'::after').pointerEvents, overlayOpacity: getComputedStyle(node,'::after').opacity }));
    checks.reasoningPointer.passed = checks.reasoningPointer.x !== '' && checks.reasoningPointer.y !== '' && checks.reasoningPointer.overlayPointerEvents === 'none' && Number(checks.reasoningPointer.overlayOpacity) > 0;
    await reasoning.click();
    await page.waitForTimeout(250);
    const toggled = await reasoning.getAttribute('aria-expanded');
    await reasoning.click();
    await page.waitForTimeout(250);
    const restored = await reasoning.getAttribute('aria-expanded');
    checks.reasoningToggle = { initial, toggled, restored, passed: toggled !== initial && restored === initial };
  }
  const table = page.locator('.responsive-table-scroll').first();
  if (await table.count()) {
    const state = await table.evaluate((node) => { const initial = node.scrollLeft; node.scrollLeft = Math.min(120,node.scrollWidth-node.clientWidth); return { initial, scrollLeft: node.scrollLeft }; });
    const box = await table.boundingBox();
    const localX = Math.min(100,box.width/2), localY = Math.min(75,box.height/2);
    await page.mouse.move(box.x+localX,box.y+localY);
    await page.waitForTimeout(200);
    checks.tablePointer = await table.evaluate((node) => ({ x: Number.parseFloat(node.style.getPropertyValue('--pointer-x')), y: Number.parseFloat(node.style.getPropertyValue('--pointer-y')), scrollLeft: node.scrollLeft, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, rowEdgePointerEvents: getComputedStyle(node.querySelector('tbody tr > :first-child'),'::before').pointerEvents }));
    checks.tablePointer.expectedX = localX+state.scrollLeft;
    checks.tablePointer.passed = Math.abs(checks.tablePointer.x-checks.tablePointer.expectedX) < 1 && Math.abs(checks.tablePointer.y-localY) < 1 && checks.tablePointer.rowEdgePointerEvents === 'none';
    await table.evaluate((node, initial) => { node.scrollLeft=initial; },state.initial);
  }
  const toolbarInput = page.locator('[data-slot="toolbar"] input').first();
  if (await toolbarInput.count()) {
    await toolbarInput.focus();
    checks.toolbarFocus = await toolbarInput.evaluate((node) => ({ focused: document.activeElement === node, shadow: getComputedStyle(node.closest('[data-slot="input-wrapper"]') || node).boxShadow }));
    checks.toolbarFocus.passed = checks.toolbarFocus.focused && checks.toolbarFocus.shadow !== 'none';
    checks.toolbarHit = await hitTest(toolbarInput);
  }
  const glintButton = page.locator('main button.bg-primary').first();
  if (!await page.locator('.ai-conversation').count() && await glintButton.count() && await glintButton.isVisible()) {
    await page.mouse.move(0,0);
    await page.waitForTimeout(500);
    const before = await glintButton.evaluate((node) => getComputedStyle(node,'::after').backgroundPositionX);
    await glintButton.hover();
    await page.waitForTimeout(150);
    const middle = await glintButton.evaluate((node) => getComputedStyle(node,'::after').backgroundPositionX);
    await page.waitForTimeout(450);
    const after = await glintButton.evaluate((node) => ({ position: getComputedStyle(node,'::after').backgroundPositionX, opacity: getComputedStyle(node,'::after').opacity, pointerEvents: getComputedStyle(node,'::after').pointerEvents, animationName: getComputedStyle(node,'::after').animationName }));
    const slot = await glintButton.getAttribute('data-slot');
    const applicable = await glintButton.evaluate((node) => node.tagName === 'BUTTON');
    checks.buttonGlint = { before, middle, after, dataSlot: slot, applicable, passed: applicable ? before !== middle && before !== after.position && Number(after.opacity) > 0 && after.pointerEvents === 'none' && after.animationName === 'none' : null, notice: 'The premium glint targets existing native buttons, including composed dialog triggers. The original data-slot is retained in this record.' };
    checks.buttonHit = await hitTest(glintButton);
  }
  const card = page.locator('main [data-slot="card-content"]').first();
  if (!await page.locator('.ai-conversation').count() && await card.count()) {
    await card.hover({ position: { x: 40, y: 40 } });
    await page.waitForTimeout(250);
    checks.cardEdge = await card.evaluate((node) => ({ transform: getComputedStyle(node).transform, opacity: getComputedStyle(node,'::before').opacity, pointerEvents: getComputedStyle(node,'::before').pointerEvents }));
    checks.cardEdge.passed = Number(checks.cardEdge.opacity) > 0 && checks.cardEdge.pointerEvents === 'none';
  }
  for (const label of ['提测','git pull']) {
    const button = page.getByRole('button',{name:label,exact:true}).first();
    if (await button.count()) { await button.scrollIntoViewIfNeeded(); checks[`existingButton:${label}`] = await hitTest(button); }
  }
  await page.mouse.move(0,0);
  if (scenario.action === 'feedback-draft' || scenario.action === 'debug-running-draft') await composer.locator('textarea').focus();
  return { ...checks, passed: Object.values(checks).every((check) => check.passed !== false), notice: 'Pointer/focus/disclosure checks only. Disabled hit results and non-applicable glint slots remain explicit. No send, save, sync, reset, or mutation action is invoked.' };
}

async function sampleAiMotion(page) {
  const sample = () => {
    const energies = [...document.querySelectorAll('.ai-energy')].map((root, index) => ({ index, active: root.getAttribute('data-active') === 'true', ariaHidden: root.getAttribute('aria-hidden'), fields: [...root.querySelectorAll('.ai-energy__field')].map((node) => ({ angle: getComputedStyle(node).getPropertyValue('--ai-orbit-angle'), transform: getComputedStyle(node).transform, duration: getComputedStyle(node).animationDuration, background: getComputedStyle(node.querySelector('.ai-energy__ring') || node).backgroundImage })) }));
    const waves = [...document.querySelectorAll('.ai-waveform[data-active="true"]')].filter((root) => root.getBoundingClientRect().width > 0 && root.getBoundingClientRect().height > 0).map((root) => { const bars = [...root.children]; const preferred = bars[6]; const preferredVisible = preferred && getComputedStyle(preferred).display !== 'none'; const node = preferredVisible ? preferred : bars.filter((bar) => getComputedStyle(bar).display !== 'none')[2]; return { rootClass: root.className, barIndex: bars.indexOf(node)+1, preferredBarHidden: !preferredVisible, transform: node ? getComputedStyle(node).transform : null }; });
    const owners = [...document.querySelectorAll('.ai-conversation,.ai-composer')].map((node) => { const style=getComputedStyle(node), layer=getComputedStyle(node,'::before'); const edgeVisible=layer.content !== 'none' && layer.display !== 'none' && Number(layer.opacity)>0; return { target: node.classList.contains('ai-composer') ? 'composer' : 'pane', animationName:style.animationName, layerOpacity:layer.opacity, edgeVisible, gradientExpected: edgeVisible && style.animationName.includes('ai-energy-orbit'), angle: style.getPropertyValue('--ai-energy-angle'), spectrum: style.getPropertyValue('--ai-energy-spectrum'), background: layer.backgroundImage, pointerEvents:layer.pointerEvents }; });
    const pointerLayers = [...document.querySelectorAll('.ai-energy,.ai-energy *,.ai-waveform,.ai-waveform *')].map((node) => getComputedStyle(node).pointerEvents);
    return { energies, waves, owners, pointerLayers, avatarBackings: [...document.querySelectorAll('.worker-avatar-empty')].map((node) => getComputedStyle(node).backgroundColor), images: [...document.querySelectorAll('img')].map((node) => ({ src:node.getAttribute('src'), loaded:node.complete && node.naturalWidth>0, width:node.getBoundingClientRect().width, height:node.getBoundingClientRect().height })) };
  };
  const before = await page.evaluate(sample);
  await page.waitForTimeout(270);
  const after = await page.evaluate(sample);
  const energies = after.energies.map((root,index) => ({ ...root, fields: root.fields.map((field,j) => { const previous = before.energies[index]?.fields[j]; return { ...field, angleChanged: previous?.angle !== field.angle, transformChanged: previous?.transform !== field.transform, backgroundChanged: previous?.background !== field.background }; }) }));
  const active = energies.filter((root) => root.active);
  const idle = energies.filter((root) => !root.active);
  const owners = after.owners.map((owner,index) => ({ ...owner, beforeAngle: before.owners[index]?.angle, angleChanged: before.owners[index]?.angle !== owner.angle, gradientChanged: before.owners[index]?.background !== owner.background }));
  const waveChanged = after.waves.map((wave,index) => wave.transform !== null && before.waves[index]?.transform !== wave.transform);
  const checks = { activeFieldsMove: active.every((root) => root.fields.length === 1 && root.fields.every((field) => field.angleChanged && field.backgroundChanged)), idleFieldsStatic: idle.every((root) => root.fields.length === 1 && root.fields.every((field) => !field.angleChanged && !field.backgroundChanged)), wavesMove: waveChanged.every(Boolean), gradientsFollowAngles: owners.filter((owner) => owner.gradientExpected).every((owner) => owner.angleChanged && owner.gradientChanged && owner.background !== 'none' && owner.spectrum !== '' && owner.pointerEvents === 'none'), decorativeOnly: after.pointerLayers.every((value) => value === 'none') && after.energies.every((root) => root.ariaHidden === 'true'), imagesLoaded:after.images.every((image) => image.loaded) };
  return { intervalMs: 270, artwork:'Single spectral field; static transform is intentional. Rabbit avatar/AI badge supersedes the former black fallback requirement.', energies, owners, waveCount: after.waves.length, waveBefore: before.waves, waveAfter: after.waves, waveChanged, avatarBackings:after.avatarBackings, images:after.images, checks, passed: Object.values(checks).every(Boolean) };
}

async function inspectSymbolMotion(page) {
  const before = await page.locator('.rabbit-identity__symbol').evaluateAll((nodes) => nodes.map((node) => { const animation=node.getAnimations().find((item)=>item.animationName==='ai-symbol-burst'); return { transform:getComputedStyle(node).transform, currentTime:animation?.currentTime ?? null }; }));
  await page.waitForTimeout(270);
  return page.locator('.rabbit-identity__symbol').evaluateAll((nodes,previous) => {
    const cases=nodes.map((node,index)=>{
      const style=getComputedStyle(node),animation=node.getAnimations().find((item)=>item.animationName==='ai-symbol-burst');
      const expectedActive=!!node.closest(".ai-avatar-frame:has(> .ai-energy[data-active='true']),[data-working='true']");
      const runtime={before:previous[index],after:{transform:style.transform,currentTime:animation?.currentTime ?? null},changed:previous[index]?.transform!==style.transform};
      if(!animation)return{index,expectedActive,animationName:style.animationName,runtime,passed:!expectedActive&&style.animationName==='none'};
      const saved={time:animation.currentTime,state:animation.playState};
      const keyframes=animation.effect.getKeyframes().map((frame)=>({offset:frame.offset,transform:frame.transform,easing:frame.easing}));
      animation.pause();
      const sample=(time)=>{animation.currentTime=time;const transform=getComputedStyle(node).transform;const matrix=new DOMMatrixReadOnly(transform);return{time,transform,angle:Math.atan2(matrix.b,matrix.a)*180/Math.PI};};
      const samples=[500,600,3900,4000,7000,7100,9000,9900,10000,10100,6500,6600].map(sample);
      const step=(a,b)=>((samples[b].angle-samples[a].angle+540)%360)-180;
      const speeds={slowDegreesPer100ms:Math.abs(step(0,1)),fastDegreesPer100ms:Math.abs(step(2,3)),restDegreesPer100ms:Math.abs(step(4,5)),restartDegreesPer100ms:Math.abs(step(8,9)),lateDegreesPer100ms:Math.abs(step(10,11))};
      const checks={gatedByExistingWorkingState:expectedActive,runtimeAdvances:Number(runtime.after.currentTime)>Number(runtime.before.currentTime),tenSecondCycle:animation.effect.getTiming().duration===10000,fiveTurns:keyframes.some((frame)=>frame.offset===.68&&frame.transform==='rotate(1800deg)'),accelerates:speeds.fastDegreesPer100ms>speeds.slowDegreesPer100ms*4&&speeds.fastDegreesPer100ms>20,decelerates:speeds.lateDegreesPer100ms<speeds.fastDegreesPer100ms/4,rests:speeds.restDegreesPer100ms<.001&&Math.abs(step(6,7))<.001,restarts:speeds.restartDegreesPer100ms>.001};
      animation.currentTime=saved.time;if(saved.state==='running')animation.play();
      return{index,expectedActive,animationName:style.animationName,duration:style.animationDuration,runtime,keyframes,samples,speeds,checks,passed:Object.values(checks).every(Boolean)};
    });
    return{intervalMs:270,cases,activeCount:cases.filter((item)=>item.expectedActive).length,idleCount:cases.filter((item)=>!item.expectedActive).length,passed:cases.length>0&&cases.every((item)=>item.passed),notice:'Runtime advancement and live transforms are sampled first. In this isolated test context only, CSS Animation currentTime is then sampled to verify acceleration, five turns, rest, and restart; original time/play state is restored. No product CSS or state is changed.'};
  },before);
}

async function inspectRabbitIdentity(page) {
  return page.locator('.rabbit-identity').evaluateAll((roots) => {
    const cases = roots.map((root) => {
      const image=root.querySelector('.rabbit-identity__image'), symbol=root.querySelector('.rabbit-identity__symbol');
      const r=root.getBoundingClientRect(), s=symbol?.getBoundingClientRect();
      const visible=r.width>0 && r.height>0 && r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight;
      const clippedBy=[]; let withinScroll=true;
      for(let parent=root.parentElement;parent;parent=parent.parentElement){ const style=getComputedStyle(parent), p=parent.getBoundingClientRect(); if(['auto','scroll'].includes(style.overflowY) && (r.top<p.top || r.bottom>p.bottom))withinScroll=false; if(['auto','scroll'].includes(style.overflowX) && (r.left<p.left || r.right>p.right))withinScroll=false; if(s && visible && withinScroll && ((['hidden','clip'].includes(style.overflowX) && (s.left<p.left-.75 || s.right>p.right+.75)) || (['hidden','clip'].includes(style.overflowY) && (s.top<p.top-.75 || s.bottom>p.bottom+.75))))clippedBy.push({className:String(parent.className),slot:parent.getAttribute('data-slot')}); }
      const photoLoaded=!!image && image.complete && image.naturalWidth===512 && image.naturalHeight===512;
      const symbolSource=symbol?.getAttribute('src') || '';
      const symbolLoaded=!!symbol && symbol.complete && symbol.naturalWidth>0 && (/ai-symbol.*\.svg/.test(symbolSource) || symbolSource.startsWith('data:image/svg+xml'));
      const topRight=!!s && s.x+s.width/2>r.x+r.width*.55 && s.y+s.height/2<r.y+r.height*.45;
      const noLetters=[...root.childNodes].filter((node)=>node.nodeType===Node.TEXT_NODE).every((node)=>!node.textContent.trim());
      const pointerSafe=getComputedStyle(root).pointerEvents==='none' && [...root.querySelectorAll('*')].every((node)=>getComputedStyle(node).pointerEvents==='none');
      return {role:root.classList.contains('square-rabbit-mark')?'brand-logo':'robot-avatar',width:r.width,height:r.height,imageSrc:image?.getAttribute('src'),naturalWidth:image?.naturalWidth,naturalHeight:image?.naturalHeight,symbolSrc:symbolSource.startsWith('data:')?'data:image/svg+xml (Vite inlined graphical asset)':symbolSource,symbolWidth:s?.width,symbolHeight:s?.height,visible,photoLoaded,symbolLoaded,topRight,noLetters,pointerSafe,clippedBy,passed:photoLoaded && symbolLoaded && topRight && noLetters && pointerSafe && clippedBy.length===0};
    });
    return {cases,passed:cases.length>0 && cases.every((item)=>item.passed),notice:'Original rabbit image and graphical SVG AI symbol are checked separately; no AI letter badge is expected.'};
  });
}

async function inspectConversationGeometry(page) {
  return page.evaluate(() => {
    const describe=(node)=>{if(!node)return null;const r=node.getBoundingClientRect(),s=getComputedStyle(node);return{height:r.height,top:r.top,bottom:r.bottom,width:r.width,clientHeight:node.clientHeight,scrollHeight:node.scrollHeight,computedHeight:s.height,minHeight:s.minHeight,maxHeight:s.maxHeight,overflowY:s.overflowY,gridRows:s.gridTemplateRows};};
    const main=document.querySelector('main'),pane=document.querySelector('.ai-debug-conversation,.ai-task-conversation'),viewport=pane?.querySelector('.ai-conversation-viewport'),composer=pane?.querySelector('.ai-composer'),empty=pane?.querySelector('.ai-conversation-empty');
    const parts=Object.fromEntries(['.ai-debug-page','.ai-debug-session','.ai-debug-workspace','.ai-debug-conversation','.ai-task-conversation','.ai-conversation-viewport','.ai-composer-dock','.ai-composer','.ai-todo-panel'].map((key)=>[key,describe(document.querySelector(key))]));
    const p=describe(pane),v=describe(viewport),c=describe(composer),m=describe(main),debug=!!document.querySelector('.ai-debug-page');
    const expectedDebugHeight=debug&&innerWidth<1100?Math.min(560,Math.max(300,innerHeight-22*parseFloat(getComputedStyle(document.documentElement).fontSize))):null;
    const checks={debugHeightBounded:expectedDebugHeight===null||Math.abs(p.height-expectedDebugHeight)<2,mobileWorkspaceBounded:!debug||innerWidth>=768||m.height<=innerHeight-164+2,viewportScrollable:!!v&&v.clientHeight>0&&['auto','scroll'].includes(v.overflowY),composerContained:!c||(c.top>=p.top-1&&c.bottom<=p.bottom+1)};
    const emptyState=empty?{text:empty.textContent?.trim(),rect:describe(empty),inputVisible:!!c&&c.top>=0&&c.bottom<=innerHeight}:null;
    return{parts,main:m,expectedDebugHeight,emptyState,checks,passed:Object.values(checks).every(Boolean)};
  });
}

await mkdir(screenshotDir, { recursive: true });
await mkdir(path.dirname(reportPath), { recursive: true });
if (args.video) await mkdir(videoDir, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-dev-shm-usage'] });
let interrupted = false;
process.once('SIGINT', () => { interrupted = true; void browser.close(); });
const previous = args.merge ? await readFile(reportPath, 'utf8').then(JSON.parse).catch(() => null) : null;
const report = { fixtureNotice: 'All data is fictional example data. Every API request is intercepted; no backend or business data is accessed.', startedAt: new Date().toISOString(), base, scenarios: previous?.scenarios ?? [] };
try {
  for (const configuredScenario of scenarios.filter((item) => !selected || selected.has(item.name))) {
    if (interrupted) break;
    const scenario = args['worker-id'] && /^\/tasks\/workers\/\d+\/debug$/.test(configuredScenario.route) ? { ...configuredScenario,route:`/tasks/workers/${Number(args['worker-id'])}/debug` } : configuredScenario;
    // State variants remain fictional browser fixtures. Both HTTP snapshots and
    // SSE snapshots receive the same override; no product state is changed.
    const previewChat = structuredClone(chat);
    const previewDebug = structuredClone(debug);
    const debugId = Number(/^\/tasks\/workers\/(\d+)\/debug$/.exec(scenario.route)?.[1] || 1001);
    if (debugId !== previewDebug.worker.id) {
      const worker = workers.find((item) => item.id === debugId);
      previewDebug.worker = { ...previewDebug.worker,id:debugId,name:worker?.name ?? `示例机器人 ${debugId}`,intro:worker?.intro ?? previewDebug.worker.intro };
      previewDebug.sessionId = `example-debug-session-${debugId}`;
    }
    if (args['long-info'] && /\/workers\/\d+\/debug$/.test(scenario.route)) {
      previewDebug.worker.name += ' · 跨项目多机器人协作与自主验收长名称示例 ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      previewDebug.worker.executorName = '示例研发执行器 enterprise-long-workspace-executor-name';
      previewDebug.worker.providerId = 'example-compatible-enterprise-provider';
      previewDebug.worker.modelId = 'example/ultra-long-multi-agent-reasoning-model-2026-10';
      previewDebug.sessionId = 'example-very-long-session-identifier-2026-10-27';
    }
    if (scenario.fixtureVariant === 'task-feedback') {
      previewChat.task.status = '等待中';
      previewChat.task.subStatus = '待反馈';
      previewChat.rootTask = previewChat.task;
    }
    if (scenario.fixtureVariant === 'task-running') {
      const message = previewChat.messages.find((item) => item.id === 'msg-assistant');
      message.status = 'running';
      for (const tool of message.tools ?? []) tool.status = 'running';
    }
    if (scenario.fixtureVariant === 'debug-running') {
      previewDebug.status = 'running';
      for (const message of previewDebug.messages) if (message.role === 'assistant') message.status = 'running';
    }
    if (args['debug-empty'] && /\/workers\/\d+\/debug$/.test(scenario.route)) { previewDebug.status='idle'; previewDebug.messages=[]; previewDebug.todos=[]; }
    if (scenario.fixtureVariant === 'question-answered') {
      const question = previewChat.messages.find((item) => item.kind === 'question').question;
      question.state = 'answered';
      question.answers = [['保持当前长度']];
    }
    const errors = [];
    const consoleErrors = [];
    const unmatchedApi = [];
    const blockedWrites = [];
    const apiRequests = [];
    const viewport = forcedViewport || scenario.viewport || { width: 1440, height: 1000 };
    const context = await browser.newContext({ viewport, recordVideo: args.video ? { dir:videoDir, size:viewport } : undefined, deviceScaleFactor: 1, colorScheme: scenario.colorScheme || 'dark', reducedMotion: scenario.reducedMotion || 'no-preference', locale: 'zh-CN', timezoneId: 'Asia/Shanghai', serviceWorkers: 'block' });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await context.addInitScript(({ now, theme, data }) => {
      localStorage.setItem('theme', theme);
      // EventSource replacement is confined to this test browser. It models the
      // same snapshots as the real API and never opens a network connection.
      class FixtureEventSource extends EventTarget {
        static CONNECTING = 0; static OPEN = 1; static CLOSED = 2;
        CONNECTING = 0; OPEN = 1; CLOSED = 2;
        readyState = 0; withCredentials = false; onopen = null; onmessage = null; onerror = null;
        constructor(url) {
          super(); this.url = new URL(url, location.origin).href;
          this.timer = setTimeout(() => {
            if (this.readyState === 2) return;
            this.readyState = 1;
            const open = new Event('open'); this.onopen?.(open); this.dispatchEvent(open);
            const pathname = new URL(this.url).pathname;
            let payload = { type: 'ping', at: now };
            if (pathname === '/api/tasks/stream') payload = { type: 'snapshot', tasks: data.tasks, at: now };
            else if (/\/tasks\/\d+\/chat\/stream$/.test(pathname)) payload = { type: 'ready', at: now };
            else if (/\/workers\/\d+\/debug\/stream$/.test(pathname)) payload = { type: 'snapshot', snapshot: data.debug };
            else if (/\/(checks|tests|exports)\/runs\/\d+\/stream$/.test(pathname)) payload = data.run;
            const message = new MessageEvent('message', { data: JSON.stringify(payload), origin: location.origin });
            this.onmessage?.(message); this.dispatchEvent(message);
          }, 100);
        }
        close() { this.readyState = 2; clearTimeout(this.timer); }
      }
      window.EventSource = FixtureEventSource;
      window.__UI_PREVIEW_FIXTURE__ = true;
    }, { now: Date.parse(FIXED_NOW), theme: scenario.colorScheme || 'dark', data: { tasks, chat: previewChat, debug: previewDebug, run } });
    await context.route('**/api/**', async (route) => {
      const request = route.request();
      const method = request.method();
      const url = request.url();
      apiRequests.push({ method, path: new URL(url).pathname });
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        blockedWrites.push({ method, path: new URL(url).pathname });
        return route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ message: 'UI preview blocks all write requests' }) });
      }
      const pathname = new URL(url).pathname;
      if (pathname.endsWith('/stream')) {
        const stream = /\/workers\/\d+\/debug\/stream$/.test(pathname) ? { type: 'snapshot', snapshot: previewDebug } : streamFixture(url);
        return route.fulfill({ status: 200, contentType: 'text/event-stream', body: `data: ${JSON.stringify(stream)}\n\n` });
      }
      const fixture = pathname === '/api/tasks/1/chat' ? previewChat
        : pathname === '/api/tasks/1' ? previewChat.task
          : /^\/api\/workers\/\d+\/debug$/.test(pathname) ? previewDebug
            : apiFixture(url, { loggedIn: scenario.loggedIn !== false });
      if (fixture === undefined) {
        unmatchedApi.push(new URL(url).pathname);
        return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'No example fixture for this API' }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) });
    });
    await context.route('**/images/preview-example.svg', (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: exampleImage }));
    const result = { name: scenario.name, route: scenario.route, fixtureVariant: scenario.fixtureVariant ?? 'default', longInfo:!!args['long-info'],debugEmpty:!!args['debug-empty'], colorScheme: scenario.colorScheme || 'dark', reducedMotion: scenario.reducedMotion || 'no-preference', viewport, errors, consoleErrors, unmatchedApi, blockedWrites, apiRequests };
    try {
      await page.goto(new URL(scenario.route, base).href, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForSelector(scenario.loggedIn === false ? '[data-slot="card"]' : 'main :is(h1, h2, [data-slot="breadcrumb"], [data-slot="table"], header)', { timeout: 15000 });
      if (scenario.editor) await page.locator('.ProseMirror').first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
      result.initialSettleMs = Math.max(scenario.editor ? 1100 : 550, requestedSettleMs);
      await page.waitForTimeout(result.initialSettleMs);
      if (scenario.action === 'all-tasks') await page.getByRole('tab', { name: '所有任务', exact: true }).click();
      if (scenario.action === 'project-modal') await page.getByRole('button', { name: '新建项目', exact: true }).click();
      if (scenario.action === 'expand-log') await page.locator('button[aria-controls^="task-log-"]').first().click();
      if (scenario.action === 'hover-first-running') await page.locator('.task-board-card--running').first().hover();
      if (scenario.action === 'feedback-draft') {
        await page.locator('.ai-conversation textarea').fill('补充现有任务资料：按既定目录范围整理检索摘要。');
        await page.locator('.ai-conversation textarea').focus();
      }
      if (scenario.action === 'debug-running-draft') await page.locator('.ai-conversation textarea').fill('等待上一条回复');
      await page.waitForTimeout(350);
      if (scenario.conversationTop) {
        await page.locator('.ai-task-conversation .ai-conversation-viewport').evaluate((viewport) => viewport.scrollTo({ top: 0, behavior: 'instant' }));
        await page.waitForTimeout(100);
      }
      if (scenario.action === 'question-pending' || scenario.action === 'question-answered') {
        const question = page.locator('.ai-question-message').first();
        await question.scrollIntoViewIfNeeded();
        if (scenario.action === 'question-pending') {
          const submit = question.getByRole('button', { name: '提交回答', exact: true });
          const initialDisabled = await submit.isDisabled();
          await question.getByRole('button', { name: /保持当前长度/ }).click();
          await question.getByPlaceholder('也可以直接输入你的回答').fill('按既定摘要长度验证（界面示例，未提交）');
          const enabledAfterChoice = await submit.isEnabled();
          result.questionInteraction = { state: 'pending', initialDisabled, enabledAfterChoice, customInput: await question.getByPlaceholder('也可以直接输入你的回答').inputValue(), passed: initialDisabled && enabledAfterChoice, notice: 'An existing choice and local free-text input were used. Neither submit nor skip was invoked.' };
        } else {
          const receiptVisible = (await question.innerText()).includes('保持当前长度');
          const submitCount = await question.getByRole('button', { name: '提交回答', exact: true }).count();
          result.questionInteraction = { state: 'answered', receiptVisible, submitCount, passed: receiptVisible && submitCount === 0, notice: 'Answered state is a fictional in-memory HTTP snapshot, with no API reply request.' };
        }
        await page.waitForTimeout(300);
      }
      if (await page.locator('.ai-conversation').count()) {
        result.conversation = await page.locator('.ai-conversation').evaluate((panel) => {
          const viewport = panel.querySelector('.ai-conversation-viewport');
          const input = panel.querySelector('textarea');
          const send = panel.querySelector('.ai-composer-send');
          return { scrollTop: viewport?.scrollTop ?? null, messageCount: panel.querySelectorAll('.ai-message').length, activeGridCount: panel.querySelectorAll('.agent-activity').length, toolChipCount: panel.querySelectorAll('.ai-tool-chip').length, senderNames: [...panel.querySelectorAll('.ai-message-heading')].map((heading) => heading.textContent?.trim()), draft: input?.value ?? null, sendDisabled: send?.disabled ?? null, sendLabel: send?.getAttribute('aria-label') ?? null };
        });
        result.conversation.expected = (!scenario.conversationTop || result.conversation.scrollTop === 0)
          && (scenario.action !== 'feedback-draft' || result.conversation.sendDisabled === false)
          && (scenario.action !== 'debug-running-draft' || result.conversation.sendDisabled === true);
      }
      if (args['page-top'] && scenario.action !== 'question-pending' && scenario.action !== 'question-answered') {
        await page.evaluate(() => { for (const node of [document.scrollingElement,document.querySelector('main')]) if (node) node.scrollTop=0; });
        await page.waitForTimeout(100);
      }
      if (await page.locator('.ai-energy').count()) result.aiMotion = await sampleAiMotion(page);
      if (await page.locator('.rabbit-identity').count()) result.rabbitIdentity = await inspectRabbitIdentity(page);
      if (await page.locator('.ai-conversation').count()) result.conversationGeometry = await inspectConversationGeometry(page);
      if (scenario.action === 'hover-first-running') {
        result.firstRunningCardHover = await page.locator('.task-board-card--running').first().evaluate((card) => {
          const list = card.closest('.task-board-column-list');
          const cardRect = card.getBoundingClientRect();
          const listRect = list?.getBoundingClientRect();
          const clearance = listRect ? cardRect.top - listRect.top : null;
          return { listTop: listRect?.top ?? null, cardTop: cardRect.top, topClearance: clearance, minimumClearance: 2, passed: clearance !== null && clearance >= 2 };
        });
      }
      if (scenario.route === '/tasks/list' && scenario.action !== 'all-tasks') {
        const glow = page.locator('.border-glow').first();
        if (await glow.count()) {
          const before = await glow.evaluate((node) => getComputedStyle(node).getPropertyValue('--task-ring-angle').trim());
          await page.waitForTimeout(270);
          const after = await glow.evaluate((node) => getComputedStyle(node).getPropertyValue('--task-ring-angle').trim());
          result.borderGlow = { property: '--task-ring-angle', before, after, changed: before !== after, reducedMotion: scenario.reducedMotion === 'reduce', explicitUserMotionPreference: true, expected: before !== after, preferenceNotice: 'The user explicitly requested a continuous rotating Gemini color ring, including when the browser reports a preference for reduced motion.' };
        } else {
          result.borderGlow = { property: '--task-ring-angle', expected: false, reason: 'No Gemini color ring found' };
        }
        result.taskMotionTiming = await page.locator('.border-glow').evaluateAll((glows) => {
          const cards = glows.map((glow) => {
            const card = glow.closest('.task-board-card') ?? glow;
            const style = getComputedStyle(glow);
            const ring = glow.querySelector('.border-glow__ring');
            const aura = glow.querySelector('.border-glow__aura');
            const angle = style.getPropertyValue('--task-ring-angle').trim();
            const ringAngle = ring ? getComputedStyle(ring).getPropertyValue('--task-ring-angle').trim() : null;
            const auraAngle = aura ? getComputedStyle(aura).getPropertyValue('--task-ring-angle').trim() : null;
            const log = card.querySelector('.task-board-card-log');
            const logGridCell = log?.querySelector('.task-log-activity > span:first-child');
            const logStyle = logGridCell ? getComputedStyle(logGridCell) : null;
            const rect = card.getBoundingClientRect();
            return { href: card.querySelector('.task-board-card-link')?.getAttribute('href') ?? null, phase: style.getPropertyValue('--task-motion-phase').trim(), duration: style.getPropertyValue('--task-motion-duration').trim(), delay: style.getPropertyValue('--task-motion-delay').trim(), angle, ringAngle, auraAngle, layersInSync: angle !== '' && ringAngle === angle && auraAngle === angle, logTimingSource: '.task-board-card-log .task-log-activity > span:first-child', logDelay: logStyle?.animationDelay ?? null, logDuration: logStyle?.animationDuration ?? null, logAnimationName: logStyle?.animationName ?? null, logGridCellCount: log?.querySelectorAll('.task-log-activity > span').length ?? 0, visibleInViewport: rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth };
          });
          const distinct = (rows, key) => rows.every((row) => row[key] !== null && row[key] !== '') && new Set(rows.map((row) => row[key])).size === rows.length;
          const visible = cards.filter((card) => card.visibleInViewport);
          const keys = ['phase', 'duration', 'delay', 'logDelay'];
          const allCardsHaveDistinctTiming = cards.length > 0 && keys.every((key) => distinct(cards, key));
          const visibleCardsHaveDistinctTiming = visible.length > 1 ? keys.every((key) => distinct(visible, key)) : null;
          return { cards, checkedProperties: keys, allCardsHaveDistinctTiming, allLayersInSync: cards.length > 0 && cards.every((card) => card.layersInSync), visibleCardCount: visible.length, visibleCardsHaveDistinctTiming, visibleCheckNotice: visible.length > 1 ? 'Compared every simultaneously visible running card.' : 'Fewer than two running cards are visible; timing uniqueness is checked across all mounted running cards.' };
        });
        const testedLinks = scenario.action === 'hover-first-running' ? '.task-board-card--running .task-board-card-link' : '.task-board-card-link';
        result.taskLinkHitTest = await page.locator(testedLinks).evaluateAll((links) => {
          const candidate = links.map((node) => {
            const rect = node.getBoundingClientRect();
            const x = rect.x + rect.width / 2;
            const y = rect.y + Math.min(24, rect.height / 2);
            const style = getComputedStyle(node);
            const visible = rect.width > 0 && rect.height > 0
              && rect.left >= 0 && rect.top >= 0
              && rect.right <= innerWidth && rect.bottom <= innerHeight
              && x >= 0 && x < innerWidth && y >= 0 && y < innerHeight
              && style.display !== 'none' && style.visibility !== 'hidden';
            return { node, x, y, visible };
          }).find((item) => item.visible);
          if (!candidate) return { href: null, hitHref: null, visible: false, passed: false, reason: 'No task card link is fully visible in the viewport' };
          const hit = document.elementFromPoint(candidate.x, candidate.y);
          return { href: candidate.node.getAttribute('href'), hitHref: hit?.closest('a')?.getAttribute('href') ?? null, visible: true, passed: hit?.closest('a') === candidate.node };
        });
        result.expandedLogs = await page.locator('button[aria-controls^="task-log-"][aria-expanded="true"]').count();
        if (scenario.action === 'hover-first-running') {
          result.surfaceEffects = await page.locator('.task-board-card--running .task-board-card-surface').first().evaluate((surface) => {
            const overlay = getComputedStyle(surface, '::after');
            const x = surface.style.getPropertyValue('--pointer-x');
            const y = surface.style.getPropertyValue('--pointer-y');
            return { pointerX: x, pointerY: y, overlayPointerEvents: overlay.pointerEvents, overlayOpacity: overlay.opacity, expected: x !== '' && y !== '' && overlay.pointerEvents === 'none' && Number(overlay.opacity) > 0 };
          });
        }
      }
      if (args['premium-checks']) result.premiumInteractions = await inspectPremiumInteractions(page,scenario);
      if (args['symbol-checks']) result.symbolMotion = await inspectSymbolMotion(page);
      result.url = page.url();
      const heading = page.locator('main h1, main h2').first();
      result.title = await heading.count() ? await heading.textContent() : scenario.loggedIn === false ? '登录' : scenario.name;
      result.bodyText = (await page.locator('body').innerText()).slice(0, 500);
      result.menuIconColors = await page.locator('.square-sidebar [data-slot="navigation-link"]').evaluateAll((links) => links.map((link) => ({ href: link.getAttribute('href'), label: link.textContent?.trim(), color: link.querySelector('svg') ? getComputedStyle(link.querySelector('svg')).color : null })));
      const iconColorCount = new Set(result.menuIconColors.map((item) => item.color).filter(Boolean)).size;
      result.menuIconColorCount = iconColorCount;
      if (scenario.route.startsWith('/tasks')) result.taskMenuHasSixColors = result.menuIconColors.length === 6 && iconColorCount === 6;
      result.layout = await page.evaluate(() => {
        const main = document.querySelector('main');
        const outside = [...document.querySelectorAll('body *')].filter((node) => {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          if (!rect.width || !rect.height || style.position === 'absolute' || style.position === 'fixed' || style.visibility === 'hidden' || style.display === 'none') return false;
          if (node.closest('[role="dialog"], [data-slot="tabs-content"][hidden]')) return false;
          const ancestor = node.parentElement;
          if (ancestor && ['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(ancestor).overflowX)) return false;
          return rect.right > innerWidth + 1 || rect.left < -1;
        }).slice(0, 18).map((node) => ({ tag: node.tagName, slot: node.getAttribute('data-slot'), className: String(node.className).slice(0, 150), text: node.textContent?.slice(0, 70), width: Math.round(node.getBoundingClientRect().width), right: Math.round(node.getBoundingClientRect().right) }));
        return { viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, mainWidth: main?.clientWidth ?? null, mainScrollWidth: main?.scrollWidth ?? null, overflowCandidates: outside, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, theme: document.documentElement.className, cardCount: document.querySelectorAll('[data-slot="card"], .group\\/card article').length, tableRows: document.querySelectorAll('tbody tr').length };
      });
      // Pause at a fixed visible animation phase for reproducible screenshots.
      // The inspected animation list records whether reduced-motion disabled it.
      result.animations = await page.evaluate(() => document.getAnimations().map((animation) => ({ name: animation.animationName || 'web-animation', state: animation.playState, duration: animation.effect?.getTiming().duration })).slice(0, 50));
      result.knownConsoleWarnings = consoleErrors.filter((message) => /same key/.test(message) && scenario.route === '/tasks/1').map((message) => ({ message, source: 'Existing TaskPackageDetailPage uses key={taskId} for both sibling chat and side panels.' }));
      result.knownConsoleWarnings.push(...consoleErrors.filter((message) => /button/.test(message) && scenario.name === 'projects-modal').map((message) => ({ message, source: 'Existing ProjectsPage DialogClose wraps Button.' })));
      result.unexpectedConsoleErrors = consoleErrors.filter((message) => !result.knownConsoleWarnings.some((warning) => warning.message === message));
      if (args.video) { const stableCaptureMs=Number(args['video-ms'] || 4400); if(!Number.isFinite(stableCaptureMs)||stableCaptureMs<1000||stableCaptureMs>30000)throw new Error('video-ms must be between 1000 and 30000'); result.video = { rawPath:await page.video().path(), stableCaptureMs, animationNotice:'All runtime CSS animations continue during this capture.' }; await page.waitForTimeout(stableCaptureMs); }
      else await page.evaluate(() => { for (const animation of document.getAnimations()) { if (animation.effect?.getTiming().iterations === Infinity) { animation.currentTime = 900; animation.pause(); } } });
      if (args.screenshots !== 'none') { result.screenshot = path.join(screenshotDir, `${scenario.name}.png`); await page.screenshot({ path: result.screenshot, fullPage: false }); }
      const failedVisualCheck = [result.borderGlow?.expected, result.taskMotionTiming?.allCardsHaveDistinctTiming, result.taskMotionTiming?.allLayersInSync,result.taskMotionTiming?.visibleCardsHaveDistinctTiming, result.taskLinkHitTest?.passed, result.firstRunningCardHover?.passed, result.surfaceEffects?.expected, result.taskMenuHasSixColors, result.conversation?.expected, result.premiumInteractions?.passed, result.questionInteraction?.passed, result.aiMotion?.passed,result.rabbitIdentity?.passed,result.conversationGeometry?.passed,result.symbolMotion?.passed].some((value) => value === false);
      result.status = errors.length || unmatchedApi.length || blockedWrites.length || failedVisualCheck ? 'needs-review' : 'captured';
      console.log(JSON.stringify({ name: scenario.name, status: result.status, pageErrors: errors.length, unmatchedApi: unmatchedApi.length, overflow: result.layout.documentWidth > result.layout.viewportWidth + 1 }));
    } catch (error) {
      result.status = 'failed'; result.failure = error.message;
      console.log(JSON.stringify({ name: scenario.name, status: 'failed', error: error.message.slice(0, 240) }));
      if (args.screenshots !== 'none') await page.screenshot({ path: path.join(screenshotDir, `${scenario.name}-failed.png`) }).catch(() => {});
    } finally {
      report.scenarios = report.scenarios.filter((item) => item.name !== result.name);
      report.scenarios.push(result);
      await context.close().catch(() => {});
    }
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  }
} finally {
  await browser.close();
  report.finishedAt = new Date().toISOString();
  report.summary = { total: report.scenarios.length, captured: report.scenarios.filter((item) => item.status === 'captured').length, needsReview: report.scenarios.filter((item) => item.status === 'needs-review').length, failed: report.scenarios.filter((item) => item.status === 'failed').length };
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ report: reportPath, ...report.summary }));
if (report.summary.failed || report.summary.needsReview) process.exitCode = 1;
