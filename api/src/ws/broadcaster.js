import { WebSocketServer } from 'ws';

/**
 * Global broadcast hub for job progress events. Every connected client receives
 * every event Phase 1 is single-admin, so per-job rooms are unnecessary.
 *
 * Decoupled from the WS transport: services call `broadcast()` regardless of
 * whether any sockets (or a server) are attached, which keeps the scan pipeline
 * testable without a live socket.
 */
export function createBroadcaster() {
  let wss = null;

  function attach(server) {
    wss = new WebSocketServer({ server, path: '/ws' });
    wss.on('connection', (socket) => {
      socket.send(JSON.stringify({ type: 'connected' }));
    });
    return wss;
  }

  function broadcast(event) {
    if (!wss) return;
    const payload = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(payload);
    }
  }

  function close() {
    if (wss) wss.close();
    wss = null;
  }

  return { attach, broadcast, close };
}

export default createBroadcaster;
