import net from 'net';

/**
 * #1516 (RF009, RNF004 C6): publishes one telemetry message to the test
 * stack's real MQTT broker, as a device would, so a spec can prove the
 * backend's MQTT subscriber ingests it. MQTT 3.1.1 over node:net, with only
 * the four packets a one-shot publisher sends (CONNECT, PUBLISH at QoS 1,
 * DISCONNECT) and the two it reads (CONNACK, PUBACK); the runner image
 * installs no MQTT client. The URL defaults to the host-side published port;
 * the in-container runner sets E2E_MQTT_URL to the compose service.
 */

const brokerUrl = new URL(process.env.E2E_MQTT_URL || 'mqtt://localhost:1883');

function remainingLength(length: number): Buffer {
  const bytes: number[] = [];
  let rest = length;
  do {
    let byte = rest % 128;
    rest = Math.floor(rest / 128);
    if (rest > 0) byte |= 0x80;
    bytes.push(byte);
  } while (rest > 0);
  return Buffer.from(bytes);
}

function utf8Field(text: string): Buffer {
  const bytes = Buffer.from(text, 'utf8');
  const length = Buffer.alloc(2);
  length.writeUInt16BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

function packet(firstByte: number, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from([firstByte]), remainingLength(body.length), body]);
}

/**
 * Publishes `payload` to `topic` at QoS 1 and resolves once the broker
 * acknowledges it (PUBACK). `retain` keeps it on the broker for a subscriber
 * that connects later; an empty retained payload clears it.
 */
export async function publishMqtt(
  topic: string,
  payload: string,
  { retain = false, timeoutMs = 10_000 }: { retain?: boolean; timeoutMs?: number } = {}
): Promise<void> {
  const clientId = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // Protocol name MQTT, level 4 (3.1.1), clean session, 60 s keep-alive.
  const connect = packet(0x10, Buffer.concat([
    utf8Field('MQTT'), Buffer.from([0x04, 0x02, 0x00, 0x3c]), utf8Field(clientId),
  ]));
  const packetId = 1;
  const id = Buffer.alloc(2);
  id.writeUInt16BE(packetId);
  const publish = packet(0x32 | (retain ? 0x01 : 0x00), Buffer.concat([
    utf8Field(topic), id, Buffer.from(payload, 'utf8'),
  ]));

  await new Promise<void>((resolve, reject) => {
    const socket = net.connect(Number(brokerUrl.port || 1883), brokerUrl.hostname);
    let received = Buffer.alloc(0);
    let connected = false;
    const fail = (error: Error) => {
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error(`MQTT publish to ${brokerUrl.host} timed out`)), timeoutMs);
    socket.on('error', fail);
    socket.on('connect', () => socket.write(connect));
    socket.on('data', (chunk) => {
      received = Buffer.concat([received, chunk]);
      if (!connected && received.length >= 4) {
        if (received[0] !== 0x20 || received[3] !== 0x00) {
          fail(new Error(`MQTT CONNACK refused: ${received.subarray(0, 4).toString('hex')}`));
          return;
        }
        connected = true;
        received = received.subarray(4);
        socket.write(publish);
      }
      if (connected && received.length >= 4) {
        if (received[0] !== 0x40 || received.readUInt16BE(2) !== packetId) {
          fail(new Error(`MQTT PUBACK expected: ${received.subarray(0, 4).toString('hex')}`));
          return;
        }
        clearTimeout(timer);
        socket.end(Buffer.from([0xe0, 0x00]));
        resolve();
      }
    });
  });
}
