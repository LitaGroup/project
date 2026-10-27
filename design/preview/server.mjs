/** Local UI-only preview: fictional read-only fixtures, live Vite UI, no backend access. */
import http from 'node:http';
import { apiFixture, streamFixture, exampleImage } from './fixtures.mjs';

const viteOrigin = 'http://127.0.0.1:5273';
const port = 5274;
const host = process.env.UI_PREVIEW_HOST || '127.0.0.1';
const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  if (url.pathname.startsWith('/api/')) {
    response.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      response.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ message: '此页面为 UI 示例预览，不保存业务数据' }));
      return;
    }
    if (url.pathname.endsWith('/stream')) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' });
      response.write(`data: ${JSON.stringify(streamFixture(url.href))}\n\n`);
      const heartbeat = setInterval(() => response.write(': preview heartbeat\n\n'), 20000);
      request.on('close', () => clearInterval(heartbeat));
      return;
    }
    const data = apiFixture(url.href);
    response.writeHead(data === undefined ? 404 : 200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(data ?? { message: 'No preview fixture' }));
    return;
  }
  if (url.pathname === '/images/preview-example.svg') {
    response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    response.end(exampleImage);
    return;
  }
  const upstream = http.request(new URL(request.url, viteOrigin), {
    method: request.method,
    headers: { ...request.headers, host: '127.0.0.1:5273' },
  }, (result) => {
    response.writeHead(result.statusCode, result.headers);
    result.pipe(response);
  });
  upstream.on('error', () => {
    response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('先启动此 worktree 的 pnpm dev:frontend');
  });
  request.pipe(upstream);
});
// Forward Vite HMR over the same preview origin, so the visible tab updates live.
server.on('upgrade', (request, socket, head) => {
  const upstream = http.request(new URL(request.url, viteOrigin), {
    headers: { ...request.headers, host: '127.0.0.1:5273' },
  });
  upstream.on('upgrade', (response, target, upstreamHead) => {
    const headers = response.rawHeaders.reduce((lines, value, index, values) =>
      index % 2 === 0 ? [...lines, `${value}: ${values[index + 1]}`] : lines, []);
    socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n${headers.join('\r\n')}\r\n\r\n`);
    if (upstreamHead.length) socket.write(upstreamHead);
    if (head.length) target.write(head);
    socket.pipe(target).pipe(socket);
    socket.on('error', () => target.destroy());
    target.on('error', () => socket.destroy());
  });
  upstream.on('error', () => socket.destroy());
  upstream.end();
});
server.listen(port, host, () => console.log(`UI preview (fictional data) listening on ${host}:${port}`));
