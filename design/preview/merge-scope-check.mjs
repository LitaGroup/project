/** Read-only audit of the UI branch against the explicitly selected main revision. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const ts = require('typescript');
const baseline = process.argv[2] || 'origin/main';
const reportPath = process.argv[3] || 'design/main-merge-scope.json';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
const checks = [];
function check(name, passed) { checks.push({ name, passed }); }
function source(file, base = false) { return base ? git('show', `${baseline}:${file}`) : readFileSync(file, 'utf8').trimEnd(); }
function ast(file, base = false) { return ts.createSourceFile(file, source(file, base), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); }
function find(root, predicate) {
  if (predicate(root)) return root;
  return ts.forEachChild(root, node => find(node, predicate));
}
function named(file, name, base = false) {
  const root = ast(file, base);
  const node = find(root, node => (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name?.getText(root) === name);
  if (!node) throw Error(`Missing ${name} in ${base ? baseline : 'worktree'}:${file}`);
  return node.getText(root);
}
function sameNamed(file, name) { check(`${file}:${name} unchanged`, named(file, name) === named(file, name, true)); }
const changed = git('diff', '--name-only', baseline).split('\n').filter(Boolean);
const outOfScope = changed.filter(file => !file.startsWith('frontend/') && !file.startsWith('design/'));
check('All branch-specific changes are frontend or design', outOfScope.length === 0);
for (const target of ['backend', 'frontend/src/lib/api.ts', 'frontend/src/App.tsx', 'frontend/src/context', 'frontend/package.json', 'package.json', 'pnpm-lock.yaml']) {
  check(`${target} matches main`, !git('diff', '--name-only', baseline, '--', target));
}
const debug = 'frontend/src/pages/WorkerDebugPage.tsx';
const question = 'frontend/src/components/QuestionCard.tsx';
const task = 'frontend/src/components/task-detail/TaskChatPanel.tsx';
const prefix = text => text.slice(0, text.indexOf('\n  return ('));
check('Debug snapshot/SSE/send/reply/reset unchanged', prefix(named(debug, 'WorkerDebugPage')) === prefix(named(debug, 'WorkerDebugPage', true)));
check('Question state/answers/toggle/submit unchanged', prefix(named(question, 'QuestionCard')) === prefix(named(question, 'QuestionCard', true)));
for (const [file, name] of [['frontend/src/pages/ScriptLibraryDetailPage.tsx', 'ScriptLibraryDetailPage'], ['frontend/src/pages/TaskTypesPage.tsx', 'TypeFormDialog'], ['frontend/src/pages/TaskTypesPage.tsx', 'DeleteTypeButton']]) {
  check(`${file}:${name} business prefix unchanged`, prefix(named(file, name)) === prefix(named(file, name, true)));
}
for (const file of [debug, task]) {
  if (file === debug) {
    // The UI adapter classifies a failed send so assistant-ui restores the draft.
    // Require the exact approved wrapper: payload extraction and onSend stay intact.
    const expected = named(file, 'onNew', true).replace(
      'if (text) await onSend(text)',
      `if (!text) return
      try {
        await onSend(text)
      } catch (error) {
        // Restore the unsent composer draft; the existing send callback owns the request and error UI.
        throw new MessageNotSentError(error instanceof Error ? error.message : String(error))
      }`,
    );
    check('Debug onNew only adds failed-send draft restoration', named(file, 'onNew') === expected);
  } else {
    sameNamed(file, 'onNew');
  }
  sameNamed(file, 'toThreadMessage');
  sameNamed(file, 'customOf');
}
sameNamed(task, 'readAutoAnswer');
// ClassName attributes and CSS imports are presentation. Compare the complete footer,
// including assignment dialogs, after removing only those visual attributes.
const printer = ts.createPrinter({ removeComments: true });
function footer(file, base = false) {
  const root = ast(file, base);
  const removeClasses = context => node => {
    const visit = item => ts.isJsxAttribute(item) && item.name.getText(root) === 'className'
      ? undefined : ts.visitEachChild(item, visit, context);
    return ts.visitNode(node, visit);
  };
  const transformed = ts.transform(root, [removeClasses]);
  const functions = transformed.transformed[0].statements.filter(node => ts.isFunctionDeclaration(node));
  const start = functions.findIndex(node => node.name?.text === 'ChatFooter');
  if (start < 0) throw Error('Missing ChatFooter');
  const result = functions.slice(start).map(node => printer.printNode(ts.EmitHint.Unspecified, node, root)).join('\n');
  transformed.dispose();
  return result;
}
check('Task footer/assignment actions and guards unchanged except classes', footer(task) === footer(task, true));
for (const [file, fragment] of [[debug, 'isSendDisabled: running'], [task, 'isSendDisabled: finished || busy || robotRunning']]) {
  check(`${file}: original send guard`, source(file).includes(fragment) && source(file, true).includes(fragment));
}
// Every API expression in a modified TSX file must match main, in order. New shared
// visual components have no business calls; no network behavior is hidden in them.
const apiDifferences = [];
for (const file of changed.filter(file => /\.[jt]sx?$/.test(file) && file.startsWith('frontend/src/'))) {
  const calls = base => {
    let root;
    try { root = ast(file, base); } catch { return []; }
    const values = [];
    const visit = node => {
      if (ts.isCallExpression(node) && node.expression.getText(root).startsWith('api.')) values.push(printer.printNode(ts.EmitHint.Unspecified, node, root));
      ts.forEachChild(node, visit);
    };
    visit(root);
    return values;
  };
  if (JSON.stringify(calls(false)) !== JSON.stringify(calls(true))) apiDifferences.push(file);
}
check('All API call expressions match main', apiDifferences.length === 0);
const report = { auditedAt: new Date().toISOString(), baseline: git('rev-parse', baseline), uiHeadBeforeMerge: 'f2bea76e0b42112a7d9a204853a13563ad23ad9f', checks, outOfScope, apiDifferences, passed: checks.every(item => item.passed) };
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ report: reportPath, total: checks.length, passed: checks.filter(item => item.passed).length, failures: checks.filter(item => !item.passed) }));
if (!report.passed) process.exitCode = 1;
