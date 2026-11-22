/** A response the router writes in one go. Handlers return this instead of touching the socket. */
export interface Reply {
  status: number;
  headers: Record<string, string>;
  body: Buffer | string;
}

export function json(status: number, value: unknown, headers: Record<string, string> = {}): Reply {
  return {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
    body: JSON.stringify(value),
  };
}

export function notFound(): Reply {
  return json(404, { error: "not found" });
}

export function methodNotAllowed(allow: string): Reply {
  return json(405, { error: "method not allowed" }, { allow });
}
