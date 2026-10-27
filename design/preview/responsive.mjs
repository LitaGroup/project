/**
 * Isolated responsive audit. All data is explicitly fictional and all API
 * requests are intercepted. No backend, business writes, or user tabs are used.
 *
 * node design/preview/responsive.mjs
 * node design/preview/responsive.mjs --sizes=360 --screenshots=all --output=work/responsive-audit/screenshots --report=work/responsive-audit/report.json
 * node design/preview/responsive.mjs --only=projects,project-detail --merge
 */
import { chromium } from '/Users/jerry/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiFixture, streamFixture, FIXED_NOW, exampleImage, tasks, debug, run } from './fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = Object.fromEntries(process.argv.slice(2).map((arg) => { const [key, ...rest] = arg.replace(/^--/, '').split('='); return [key, rest.join('=') || true]; }));
const base = String(args.base || 'http://localhost:5273');
const output = path.resolve(root, String(args.output || 'design/responsive/screenshots'));
const reportPath = path.resolve(root, String(args.report || 'design/responsive/report.json'));
const selected = args.only ? new Set(String(args.only).split(',')) : null;
const sizes = [
  { width: 360, height: 800 }, { width: 390, height: 844 },
  { width: 768, height: 1024 }, { width: 1024, height: 768 },
  { width: 1280, height: 800 }, { width: 1920, height: 1080 },
].filter((size) => !args.sizes || String(args.sizes).split(',').includes(String(size.width)));
const scenarios = [
  { name: 'overview', route: '/' },
  { name: 'projects', route: '/projects' },
  { name: 'project-detail', route: '/projects/1' },
  { name: 'documents', route: '/documents' },
  { name: 'document-detail', route: '/documents/1', editor: true },
  { name: 'document-apipost', route: '/documents/4', fixtureVariant: 'apipost' },
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
  { name: 'login', route: '/login', loggedIn: false },
  { name: 'projects-modal', route: '/projects', dialog: '新建项目' },
  { name: 'overview-bottom', route: '/', bottom: true },
  { name: 'project-checks-section', route: '/projects/1', heading: '检查' },
  { name: 'project-branches-modal', route: '/projects/1', dialog: '分支', addBranchRow: true },
  { name: 'project-release-modal', route: '/projects/1', dialog: '提测' },
  { name: 'project-schedules-section', route: '/projects/1', heading: '定时任务' },
  { name: 'project-defects-section', route: '/projects/1', heading: '缺陷' },
  { name: 'project-releases-section', route: '/projects/1', heading: '提测记录' },
  { name: 'knowledge-move-modal', route: '/docs/detail/guides/agent-workflow', editor: true, dialog: '移动' },
  { name: 'knowledge-directory-modal', route: '/docs/detail/', dialog: '新建目录' },
  { name: 'defect-create-modal', route: '/defects', dialog: '新建缺陷' },
  { name: 'profile-reset-modal', route: '/profile', dialog: '重置' },
  { name: 'settings-bottom', route: '/settings', bottom: true },
].filter((scenario) => !selected || selected.has(scenario.name));
const representative = new Set([
  'projects@360', 'project-detail@390', 'document-detail@360',
  'knowledge-browser@390', 'knowledge-article@768', 'knowledge-search@360',
  'defects@390', 'defect-detail@360', 'check-run@768', 'test-run@1024',
  'export-run@1280', 'schedule-detail@390', 'resources@360',
  'apps@390', 'settings@360', 'settings-bottom@390', 'profile@360',
  'repos@768', 'users@1920', 'projects-modal@360',
  'knowledge-move-modal@390', 'defect-create-modal@360', 'profile-reset-modal@360',
  'project-checks-section@1024', 'overview@1920',
]);
representative.delete('users@1920');
representative.delete('settings-bottom@390');
representative.add('project-branches-modal@360');
representative.add('project-release-modal@390');
representative.delete('project-checks-section@1024');
representative.add('document-detail@1024');
representative.delete('knowledge-move-modal@390');
representative.delete('resources@360');
representative.add('document-apipost@360');
representative.add('document-apipost@1280');
await mkdir(output, { recursive: true });
await mkdir(path.dirname(reportPath), { recursive: true });
const previous = args.merge ? await readFile(reportPath, 'utf8').then(JSON.parse).catch(() => null) : null;
async function sourceFingerprint() {
  const files = ['frontend/src/index.css', 'frontend/src/main.tsx', 'frontend/src/components/Layout.tsx', 'frontend/src/components/ResponsiveTable.tsx', ...(await readdir(path.join(root, 'frontend/src/styles'))).filter((name) => name.endsWith('.css')).map((name) => `frontend/src/styles/${name}`), ...(await readdir(path.join(root, 'frontend/src/pages'))).filter((name) => name.endsWith('.tsx')).map((name) => `frontend/src/pages/${name}`)].sort();
  const hash = createHash('sha256');
  for (const file of files) hash.update(file).update(await readFile(path.join(root, file)));
  return hash.digest('hex');
}
const auditRuns = [...(previous?.auditRuns ?? [])];
if (previous) auditRuns.push({ startedAt: previous.startedAt, finishedAt: previous.finishedAt, summary: previous.summary, sourceFingerprint: previous.sourceFingerprint, finishedSourceFingerprint: previous.finishedSourceFingerprint, sourceChangedDuringAudit: previous.sourceChangedDuringAudit });
const report = { fixtureNotice: 'All data is fictional. Every API request is intercepted, every write is blocked, and SSE is confined to an isolated headless browser.', startedAt: new Date().toISOString(), sourceFingerprint: await sourceFingerprint(), base, viewports: [...new Map([...(previous?.viewports ?? []), ...sizes].map((size) => [size.width, size])).values()].sort((a,b) => a.width-b.width), scenarioCount: scenarios.length, selectedScenarioCount: scenarios.length, cases: previous?.cases ?? [], auditRuns, baselineComparison: previous?.baselineComparison ?? null, validationNotice: args.note ? String(args.note) : previous?.validationNotice ?? null, auditNotice: 'Heuristics flag clipped controls/content for visual review. Intentional scroll containers and truncation are recorded separately, rather than counted as document overflow.' };
const browser = await chromium.launch({ executablePath: '/Users/jerry/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', headless: true });
let interrupted = false;
process.once('SIGINT', () => { interrupted = true; void browser.close(); });

