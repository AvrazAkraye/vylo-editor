// A gateway made of frames, on a real socket.
//
// `test/sse.test.mjs` feeds the decoder a string; this feeds the *app* an HTTP
// response. That difference is the point of the file: between a string and a
// turn sit `fetch`, chunked transfer encoding, a `Response.body` reader and a
// `TextDecoder`, and none of those are exercised by handing `SSEDecoder` a
// literal. A connection that dies halfway through, in particular, cannot be
// expressed at all without a socket to destroy.
//
// It binds 127.0.0.1 on port 0, so it needs no network, no key, no fixed port,
// and no cooperation from CI beyond a loopback interface. Everything it answers
// with is written by the test.

import http from 'node:http';

/** One SSE frame, in the shape the Anthropic streaming API sends. */
export const frame = (o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;

/**
 * A text block, split into as many deltas as `text` has pieces.
 *
 * Passing an array is how a test says "this arrives in three pieces", which is
 * what makes a truncated stream reproducible.
 */
export function textBlock(index, text) {
  const parts = Array.isArray(text) ? text : [text];
  return frame({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } })
    + parts.map((t) => frame({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: t } })).join('')
    + frame({ type: 'content_block_stop', index });
}

/**
 * A tool_use block. Its arguments go out as one `input_json_delta`.
 *
 * `sse.test.mjs` already covers arguments split into individually-invalid
 * fragments; there is nothing to learn by re-proving it over a socket.
 */
export function toolBlock(index, { id, name, input }) {
  return frame({ type: 'content_block_start', index, content_block: { type: 'tool_use', id, name } })
    + frame({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input ?? {}) } })
    + frame({ type: 'content_block_stop', index });
}

/**
 * A whole assistant turn.
 *
 * `message_start` carries the input count and `message_delta` the cumulative
 * output, which is how the real stream reports it and why `usage.ts` folds by
 * max rather than adding.
 */
export function turn(blocks, stop, usage = { input: 100, output: 50 }) {
  return frame({ type: 'message_start', message: { usage: { input_tokens: usage.input, output_tokens: 1 } } })
    + blocks.map((b, i) => (b.name ? toolBlock(i, b) : textBlock(i, b.text))).join('')
    + frame({ type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: usage.output } })
    + frame({ type: 'message_stop' });
}

/** The model answers and stops. */
export const says = (text, usage) => turn([{ text }], 'end_turn', usage);

/** The model asks for one tool and stops for the result. */
export const asks = (id, name, input, usage) => turn([{ id, name, input }], 'tool_use', usage);

/** The model says something *and* asks for a tool, which is the common case. */
export const saysAndAsks = (text, id, name, input, usage) =>
  turn([{ text }, { id, name, input }], 'tool_use', usage);

/**
 * A gateway that answers from a script and remembers what it was asked.
 *
 * Script entries:
 *   { stream }              a 200 event-stream, complete
 *   { stream, cut: true }   the same, with the socket destroyed part way
 *   { stream, hold: true }  written, then left open until close()
 *   { status, body }        an error, as JSON, the way the gateway reports one
 *   { json }                a 200 that is not a stream, for the non-SSE path
 *
 * Running out of script is answered with a 500 that says so, because a test
 * that made one request too many should read as that and not as a timeout.
 */
export async function startGateway(script = []) {
  const requests = [];
  const held = new Set();

  const server = http.createServer(async (req, res) => {
    // Two scenarios deliberately break a connection — one destroys the socket
    // mid-reply, one aborts the fetch from the client — and both can land an
    // ECONNRESET on this side afterwards. An unhandled 'error' on a socket is
    // an uncaught exception, which would read as a broken test rather than as
    // the broken connection it was asked for.
    req.on('error', () => {});
    res.on('error', () => {});

    let raw = '';
    try {
      for await (const chunk of req) raw += chunk;
    } catch { return; }
    let body = null;
    try { body = JSON.parse(raw); } catch { /* recorded as null; the test will say so */ }
    requests.push({ method: req.method, url: req.url, headers: req.headers, body });

    const next = script.shift();
    if (!next) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'the test ran out of replies' } }));
      return;
    }
    if (next.json) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(next.json));
      return;
    }
    if (next.status) {
      res.writeHead(next.status, { 'content-type': 'application/json', ...(next.headers ?? {}) });
      res.end(JSON.stringify(next.body ?? {}));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (next.cut) {
      // No terminating chunk. The client's HTTP parser sees a body that ended
      // early, which is what a dropped connection is, and `runAgent` gets a
      // throw out of `reader.read()` rather than a clean end of stream.
      res.write(next.stream, () => res.socket?.destroy());
      return;
    }
    if (next.hold) {
      held.add(res);
      res.write(next.stream);
      return;
    }
    res.end(next.stream);
  });

  // A malformed request from a client that vanished is not this server's
  // problem, and the default handler would tear the process down.
  server.on('clientError', (_e, socket) => socket.destroy());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    /** Replace the script between scenarios, and forget what was asked. */
    load(next) { script.length = 0; script.push(...next); requests.length = 0; },
    async close() {
      for (const res of held) { try { res.end(); } catch { /* already gone */ } }
      held.clear();
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
