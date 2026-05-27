'use strict';

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = 3001;

// ── Per-path client sets ──────────────────────────────────────────────────────
const clients = {
  '/ws/loans':    new Set(),
  '/ws/rates':    new Set(),
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

  // Immediately send an initial-state message on connect
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

// ── /ws/loans — Loan Pipeline events ─────────────────────────────────────────
// type: 'loan_submitted' | 'status_changed' | 'document_required'
const loanTemplates = [
  {
    type:   'loan_submitted',
    loanId: 'LN-2024-009',
    message: 'New application LN-2024-009 received — David Warner, $425,000 Conventional 30-yr',
  },
  {
    type:   'status_changed',
    loanId: 'LN-2024-002',
    message: 'LN-2024-002 advanced to Underwriting — James Rodriguez, FHA $320,000',
  },
  {
    type:   'document_required',
    loanId: 'LN-2024-004',
    message: 'LN-2024-004 stalled: updated appraisal required — Michael Torres, VA $275,000',
  },
  {
    type:   'status_changed',
    loanId: 'LN-2024-007',
    message: 'LN-2024-007 approved by underwriter — Angela Davis, Conventional $520,000',
  },
  {
    type:   'loan_submitted',
    loanId: 'LN-2024-010',
    message: 'New application LN-2024-010 received — Priya Nair, $610,000 Jumbo 30-yr',
  },
  {
    type:   'document_required',
    loanId: 'LN-2024-008',
    message: 'LN-2024-008 on hold: VOE needed from employer — Thomas Wright, FHA $380,000',
  },
];

// ── /ws/rates — Rate Sheet events ────────────────────────────────────────────
// type: 'rate_updated' | 'rate_expired' | 'market_alert'
const rateTemplates = [
  {
    type:      'rate_updated',
    productId: 'R-001',
    message:   '30-Yr Fixed Conventional revised: 6.875% → 6.750% — effective immediately',
  },
  {
    type:      'rate_expired',
    productId: 'R-005',
    message:   'Rate lock on LN-2024-003 expires in 15 min — contact Emily Chen (Jumbo $650,000)',
  },
  {
    type:      'market_alert',
    productId: null,
    message:   '10-Yr Treasury +8 bps — rate sheet refresh expected within 30 minutes',
  },
  {
    type:      'rate_updated',
    productId: 'R-004',
    message:   '30-Yr Fixed FHA revised: 6.750% → 6.625% — MIP unchanged',
  },
  {
    type:      'market_alert',
    productId: null,
    message:   'Fed holds target rate steady — floating locks remain advisable this week',
  },
  {
    type:      'rate_expired',
    productId: 'R-007',
    message:   'Rate lock on LN-2024-001 expires tomorrow — Sarah Mitchell, Conventional $485,000',
  },
];

// ── /ws/platform — Platform-wide events ──────────────────────────────────────
// type: 'compliance_notice' | 'market_update' | 'rate_sheet_published'
const platformTemplates = [
  {
    type:    'rate_sheet_published',
    title:   'Rate Sheet Updated',
    message: 'New rate sheet published for today — all new locks must reference this sheet',
  },
  {
    type:    'market_update',
    title:   'Market Update',
    message: 'FOMC minutes released: committee signals two cuts by year-end; MBS spreads tightening',
  },
  {
    type:    'compliance_notice',
    title:   'Compliance Notice',
    message: 'CFPB reminder: updated TRID CD timing requirements take effect next quarter',
  },
  {
    type:    'rate_sheet_published',
    title:   'Afternoon Rate Revision',
    message: 'Secondary markets closed up — afternoon rate revision issued, check Rate Sheet',
  },
  {
    type:    'market_update',
    title:   'Market Update',
    message: '10-Yr Treasury at 4.28% (+5 bps) — lenders repricing; expect rate-sheet update shortly',
  },
  {
    type:    'compliance_notice',
    title:   'Lender Bulletin',
    message: 'Overlay update: minimum 680 FICO now required on Jumbo ARMs above 80% LTV',
  },
];

let loanIdx = 0, rateIdx = 0, platformIdx = 0;

function mkLoan(i)     { return { id: uid(), ...loanTemplates[i % loanTemplates.length],       timestamp: new Date().toISOString() }; }
function mkRate(i)     { return { id: uid(), ...rateTemplates[i % rateTemplates.length],       timestamp: new Date().toISOString() }; }
function mkPlatform(i) { return { id: uid(), ...platformTemplates[i % platformTemplates.length], timestamp: new Date().toISOString() }; }

function buildWelcome(path) {
  if (path === '/ws/loans') return mkLoan(0);
  if (path === '/ws/rates') return mkRate(0);
  return mkPlatform(0);
}

// ── Periodic broadcasts ───────────────────────────────────────────────────────

setInterval(() => {
  loanIdx++;
  broadcast('/ws/loans', mkLoan(loanIdx));
}, 4000);

setInterval(() => {
  rateIdx++;
  broadcast('/ws/rates', mkRate(rateIdx));
}, 4000);

setInterval(() => {
  platformIdx++;
  broadcast('/ws/platform', mkPlatform(platformIdx));
}, 6000);

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`ws-server listening on :${PORT}`);
  console.log('  /ws/loans    — loan pipeline events      (4 s interval)');
  console.log('  /ws/rates    — rate sheet events          (4 s interval)');
  console.log('  /ws/platform — platform-wide alerts       (6 s interval)');
});
