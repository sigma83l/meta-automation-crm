import type { Inngest, InngestFunction } from "./inngest-runtime.mjs";

type RouteHandler = (request: Request) => Promise<Response>;

export function serve(
  options: Readonly<{
    client: Inngest;
    functions: readonly InngestFunction[];
  }>
): Readonly<{
  GET: RouteHandler;
  POST: RouteHandler;
  PUT: RouteHandler;
}>;
