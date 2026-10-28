// Temporary, read-only layout regression fixtures. No business/backend connection.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {apiFixture,streamFixture,chat,libraryRun} from './fixtures.mjs';
const note=Array.from({length:80},(_,i)=>`第 ${i+1} 项：这是一段用于布局回归的较长说明，必须能够完整读取。`).join('\n');
const feedbackTopics=['交付清单统计时间范围','回归验收所需的测试账号与访问环境','搜索摘要展示和长内容的验收标准','各端发布前需要确认的负责人及交付时间'];
function feedbackQuestions(id,stage=0){
 return feedbackTopics.slice(0,id===4?4:3).map((topic,index)=>({
  header:`确认事项 ${stage+1}-${index+1}`,
  question:`请确认${topic}，以便机器人继续处理当前任务。`,
  multiple:id===5&&index===1,
  custom:true,
  options:Array.from({length:id===5?5:2},(_,option)=>({
   label:id===5?`方案 ${option+1}：${topic}，保留现有约定并完成全部相关检查`:`${option===0?'沿用当前约定':'补充后再继续'}`,
   description:id===5?`这是长选项说明，用于检查较短窗口内的换行和独立滚动。${'需要逐项核对输入、资料、责任人和验收结果，确认后继续原有任务流程。'.repeat(3)}`:'通过现有问答卡提交确认；也可以在下方输入补充说明。',
  })),
 }));
}
function task(id){
 if(id<4)return {...chat.task,id,title:id===2?'长失败原因布局验证（示例）':'长拒绝理由和分发建议（示例）',status:'已结束',subStatus:id===2?'失败':'已拒绝',failureReason:id===2?note:null,refusalReason:id===3?note:null,dispatchSuggestion:id===3?note:null,missingItems:[]};
 const questions=feedbackQuestions(id);
 const t={...chat.task,id,code:`T-LAYOUT-00${id}`,rootId:id,parentId:null,title:id===4?'短窗口待反馈与确认卡（示例）':'短窗口多阶段、多问题确认（示例）',status:'等待中',subStatus:'待反馈',result:null,deliveredAt:null,acceptedAt:null,acceptedBy:null,opencodeSessionId:`layout-task-${id}`,failureReason:null,refusalReason:null,dispatchSuggestion:null,missingItems:questions.map(question=>({item:question.question,reason:question.header})),children:[],events:chat.events.map(event=>({...event,taskId:id,type:'状态变更',content:'进行中-执行中 → 等待中-待反馈（等待需求方确认）'}))};
 if(id===5)t.children=[1,2].map(stage=>({...t,id:50+stage,code:`T-LAYOUT-005-${stage}`,rootId:5,parentId:5,title:`并行阶段 ${stage} 的资料确认（示例）`,opencodeSessionId:`layout-task-5-stage-${stage}`,children:[],events:[],missingItems:feedbackQuestions(5,stage).map(question=>({item:question.question,reason:question.header}))}));
 return t;
}
function taskChat(id){
 const t=task(id);
 const messages=chat.messages.filter(m=>!m.question&&(id<4||m.role!=='system')).map(m=>({...m,taskId:id,status:'complete'}));
 const pipeline=[{...chat.pipeline[0],task:t}];
 if(id>=4){
  const stages=[t,...t.children];
  pipeline.push(...t.children.map(child=>({...chat.pipeline[0],task:child})));
  stages.forEach((stage,index)=>messages.push({id:`layout-question-${stage.id}`,taskId:stage.id,role:'assistant',sender:chat.pipeline[0].agent,content:'',createdAt:chat.messages.at(-1).createdAt,status:'running',kind:'question',question:{id:`project-layout-${stage.id}`,sessionId:stage.opencodeSessionId,state:'pending',askedAt:chat.messages.at(-1).createdAt,questions:feedbackQuestions(id,index)}}));
 }
 return {...chat,task:t,rootTask:t,pipeline,messages,...(id>=4?{events:t.events}:{})};
}

const output=Array.from({length:400},(_,i)=>`[log] 第 ${i+1} 行：脚本库长日志布局和自动跟随验证`);
const run=extra=>({...libraryRun,status:'running',output:[...output,...extra],finishedAt:null});
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
http.createServer((request,response)=>{
 const url=new URL(request.url,'http://127.0.0.1');if(!['GET','HEAD','OPTIONS'].includes(request.method)){response.writeHead(405);response.end('Read-only layout regression');return;}
 if(url.pathname.startsWith('/api/')){
  if(url.pathname.endsWith('/stream')){
   response.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive'});const send=data=>response.write(`data: ${JSON.stringify(data)}\n\n`);
   if(url.pathname.includes('/script-library/')){send(run([]));let tick=0;const timer=setInterval(()=>{tick++;send(run(Array.from({length:tick},(_,i)=>`[log] SSE 新增第 ${i+1} 行`)));},3000);request.on('close',()=>clearInterval(timer));}
   else {send(streamFixture(url.href));const timer=setInterval(()=>response.write(': heartbeat\n\n'),20000);request.on('close',()=>clearInterval(timer));}return;
  }
  const match=url.pathname.match(/^\/api\/tasks\/(2|3|4|5)(\/chat)?$/);const data=match?(match[2]?taskChat(Number(match[1])):task(Number(match[1]))):apiFixture(url.href);
  response.writeHead(data===undefined?404:200,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify(data??{}));return;
 }
 let file=path.resolve('/web','.'+decodeURIComponent(url.pathname));if(!file.startsWith('/web/')||!fs.existsSync(file)||!fs.statSync(file).isFile())file='/web/index.html';response.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(file).pipe(response);
}).listen(8080,'0.0.0.0',()=>console.log('Read-only layout regression ready'));
