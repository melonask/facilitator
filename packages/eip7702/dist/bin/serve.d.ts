import http from "node:http";
export declare function serve(port: number, hostname: string, handler: (req: Request) => Promise<Response>): http.Server<typeof http.IncomingMessage, typeof http.ServerResponse>;
