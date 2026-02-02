import http from "node:http";
export declare function serve(port: number | string, handler: (req: Request) => Promise<Response> | Response): http.Server<typeof http.IncomingMessage, typeof http.ServerResponse>;