function auditDOM() {
  const round = (n) => Math.round(n * 10) / 10;
  const rectData = (r) => ({ x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height), right: round(r.right), bottom: round(r.bottom) });
  const label = (node) => (node.getAttribute('aria-label') || node.getAttribute('placeholder') || node.innerText || node.getAttribute('title') || node.getAttribute('data-slot') || node.tagName).trim().slice(0, 100);
  const visible = (node) => { const r = node.getBoundingClientRect(); const s = getComputedStyle(node); if (r.width <= 0.5 || r.height <= 0.5 || s.display === 'none' || s.visibility === 'hidden' || node.closest('[hidden], [inert], [aria-hidden="true"]')) return false; for (let parent = node; parent; parent = parent.parentElement) if (Number(getComputedStyle(parent).opacity) === 0) return false; return true; };
  const describe = (node) => ({ tag: node.tagName.toLowerCase(), slot: node.getAttribute('data-slot'), className: String(node.className).slice(0, 160), label: label(node), rect: rectData(node.getBoundingClientRect()), opacity: getComputedStyle(node).opacity, pointerEvents: getComputedStyle(node).pointerEvents });
  const main = document.querySelector('main') || document.body;
  const activeDialog = document.querySelector('[role="dialog"], [role="alertdialog"]');
  const scope = activeDialog || main;
  const controls = [...scope.querySelectorAll('button,input:not([type="hidden"]),textarea,select,a[href],[role="tab"],[role="combobox"]')].filter(visible);
  const clippedControls = [], intentionalTruncations = [], narrowInputs = [], hitTestFailures = [];
  for (const control of controls) {
    const r = control.getBoundingClientRect();
    let scrollX = false, scrollY = false, fullyInsideClips = true;
    for (let parent = control.parentElement; parent && parent !== document.documentElement; parent = parent.parentElement) {
      const s = getComputedStyle(parent), p = parent.getBoundingClientRect();
      const xScroll = ['auto', 'scroll'].includes(s.overflowX) && parent.scrollWidth > parent.clientWidth + 2;
      const yScroll = ['auto', 'scroll'].includes(s.overflowY) && parent.scrollHeight > parent.clientHeight + 2;
      scrollX ||= xScroll; scrollY ||= yScroll;
      if (['auto','scroll','hidden','clip'].includes(s.overflowX) && (r.left < p.left - 1 || r.right > p.right + 1)) fullyInsideClips = false;
      if (['auto','scroll','hidden','clip'].includes(s.overflowY) && (r.top < p.top - 1 || r.bottom > p.bottom + 1)) fullyInsideClips = false;
      const xClip = !scrollX && ['hidden', 'clip'].includes(s.overflowX) && (r.left < p.left - 3 || r.right > p.right + 3);
      const yClip = !scrollY && ['hidden', 'clip'].includes(s.overflowY) && (r.top < p.top - 3 || r.bottom > p.bottom + 3);
      if (xClip || yClip) {
        const record = { ...describe(control), axis: [xClip && 'x', yClip && 'y'].filter(Boolean), clippedBy: describe(parent) };
        if (control.tagName === 'A' && xClip && !yClip && (s.textOverflow === 'ellipsis' || parent.classList.contains('truncate'))) intentionalTruncations.push({ ...record, reason: 'Existing link preview intentionally uses ellipsis; the visible link remains clickable.' });
        else clippedControls.push(record);
        break;
      }
    }
    if (control.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="number"]),textarea') && r.width < 100) narrowInputs.push(describe(control));
    if (fullyInsideClips && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && !control.disabled) {
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      if (hit && !control.contains(hit) && !hit.contains(control)) {
        const covering = hit.closest('button,a,input,textarea,[role="combobox"]') || hit;
        if (!control.contains(covering)) hitTestFailures.push({ ...describe(control), coveredBy: describe(covering) });
      }
    }
  }
  const scrollRegions = [...scope.querySelectorAll('*')].filter((node) => {
    if (!visible(node)) return false;
    const s = getComputedStyle(node);
    return (['auto', 'scroll'].includes(s.overflowX) && node.scrollWidth > node.clientWidth + 2) || (['auto', 'scroll'].includes(s.overflowY) && node.scrollHeight > node.clientHeight + 2);
  }).map((node) => ({ ...describe(node), clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight, overflowX: getComputedStyle(node).overflowX, overflowY: getComputedStyle(node).overflowY }));
  const clippedContent = [...scope.querySelectorAll('h1,h2,h3,p,pre,code,.ProseMirror,[data-slot="card-content"]')].filter((node) => {
    if (!visible(node) || node.clientWidth < 1) return false;
    const s = getComputedStyle(node);
    return node.scrollWidth > node.clientWidth + 4 && ['hidden','clip'].includes(s.overflowX) && s.textOverflow !== 'ellipsis' && !node.classList.contains('truncate');
  }).map(describe);
  const tableReachability = [...scope.querySelectorAll('.responsive-table-scroll')].filter(visible).map((scroller) => {
    const initialScroll = scroller.scrollLeft;
    scroller.scrollLeft = scroller.scrollWidth;
    const bounds = scroller.getBoundingClientRect();
    const lastHeader = scroller.querySelector('thead tr:first-child > :last-child');
    const lastCell = scroller.querySelector('tbody tr:first-child > :last-child');
    const last = lastHeader || lastCell;
    const r = last?.getBoundingClientRect();
    const actions = [...(lastCell?.querySelectorAll('button,a,[role="combobox"]') || [])].filter(visible).map((control) => {
      const cr = control.getBoundingClientRect();
      const inViewport = cr.left >= 0 && cr.right <= innerWidth && cr.top >= 0 && cr.bottom <= innerHeight;
      const hit = inViewport ? document.elementFromPoint(cr.x + cr.width / 2, cr.y + cr.height / 2) : null;
      return { ...describe(control), inViewport, horizontalPassed: cr.left >= bounds.left - 2 && cr.right <= bounds.right + 2, hitPassed: hit ? control.contains(hit) || hit.contains(control) : null };
    });
    const result = { ...describe(scroller), clientWidth: scroller.clientWidth, scrollWidth: scroller.scrollWidth, reachedScrollLeft: scroller.scrollLeft, lastColumn: last ? label(last) : null, rightEdgeReachable: !!r && r.right <= bounds.right + 2 && r.right > bounds.left, lastColumnActions: actions };
    scroller.scrollLeft = initialScroll;
    return result;
  });
  const toolbarSlots = [...scope.querySelectorAll('[data-slot="toolbar"],[data-slot="toolbar-group"],[data-slot="toolbar-input"],[data-slot="toolbar-button"]')].filter(visible).map(describe);
  const rgb = (value) => value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  const luminance = (color) => color.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, index) => sum + v * [0.2126,0.7152,0.0722][index], 0);
  const editorContrast = [...scope.querySelectorAll('.md-editor .ProseMirror :is(p,h1,h2,h3,li)')].filter(visible).slice(0, 12).map((node) => {
    const color = getComputedStyle(node).color;
    let background = 'rgb(10, 10, 10)';
    for (let parent = node; parent; parent = parent.parentElement) { const bg = getComputedStyle(parent).backgroundColor; if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') { background = bg; break; } }
    const fg = rgb(color), bg = rgb(background);
    const ratio = fg && bg ? (Math.max(luminance(fg),luminance(bg)) + 0.05) / (Math.min(luminance(fg),luminance(bg)) + 0.05) : null;
    return { ...describe(node), color, background, contrast: ratio === null ? null : round(ratio) };
  });
  const dialogBounds = activeDialog ? rectData(activeDialog.getBoundingClientRect()) : null;
  const dialogOutsideViewport = !!dialogBounds && (dialogBounds.x < -1 || dialogBounds.right > innerWidth + 1 || dialogBounds.y < -1 || dialogBounds.bottom > innerHeight + 1);
  const documentOverflow = document.documentElement.scrollWidth > innerWidth + 1;
  const mainOverflow = main.scrollWidth > main.clientWidth + 1;
  return { viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, mainWidth: main.clientWidth, mainScrollWidth: main.scrollWidth, documentOverflow, mainOverflow, workspace: { className: main.className, dataSection: main.getAttribute('data-section'), containerName: getComputedStyle(main).containerName, containerType: getComputedStyle(main).containerType }, theme: document.documentElement.className, activeDialog: activeDialog ? label(activeDialog).slice(0, 100) : null, dialogBounds, dialogOutsideViewport, controls: controls.length, clippedControls, intentionalTruncations, narrowInputs, hitTestFailures, clippedContent, scrollRegions, tableReachability, toolbarSlots, editorContrast, lowEditorContrast: editorContrast.filter((sample) => sample.contrast !== null && sample.contrast < 3), panels: [...scope.querySelectorAll('.responsive-detail-main,.responsive-detail-sidebar,.knowledge-directory-sidebar,.knowledge-directory-content,.knowledge-article-heading,.overview-card-grid')].filter(visible).map(describe), headings: [...scope.querySelectorAll('h1,h2,h3')].filter(visible).map(describe) };
}

