// #1152, #1158: the participant consent pages used to map a failure by STATUS
// alone, and in a real outage there is no response to take a status from.
// api.ts aborts at its own 10s timeout while the backend answers 503 only after
// 30s (mongo stopped) or 60s (partitioned), so axios throws ECONNABORTED with no
// `response` and a status-only mapper gets `undefined`.
//
// This classifies the whole error so each page can tell three cases apart:
//   - 'response':    the backend answered; its status decides
//   - 'no-response': a request left the browser and nothing came back (our
//                    timeout, a dropped connection, DNS). The cause may be the
//                    participant's own network, so copy for this case must not
//                    assert that the service is down.
//   - 'local':       neither a response nor a request -- the throw never reached
//                    the network, so it is a fault in the page, not an outage.
export type RequestFailure =
  | { kind: 'response'; status: number }
  | { kind: 'no-response' }
  | { kind: 'local' };

export function classifyRequestFailure(error?: unknown): RequestFailure {
  const err = error as
    | { response?: { status?: number }; request?: unknown; code?: string }
    | undefined;

  const status = err?.response?.status;
  if (typeof status === 'number') {
    return { kind: 'response', status };
  }

  const reachedTheNetwork =
    err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT' || err?.request !== undefined;

  return reachedTheNetwork ? { kind: 'no-response' } : { kind: 'local' };
}
