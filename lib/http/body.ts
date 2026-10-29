/**
 * Reads a request body up to `limit` bytes, for the public machine endpoints (the telemetry relays,
 * D83). Returns null as soon as the body is larger, without buffering more than the limit, so a client
 * cannot make the function hold an arbitrary amount of memory.
 */
export async function readCapped(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(request.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > limit) return null;
  if (request.body === null) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