async function capture(scenario, viewport) {
  const id = `${scenario.name}@${viewport.width}`;
  const result = { id, name: scenario.name, route: scenario.route, fixtureVariant: scenario.fixtureVariant ?? 'default', viewport, startedAt: new Date().toISOString(), errors: [], consoleErrors: [], unmatchedApi: [], blockedWrites: [], failedResources: [] };
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: 'dark', locale: 'zh-CN', timezoneId: 'Asia/Shanghai', serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', (error) => result.errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') result.consoleErrors.push(message.text()); });
  page.on('response', (response) => { if (response.status() >= 400) result.failedResources.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  try {
    await context.addInitScript(({ data, now }) => {
      localStorage.setItem('theme', 'dark'); window.__UI_PREVIEW_FIXTURE__ = true;
      window.EventSource = class extends EventTarget {
        constructor(url) { super(); this.readyState = 0; this.timer = setTimeout(() => { this.readyState = 1; this.onopen?.(new Event('open')); const p = new URL(url, location.origin).pathname; const payload = p === '/api/tasks/stream' ? { type: 'snapshot', tasks: data.tasks, at: now } : /\/debug\/stream$/.test(p) ? { type: 'snapshot', snapshot: data.debug } : /\/(checks|tests|exports)\/runs\/\d+\/stream$/.test(p) ? data.run : { type: 'ready', at: now }; this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(payload) })); }, 100); }
        close() { clearTimeout(this.timer); this.readyState = 2; }
      };
    }, { data: { tasks, debug, run }, now: Date.parse(FIXED_NOW) });
    await context.route('**/api/**', async (route) => {
      const request = route.request(), url = request.url(), pathname = new URL(url).pathname;
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { result.blockedWrites.push({ method: request.method(), path: pathname }); return route.fulfill({ status: 405, contentType: 'application/json', body: '{"message":"Responsive audit blocks all writes"}' }); }
      if (pathname.endsWith('/stream')) return route.fulfill({ status: 200, contentType: 'text/event-stream', body: `data: ${JSON.stringify(streamFixture(url))}\n\n` });
      const fixture = apiFixture(url, { loggedIn: scenario.loggedIn !== false });
      if (fixture === undefined) result.unmatchedApi.push(pathname);
      return route.fulfill({ status: fixture === undefined ? 404 : 200, contentType: 'application/json', body: JSON.stringify(fixture ?? { message: 'No example fixture for this API' }) });
    });
    await context.route('**/images/preview-example.svg', (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: exampleImage }));
    await page.goto(new URL(scenario.route, base).href, { waitUntil: 'networkidle', timeout: 30000 });
    await page.locator(scenario.loggedIn === false ? '[data-slot="card"]' : 'main :is(h1,h2,[data-slot="breadcrumb"],[data-slot="table"],header)').first().waitFor({ timeout: 15000 });
    if (scenario.editor) await page.locator('.ProseMirror').first().waitFor({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(scenario.editor ? 600 : 150);
    if (scenario.dialog) { await page.getByRole('button', { name: scenario.dialog, exact: true }).first().click(); await page.locator('[role="dialog"],[role="alertdialog"]').waitFor(); }
    if (scenario.addBranchRow) await page.getByRole('dialog').getByRole('button', { name: '添加一行', exact: true }).click();
    if (scenario.heading) await page.getByRole('heading', { name: scenario.heading, exact: true }).scrollIntoViewIfNeeded();
    if (scenario.bottom) await page.evaluate(() => { const main = document.querySelector('main'); for (const node of [document.scrollingElement,main,document.querySelector('.square-page')]) if (node) node.scrollTop = node.scrollHeight; });
    await page.waitForTimeout(300);
    result.dom = await page.evaluate(auditDOM);
    if (scenario.fixtureVariant === 'apipost') {
      const sidebar = page.locator('.responsive-apipost-sidebar');
      const search = sidebar.getByPlaceholder('搜索路径 / 摘要…');
      const endpoints = sidebar.locator('button[title]');
      result.apipostInteractions = { initialEndpointCount: await endpoints.count() };
      await search.fill('创建');
      result.apipostInteractions.filteredCount = await endpoints.count();
      await endpoints.first().click();
      await page.waitForTimeout(150);
      result.apipostInteractions.postBodyVisible = await page.locator('.responsive-apipost-content').getByText('请求体', { exact: true }).count() > 0;
      result.apipostInteractions.postResponseVisible = await page.locator('.responsive-apipost-content').getByText('响应', { exact: true }).count() > 0;
      await search.fill('');
      result.apipostInteractions.restoredCount = await endpoints.count();
      await endpoints.first().click();
      await page.waitForTimeout(150);
      result.apipostInteractions.passed = result.apipostInteractions.initialEndpointCount === 14 && result.apipostInteractions.filteredCount === 1 && result.apipostInteractions.restoredCount === 14 && result.apipostInteractions.postBodyVisible && result.apipostInteractions.postResponseVisible;
    }
    if (scenario.name === 'document-detail') {
      const toc = page.locator('[aria-label="文档目录"]');
      if (viewport.width >= 1024 && await toc.count() === 0) await page.waitForTimeout(5000);
      const tocVisible = await toc.count() > 0 && await toc.isVisible();
      result.documentToc = { visible: tocVisible, expectedVisible: viewport.width >= 1024, linkCount: await toc.locator('a[href^="#"]').count() };
      result.documentToc.diagnostics = await page.evaluate(() => ({ nativeHeadingCount: document.querySelectorAll('.milkdown .ProseMirror > :is(h1,h2,h3,h4,h5,h6)').length, renderedHeadings: [...document.querySelectorAll('.ProseMirror :is(h1,h2,h3,h4,h5,h6)')].slice(0, 6).map((heading) => ({ tag: heading.tagName, id: heading.id, parentTag: heading.parentElement?.tagName, parentClass: heading.parentElement?.className, outerHTML: heading.outerHTML.slice(0, 200) })) }));
      if (tocVisible) {
        const link = toc.locator('a[href^="#"]').last();
        const href = await link.getAttribute('href');
        await link.click();
        await page.waitForTimeout(500);
        result.documentToc.clickedHref = href;
        result.documentToc.hashUpdated = decodeURIComponent(new URL(page.url()).hash) === href;
        result.documentToc.targetExists = await page.evaluate((id) => !!document.getElementById(id), href.slice(1));
        await page.evaluate(() => { for (const node of [document.scrollingElement, ...document.querySelectorAll('main, main *')]) if (node?.scrollTop) node.scrollTop = 0; history.replaceState(null, '', location.pathname + location.search); });
        await page.waitForTimeout(100);
      }
      result.documentToc.passed = tocVisible === result.documentToc.expectedVisible && (!tocVisible || (result.documentToc.hashUpdated && result.documentToc.targetExists));
      if (!tocVisible && result.documentToc.expectedVisible) {
        result.knownBaselineIssues = [{ id: 'document-toc-initial-mount', initialPassed: result.documentToc.passed, notice: 'The current and original HEAD DocumentDetailPage modules both render zero TOC nodes after five seconds despite four heading IDs. Editing an existing heading without saving triggers the existing anchorEpoch path in both modules. Initial behavior is preserved; post-edit layout and clicks are checked separately.' }];
        await page.locator('.ProseMirror h1').first().click();
        await page.keyboard.press('End');
        await page.keyboard.insertText(' · 尺寸验证示例');
        await page.waitForTimeout(600);
        const visibleAfterEdit = await toc.count() > 0 && await toc.isVisible();
        result.documentTocAfterEdit = { activation: 'Edited the existing h1 in this isolated browser; the document was never saved.', visible: visibleAfterEdit, linkCount: await toc.locator('a[href^="#"]').count() };
        if (visibleAfterEdit) {
          let snapshot;
          for (let attempt = 0; attempt < 10; attempt++) {
            snapshot = await page.evaluate(() => {
              const nav = document.querySelector('[data-slot="toc"]');
              if (!nav) return null;
              const r = nav.getBoundingClientRect(), main = document.querySelector('main').getBoundingClientRect(), editor = document.querySelector('.document-editor-surface').getBoundingClientRect();
              const layout = { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, placement: r.bottom <= editor.top + 2 ? 'above-editor' : 'beside-editor', withinWorkspace: r.width > 0 && r.left >= main.left - 1 && r.right <= main.right + 1 };
              const point = [...nav.querySelectorAll('a[href^="#"]')].map((node) => { const cr = node.getBoundingClientRect(), href = node.getAttribute('href'), x = cr.x + Math.min(40, cr.width / 2), y = cr.y + cr.height / 2; const hit = document.elementFromPoint(x,y); return { href, x, y, passed: !!document.getElementById(decodeURIComponent(href.slice(1))) && x >= r.left && x <= r.right && y >= Math.max(r.top,main.top,0) && y <= Math.min(r.bottom,main.bottom,innerHeight) && !!hit && node.contains(hit) }; }).find((candidate) => candidate.passed) ?? null;
              return { layout, point };
            });
            if (snapshot?.layout.withinWorkspace && snapshot.point) break;
            await page.waitForTimeout(50);
          }
          result.documentTocAfterEdit.layout = snapshot?.layout ?? null;
          const point = snapshot?.point;
          result.documentTocAfterEdit.linkHitPassed = !!point;
          result.documentTocAfterEdit.interactionMethod = 'Real pointer click at an in-viewport link point verified by elementFromPoint; existing TOC nodes may remount during editing.';
          if (point) {
            await page.mouse.click(point.x, point.y);
            await page.waitForTimeout(500);
            result.documentTocAfterEdit.clickedHref = point.href;
            result.documentTocAfterEdit.hashUpdated = decodeURIComponent(new URL(page.url()).hash) === decodeURIComponent(point.href);
            result.documentTocAfterEdit.targetExists = await page.evaluate((id) => !!document.getElementById(id), decodeURIComponent(point.href.slice(1)));
          }
          await page.evaluate(() => { for (const node of [document.scrollingElement, ...document.querySelectorAll('main, main *')]) if (node?.scrollTop) node.scrollTop = 0; history.replaceState(null, '', location.pathname + location.search); });
          await page.waitForTimeout(150);
        }
        result.documentTocAfterEdit.passed = visibleAfterEdit && result.documentTocAfterEdit.linkCount > 0 && result.documentTocAfterEdit.layout?.withinWorkspace && result.documentTocAfterEdit.linkHitPassed && result.documentTocAfterEdit.hashUpdated && result.documentTocAfterEdit.targetExists;
      }
    }
    const filter = page.locator('[data-slot="toolbar"] [aria-haspopup="listbox"]').first();
    if (!scenario.dialog && await filter.count() && await filter.isVisible()) {
      await filter.click();
      await page.waitForTimeout(300);
      result.filterPopup = await page.locator('[role="listbox"]').last().evaluate((popup) => { const r = popup.getBoundingClientRect(); return { width: r.width, height: r.height, left: r.left, right: r.right, top: r.top, bottom: r.bottom, options: popup.querySelectorAll('[role="option"]').length, passed: r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1 }; }).catch(() => ({ passed: false, reason: 'Filter opened without a visible listbox.' }));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
    }
    result.knownConsoleWarnings = result.consoleErrors.filter((text) => /button/.test(text) && scenario.dialog).map((text) => ({ text, source: 'Existing dialog trigger/close composition; no product logic changed by the audit.' }));
    result.unexpectedConsoleErrors = result.consoleErrors.filter((text) => !result.knownConsoleWarnings.some((warning) => warning.text === text));
    const tocLayoutFailed = result.documentToc?.passed === false && !(result.knownBaselineIssues?.length && result.documentTocAfterEdit?.passed);
    result.issueCount = Number(result.dom.documentOverflow) + Number(result.dom.mainOverflow) + Number(result.dom.dialogOutsideViewport) + Number(result.filterPopup?.passed === false) + Number(result.apipostInteractions?.passed === false) + Number(tocLayoutFailed) + result.dom.clippedControls.length + result.dom.narrowInputs.length + result.dom.clippedContent.length + result.dom.lowEditorContrast.length + result.dom.tableReachability.filter((table) => !table.rightEdgeReachable || table.lastColumnActions.some((action) => !action.horizontalPassed)).length;
    result.status = result.errors.length || result.unmatchedApi.length || result.blockedWrites.length ? 'error' : result.issueCount ? 'review' : 'checked';
    const mode = String(args.screenshots || 'representative');
    if (mode === 'all' || (mode === 'issues' && result.issueCount) || (mode === 'representative' && representative.has(id))) {
      await page.evaluate(() => { for (const animation of document.getAnimations()) if (animation.effect?.getTiming().iterations === Infinity) { animation.currentTime = 900; animation.pause(); } });
      result.screenshot = path.join(output, `${scenario.name}-${viewport.width}x${viewport.height}.png`);
      await page.screenshot({ path: result.screenshot, fullPage: false });
    }
  } catch (error) {
    result.status = 'error'; result.failure = error.message;
    result.bodyText = await page.locator('body').innerText().then((text) => text.slice(0, 600)).catch(() => null);
    if (args.screenshots !== 'none') { result.screenshot = path.join(output, `${scenario.name}-${viewport.width}x${viewport.height}.png`); await page.screenshot({ path: result.screenshot }).catch(() => {}); }
  }
  finally { await context.close(); }
  return result;
}

