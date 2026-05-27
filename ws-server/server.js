'use strict';

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = 3001;

// ── Per-path client sets ──────────────────────────────────────────────────────
const clients = {
  '/ws/orders':   new Set(),
  '/ws/products': new Set(),
  '/ws/platform': new Set(),
};

// ── HTTP server (health-check endpoint) ──────────────────────────────────────
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ws-server running\n');
});

// ── WebSocket server ──────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const path = req.url ?? '';

  if (!clients[path]) {
    ws.close(4000, 'Unknown path');
    return;
  }

  clients[path].add(ws);
  console.log(`[+] ${path}  clients=${clients[path].size}`);

  // Immediately send a welcome / initial-state message
  ws.send(JSON.stringify(buildWelcome(path)));

  ws.on('close', () => {
    clients[path].delete(ws);
    console.log(`[-] ${path}  clients=${clients[path].size}`);
  });

  ws.on('error', err => console.error(`[err] ${path}: ${err.message}`));
});

// ── Broadcast helper ──────────────────────────────────────────────────────────
function broadcast(path, msg) {
  const json = JSON.stringify(msg);
  let sent = 0;
  for (const ws of clients[path]) {
    if (ws.readyState === 1 /* WebSocket.OPEN */) {
      ws.send(json);
      sent++;
    }
  }
  console.log(`[>] ${path}  type=${msg.type}  sent=${sent}`);
}

// ── Unique ID helper ──────────────────────────────────────────────────────────
function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── Message builders ──────────────────────────────────────────────────────────
const orderTemplates = [
  { type: 'order_placed',    orderId: '#1042', message: 'New order #1042 received' },
  { type: 'order_updated',   orderId: '#1038', message: 'Order #1038 status changed to shipped' },
  { type: 'order_cancelled', orderId: '#1035', message: 'Order #1035 has been cancelled' },
];

const productTemplates = [
  { type: 'stock_low',     productId: 'P-001', message: 'Widget Pro stock below threshold: 3 remaining' },
  { type: 'price_changed', productId: 'P-002', message: 'Gadget X price updated to $49.99' },
  { type: 'new_arrival',   productId: 'P-003', message: 'New product added: Smart Sensor v2' },
];

const platformTemplates = [
  { type: 'system_alert', title: 'Scheduled Maintenance',   message: 'Scheduled maintenance in 30 minutes' },
  { type: 'maintenance',  title: 'Database Backup',         message: 'Database backup running — read-only mode' },
  { type: 'broadcast',    title: 'New Feature Released',    message: 'New feature released: export to CSV now available' },
];

let orderIdx = 0, productIdx = 0, platformIdx = 0;

function mkOrder(i)    { return { id: uid(), ...orderTemplates[i % orderTemplates.length],       timestamp: new Date().toISOString() }; }
function mkProduct(i)  { return { id: uid(), ...productTemplates[i % productTemplates.length],   timestamp: new Date().toISOString() }; }
function mkPlatform(i) { return { id: uid(), ...platformTemplates[i % platformTemplates.length], timestamp: new Date().toISOString() }; }

function buildWelcome(path) {
  if (path === '/ws/orders')   return mkOrder(0);
  if (path === '/ws/products') return mkProduct(0);
  return mkPlatform(0);
}

// ── Periodic broadcasts ───────────────────────────────────────────────────────

setInterval(() => {
  orderIdx++;
  broadcast('/ws/orders', mkOrder(orderIdx));
}, 4000);

setInterval(() => {
  productIdx++;
  broadcast('/ws/products', mkProduct(productIdx));
}, 4000);

setInterval(() => {
  platformIdx++;
  broadcast('/ws/platform', mkPlatform(platformIdx));
}, 6000);

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`ws-server listening on :${PORT}`);
  console.log('  /ws/orders   — order lifecycle events  (4 s interval)');
  console.log('  /ws/products — inventory / pricing events (4 s interval)');
  console.log('  /ws/platform — platform-wide alerts     (6 s interval)');
});
