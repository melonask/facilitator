import type { IncomingMessage } from "node:http";
import http from "node:http";
export declare function serve(port: number, hostname: string, handler: (req: Request) => Promise<Response>): http.Server<typeof IncomingMessage, typeof http.ServerResponse>;