const queue = sizes.flatMap((size) => scenarios.map((scenario) => ({ scenario, size })));
let next = 0;
let reportWrites = Promise.resolve();
async function worker() {
  while (!interrupted && next < queue.length) {
    const { scenario, size } = queue[next++];
    const result = await capture(scenario, size);
    report.cases = report.cases.filter((item) => item.id !== result.id);
    report.cases.push(result);
    reportWrites = reportWrites.then(() => writeFile(reportPath, JSON.stringify(report, null, 2) + '\n'));
    await reportWrites;
    console.log(JSON.stringify({ id: result.id, status: result.status, issues: result.issueCount, clipped: result.dom?.clippedControls.length, narrowInputs: result.dom?.narrowInputs.length, documentOverflow: result.dom?.documentOverflow, failure: result.failure }));
  }
}
try { await Promise.all(Array.from({ length: Math.min(Number(args.concurrency || 3), queue.length) }, () => worker())); }
finally {
  await browser.close();
  report.finishedAt = new Date().toISOString();
  report.finishedSourceFingerprint = await sourceFingerprint();
  report.currentRunSourceChanged = report.finishedSourceFingerprint !== report.sourceFingerprint;
  report.sourceChangedDuringAudit = report.currentRunSourceChanged || report.auditRuns.some((run) => run.sourceChangedDuringAudit);
  report.cases.sort((a, b) => a.viewport.width - b.viewport.width || a.name.localeCompare(b.name));
  if (!args.screenshots || args.screenshots === 'representative') for (const item of report.cases) if (!representative.has(item.id)) delete item.screenshot;
  report.scenarioCount = new Set(report.cases.map((item) => item.name)).size;
  report.knownBaselineIssues = report.cases.filter((item) => item.knownBaselineIssues?.length).map((item) => ({ id: item.id, issues: item.knownBaselineIssues }));
  report.summary = { total: report.cases.length, checked: report.cases.filter((item) => item.status === 'checked').length, review: report.cases.filter((item) => item.status === 'review').length, error: report.cases.filter((item) => item.status === 'error').length };
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ report: reportPath, ...report.summary }));
if (report.summary.error) process.exitCode = 1;
