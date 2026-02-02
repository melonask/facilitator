import http from "node:http";
import { Readable } from "node:stream";
export function serve(port, handler) {
    const numPort = typeof port === "string" ? parseInt(port, 10) : port;
    const server = http.createServer(async (nodeReq, nodeRes) => {
        const url = `http://localhost:${numPort}${nodeReq.url}`;
        const headers = new Headers(nodeReq.headers);
        const hasBody = !["GET", "HEAD"].includes(nodeReq.method);
        const body = hasBody
            ? Readable.toWeb(Readable.from(nodeReq))
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
    });
    server.listen(numPort);
    return server;
}
