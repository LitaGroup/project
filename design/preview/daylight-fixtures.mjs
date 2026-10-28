import { debug, chat, FIXED_NOW } from './fixtures.mjs';
export const question = (id = 'daylight-q1', mode = 'single') => ({ id, sessionId: debug.sessionId, state: 'pending', askedAt: FIXED_NOW, questions: [{ header: '实施范围', question: '请确认本轮实施范围', options: [{ label: '保留现有流程', description: '按已批准范围执行' }, { label: '仅更新视觉', description: '保持业务行为' }], custom: true, multiple: mode === 'multi' }, ...(mode === 'multi' ? [{ header: '验证方式', question: '请选择验证方式', options: [{ label: '浏览器验证', description: '隔离示例数据' }], custom: true }] : [])] });
export function snapshot(state = 'pending', mode = 'single') {
 const q = question('daylight-q1', mode);
 if (state === 'answered') Object.assign(q, { state: 'answered', answers: [['保留现有流程']], answeredAt: FIXED_NOW });
 const messages = [ { ...debug.messages[0], content: '请按已批准范围更新机器人调试页。' }, { ...debug.messages[1], content: '已完成界面核对，正在检查交互与布局。', status: state === 'running' ? 'running' : 'complete' } ];
 if (state !== 'running') messages.push({ id: 'daylight-question', role: 'assistant', kind: 'question', content: '', status: 'complete', createdAt: FIXED_NOW, question: q });
 if (state === 'answered') Object.assign(messages[1], { content: '本轮更新已完成。布局、确认交互与上下文均已保留。', status: 'complete' });
 return { ...structuredClone(debug), status: state === 'answered' ? 'idle' : 'running', messages };
}
export function taskSnapshot(mode = 'task') { const value=structuredClone(chat); value.messages=value.messages.filter(m=>m.kind!=='question'); value.messages.push({ ...chat.messages.at(-1), question:question() }); value.messages[2].tools=[{ id:'read',name:'read',status:'success',detail:'核对上下文' },{id:'write',name:'write',status:'running',detail:'更新界面'},{id:'check',name:'check',status:'error',detail:'示例检查失败'}]; if (mode === 'task-ready') { value.task.subStatus = '待反馈'; value.task.status = '等待中'; }
 if (mode === 'task-other') { value.task.subStatus = '待反馈'; value.task.status = '等待中'; value.messages.at(-1).taskId = 8; }
 return value; }
