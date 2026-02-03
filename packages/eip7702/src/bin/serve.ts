import type { IncomingMessage } from "node:http";
import http from "node:http";
import { Readable } from "node:stream";

export function serve(
  port: number,
  hostname: string,
  handler: (req: Request) => Promise<Response>,
) {
  const server = http.createServer(
    async (nodeReq: IncomingMessage, nodeRes) => {
      const url = `http://${hostname}:${port}${nodeReq.url}`;
      const headers = new Headers(nodeReq.headers as Record<string, string>);
      const hasBody = !["GET", "HEAD"].includes(nodeReq.method!);
      const body = hasBody
        ? (Readable.toWeb(Readable.from(nodeReq)) as ReadableStream)
        : undefined;
      const request = new Request(url, {
        method: nodeReq.method,
        headers,
        body,
        // @ts-ignore duplex needed for streaming body
        duplex: hasBody ? "half" : undefined,
      });

      const response = await handler(request);
      nodeRes.writeHead(response.status, Object.fromEntries(response.headers));
      const resBody = response.body;
      if (resBody) {
        for await (const chunk of resBody) {
          nodeRes.write(chunk);
        }
      }
      nodeRes.end();
    },
  );
  server.listen(port, hostname);
  return server;
}
