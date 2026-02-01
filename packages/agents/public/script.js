// ---- Config ----
const SELLER_URL = "http://localhost:4000";
const BUYER_URL = "http://localhost:4001";
const FAC_URL = "http://localhost:3000";

// ---- DOM ----
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const nodeBuyer = $("#node-buyer");
const nodeSeller = $("#node-seller");
const nodeFac = $("#node-facilitator");
const facCore = $("#fac-core");

const buyerStatus = $("#buyer-status");
const sellerStatus = $("#seller-status");
const facStatus = $("#fac-status");

const buyerEth = $("#buyer-eth");
const buyerTokens = $("#buyer-tokens");
const sellerEth = $("#seller-eth");
const sellerTokens = $("#seller-tokens");
const facEth = $("#fac-eth");

const buyerDetail = $("#buyer-detail");
const facDetail = $("#fac-detail");
const sig712 = $("#sig-712");
const sig7702 = $("#sig-7702");
const facVerify = $("#fac-verify");
const facTxtype = $("#fac-txtype");
const facTxhash = $("#fac-txhash");

const weatherResult = $("#weather-result");
const wrTemp = $("#wr-temp");
const wrLoc = $("#wr-loc");

const explainBody = $("#explain-body");
const logsContainer = $("#logs-container");
const startBtn = $("#start-btn");
const nextBtn = $("#next-btn");
const modeToggle = $("#mode-toggle");
const msgBar = $("#message-bar");
const systemStatus = $("#system-status");

const timelineSteps = [
  null,
  $("#ts-1"),
  $("#ts-2"),
  $("#ts-3"),
  $("#ts-4"),
  $("#ts-5"),
  $("#ts-6"),
];

// ---- State ----
let animating = false;
let prevBuyerTokens = null;
let prevSellerTokens = null;
let stepMode = false;
let midX = 0,
  topY = 0,
  facY = 0,
  width = 0;

// ---- Animation Queue ----
const queue = [];
let processing = false;
let stepResolve = null; // resolve function for step mode pause

function enqueue(fn, delay = 800) {
  queue.push({ fn, delay });
  if (!processing) drainQueue();
}

async function drainQueue() {
  processing = true;

  // Show next button if in step mode (disabled initially)
  if (stepMode) {
    nextBtn.classList.remove("hidden");
    nextBtn.disabled = true;
  }

  while (queue.length) {
    const { fn, delay } = queue.shift();
    fn();
    await sleep(delay);

    if (stepMode && queue.length > 0) {
      // Pause and enable NEXT button
      nextBtn.disabled = false;
      await new Promise((resolve) => {
        stepResolve = resolve;
      });
      // User clicked next, disable again
      nextBtn.disabled = true;
    }
  }
  processing = false;
  // Sequence finished or waiting for network.

  if (animating && stepMode) {
    // Still active, waiting for network. Keep button visible but disabled.
    nextBtn.classList.remove("hidden");
    nextBtn.disabled = true;
  } else {
    // Finished or not in step mode.
    nextBtn.classList.add("hidden");
  }
}

function onNextClick() {
  if (stepResolve) {
    stepResolve();
    stepResolve = null;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- Health Check ----
async function pollHealth() {
  const checks = await Promise.all([
    fetch(`${BUYER_URL}/healthcheck`)
      .then(() => true)
      .catch(() => false),
    fetch(`${SELLER_URL}/healthcheck`)
      .then(() => true)
      .catch(() => false),
    fetch(`${FAC_URL}/healthcheck`)
      .then(() => true)
      .catch(() => false),
  ]);
  const up = checks.filter(Boolean).length;
  if (up === 3) {
    systemStatus.textContent = "ONLINE";
    systemStatus.className = "status-badge status-online";
  } else if (up === 0) {
    systemStatus.textContent = "OFFLINE";
    systemStatus.className = "status-badge status-offline";
  } else {
    systemStatus.textContent = "PARTIAL";
    systemStatus.className = "status-badge status-partial";
  }
}

// ---- Message Bar ----
function showMessage(text, source) {
  msgBar.textContent = text;
  msgBar.className = "message-bar";
  if (source) msgBar.classList.add("msg-" + source);
  msgBar.classList.remove("hidden");
}

function hideMessage() {
  msgBar.classList.add("hidden");
}

// ---- Init ----
function init() {
  pollBalances();
  setInterval(pollBalances, 2500);
  pollHealth();
  setInterval(pollHealth, 5000);
  setupSSE();
  startBtn.addEventListener("click", triggerPurchase);
  nextBtn.addEventListener("click", onNextClick);
  modeToggle.addEventListener("click", () => {
    stepMode = !stepMode;
    modeToggle.textContent = stepMode ? "STEP" : "AUTO";
    modeToggle.classList.toggle("mode-step", stepMode);
  });
}

// ---- Balance Polling ----
async function pollBalances() {
  try {
    const [s, b, f] = await Promise.all([
      fetch(`${SELLER_URL}/balance`)
        .then((r) => r.json())
        .catch(() => null),
      fetch(`${BUYER_URL}/balance`)
        .then((r) => r.json())
        .catch(() => null),
      fetch(`${FAC_URL}/balance`)
        .then((r) => r.json())
        .catch(() => null),
    ]);

    if (b) {
      const t = parseFloat(b.tokens).toFixed(2);
      if (prevBuyerTokens !== null && prevBuyerTokens !== t)
        flashValue(buyerTokens);
      prevBuyerTokens = t;
      buyerEth.textContent = parseFloat(b.eth).toFixed(4);
      buyerTokens.textContent = t;
    }
    if (s) {
      const t = parseFloat(s.tokens).toFixed(2);
      if (prevSellerTokens !== null && prevSellerTokens !== t)
        flashValue(sellerTokens);
      prevSellerTokens = t;
      sellerEth.textContent = parseFloat(s.eth).toFixed(4);
      sellerTokens.textContent = t;
    }
    if (f) {
      facEth.textContent = parseFloat(f.eth).toFixed(4);
    }
  } catch (_) {}
}

function flashValue(el) {
  el.classList.add("changed");
  setTimeout(() => el.classList.remove("changed"), 1500);
}

// ---- Trigger Purchase ----
async function triggerPurchase() {
  if (animating) return;
  startBtn.disabled = true;
  if (stepMode) {
    nextBtn.classList.remove("hidden");
    nextBtn.disabled = true;
  }
  log("sys", "Manual purchase triggered");
  try {
    await fetch(`${BUYER_URL}/buy`);
  } catch (_) {
    log("sys", "Connection failed");
  }
}

// ---- SSE Log Stream ----
function setupSSE() {
  const es = new EventSource("/logs");
  es.onmessage = (ev) => {
    const { source, message } = JSON.parse(ev.data);
    const msg = message.trim();
    if (!msg) return;

    const type =
      source === "Agent 1" ? "seller" : source === "Agent 2" ? "buyer" : "sys";
    log(type, msg);
    handleVisuals(source, msg);
  };
}

// ---- Visual State Machine ----
function handleVisuals(source, msg) {
  // Step 1: Buyer contacts seller
  if (source === "Agent 2" && msg.includes("Contacting Agent 1")) {
    animating = true;

    enqueue(() => {
      resetAll();
      setTimeline(1);
      animatePacket("buyer-seller");
      glow(nodeBuyer, "buyer");
      status(buyerStatus, "REQUESTING...");
      showMessage("GET /weather →", "buyer");
      explain(
        "<strong>Step 1: Initial Request</strong>" +
          "<p>The Buyer agent sends a <code>GET /weather</code> request to the Seller. " +
          "No payment headers are attached yet — this is a normal HTTP request.</p>" +
          '<p class="dim">The Seller will check for a PAYMENT-SIGNATURE header and reject with 402 if missing.</p>',
      );
    }, 1000);
  }

  // Step 2: Seller sends 402
  if (source === "Agent 1" && msg.includes("Sending 402")) {
    enqueue(() => {
      setTimeline(2);
      animatePacket("seller-buyer");
      glow(nodeSeller, "seller");
      status(sellerStatus, "402 SENT");
      showMessage("← 402 Payment Required", "seller");
      explain(
        "<strong>Step 2: HTTP 402 Payment Required</strong>" +
          "<p>The Seller responds with status <code>402</code> and includes a " +
          "<code>PAYMENT-REQUIRED</code> header (base64-encoded JSON) specifying:</p>" +
          "<p>Token address, amount (1 token), recipient, scheme (<code>eip7702</code>), " +
          "and network (<code>eip155:31337</code>).</p>" +
          '<p class="dim">This is the x402 protocol — any HTTP server can become a paid API.</p>',
      );
    }, 1200);
  }

  // Step 2b: Buyer receives 402 and analyzes
  if (source === "Agent 2" && msg.includes("Received 402")) {
    enqueue(() => {
      glow(nodeBuyer, "buyer");
      status(buyerStatus, "ANALYZING COSTS");
      hideMessage();
    }, 800);
  }

  // Step 3: Buyer signs
  if (source === "Agent 2" && msg.includes("Signing EIP-712")) {
    enqueue(() => {
      setTimeline(3);
      status(buyerStatus, "SIGNING...");
      buyerDetail.classList.remove("hidden");
      sig712.textContent = "PaymentIntent";
      sig712.className = "detail-val pending";
      sig7702.textContent = "Authorization";
      sig7702.className = "detail-val pending";
      explain(
        "<strong>Step 3: Cryptographic Signatures</strong>" +
          "<p>The Buyer creates two signatures:</p>" +
          "<p><strong>EIP-712 PaymentIntent</strong> — structured data specifying token, amount, " +
          "recipient, nonce, and deadline. This is <em>what</em> to pay.</p>" +
          "<p><strong>EIP-7702 Authorization</strong> — delegates the Buyer's EOA to the " +
          "<code>Delegate.sol</code> contract. This allows the relayer to execute a transfer " +
          "from the Buyer's address without the Buyer paying gas.</p>" +
          '<p class="dim">Unlike EIP-3009 (USDC only), EIP-7702 works with any ERC-20 token including USDT.</p>',
      );
    }, 600);

    // Simulate signing completion
    enqueue(() => {
      sig712.textContent = "SIGNED";
      sig712.className = "detail-val ok";
      sig7702.textContent = "SIGNED";
      sig7702.className = "detail-val ok";
      status(buyerStatus, "SIGNATURES READY");
    }, 1000);
  }

  // Step 4: Buyer sends signed request
  if (source === "Agent 2" && msg.includes("Sending Signed Request")) {
    enqueue(() => {
      setTimeline(4);
      animatePacket("buyer-seller");
      status(buyerStatus, "SENDING PAYMENT");
      showMessage("GET /weather + PAYMENT-SIGNATURE →", "buyer");
      explain(
        "<strong>Step 4: Retry with Payment</strong>" +
          "<p>The Buyer retries the same <code>GET /weather</code> request, now with a " +
          "<code>PAYMENT-SIGNATURE</code> header containing both signatures encoded in base64.</p>" +
          '<p class="dim">The Seller will parse this header and forward it to the Facilitator for settlement.</p>',
      );
    }, 1000);
  }

  // Step 5a: Seller requests verification from Facilitator
  if (source === "Agent 1" && msg.includes("Requesting Verification")) {
    enqueue(() => {
      setTimeline(5);
      hideMessage();
      animatePacket("seller-fac");
      glow(nodeSeller, "seller");
      glow(nodeFac, "fac");
      status(sellerStatus, "VERIFYING...");
      status(facStatus, "VERIFYING");
      facCore.classList.add("pulse");
      showMessage("POST /verify →  Facilitator", "fac");

      facDetail.classList.remove("hidden");
      facVerify.textContent = "Checking...";
      facVerify.className = "detail-val pending";
      facTxtype.textContent = "EIP-7702 Type 4";
      facTxtype.className = "detail-val";
      facTxhash.textContent = "--";
      facTxhash.className = "detail-val mono";

      log("fac", "POST /verify → Facilitator");

      explain(
        "<strong>Step 5a: Facilitator Verification</strong>" +
          "<p>The Seller calls <code>POST /verify</code> on the Facilitator, forwarding the payment payload.</p>" +
          "<p>The Facilitator performs 5 off-chain checks:</p>" +
          "<p>1. Recover signer from EIP-7702 authorization<br>" +
          "2. Verify EIP-712 intent signature<br>" +
          "3. Check deadline has not expired<br>" +
          "4. Check nonce has not been used<br>" +
          "5. Check payer has sufficient token balance</p>" +
          '<p class="dim">Verification is read-only — no nonce is consumed and no transaction is sent yet.</p>',
      );
    }, 1200);
  }

  // Step 5a result: Verification passed
  if (source === "Agent 1" && msg.includes("Verification Passed")) {
    enqueue(() => {
      animatePacket("fac-seller");
      facVerify.textContent = "VALID";
      facVerify.className = "detail-val ok";
      status(facStatus, "VERIFIED");
      log("fac", "POST /verify → 200 {isValid: true}");
    }, 800);
  }

  // Step 5b: Seller requests settlement
  if (source === "Agent 1" && msg.includes("Requesting Settlement")) {
    enqueue(() => {
      animatePacket("seller-fac");
      status(sellerStatus, "SETTLING...");
      status(facStatus, "SETTLING");
      facCore.classList.add("pulse");
      showMessage("POST /settle →  Facilitator", "fac");
      facTxhash.textContent = "pending...";
      facTxhash.className = "detail-val mono pending";

      log("fac", "POST /settle → Facilitator");

      explain(
        "<strong>Step 5b: On-Chain Settlement</strong>" +
          "<p>Verification passed. The Seller now calls <code>POST /settle</code> on the Facilitator.</p>" +
          "<p>The Facilitator re-verifies (consuming the nonce this time), then submits a " +
          "<strong>Type 4 transaction</strong> (EIP-7702) through the relayer.</p>" +
          "<p>The relayer pays gas. The Buyer's EOA delegates to <code>Delegate.sol</code> " +
          "which calls <code>SafeERC20.safeTransfer</code> to move tokens from Buyer to Seller.</p>" +
          '<p class="dim">This is the core of the Facilitator — it bridges HTTP payments to on-chain settlement.</p>',
      );
    }, 1000);
  }

  // Step 5b: Settlement confirmed
  if (source === "Agent 1" && msg.includes("Settlement Confirmed")) {
    const txMatch = msg.match(/Tx:\s*(0x[a-fA-F0-9]+)/);
    const txHash = txMatch ? txMatch[1] : "0x...";

    enqueue(() => {
      animatePacket("fac-seller");
      facVerify.textContent = "VALID";
      facVerify.className = "detail-val ok";
      facTxhash.textContent = txHash.slice(0, 10) + "..." + txHash.slice(-6);
      facTxhash.className = "detail-val mono ok";
      facCore.classList.remove("pulse");
      status(facStatus, "TX CONFIRMED");
      hideMessage();
      log(
        "fac",
        `POST /settle → 200 {tx: ${txHash.slice(0, 10)}...${txHash.slice(-6)}}`,
      );
    }, 1000);

    // Step 6: Deliver data
    enqueue(() => {
      setTimeline(6);
      animatePacket("seller-buyer");
      glow(nodeSeller, "seller");
      status(sellerStatus, "DELIVERING DATA");
      showMessage("← 200 + Weather Data", "seller");
      explain(
        "<strong>Step 6: Data Delivery</strong>" +
          "<p>The on-chain transfer is confirmed. The Seller now delivers the weather data " +
          "with a <code>200 OK</code> response and includes a <code>PAYMENT-RESPONSE</code> header " +
          "containing the transaction hash as a receipt.</p>" +
          '<p class="dim">The Buyer received paid API data without ever paying gas or holding native tokens.</p>',
      );
    }, 1200);
  }

  // Completion: Buyer receives data
  if (source === "Agent 2" && msg.includes("Data Received")) {
    enqueue(() => {
      hideMessage();
      glow(nodeBuyer, "buyer");
      status(buyerStatus, "DATA RECEIVED");
      status(sellerStatus, "LISTENING");

      // Show weather widget
      weatherResult.classList.remove("hidden");
      wrTemp.textContent = "72°F";
      wrLoc.textContent = "SAN FRANCISCO";

      explain(
        "<strong>Transaction Complete</strong>" +
          "<p>The Buyer received the paid weather data. On-chain, 1 token was transferred " +
          "from the Buyer to the Seller via EIP-7702 delegation.</p>" +
          "<p>The Facilitator's relayer paid the gas. The Buyer never needed native ETH.</p>" +
          '<p class="highlight">This works with any ERC-20 token — USDT, DAI, WETH — not just USDC.</p>',
      );

      log("success", "Transaction complete. Tokens transferred on-chain.");
    }, 15000);

    // Reset after showing result
    enqueue(() => {
      resetAll();
      // Start button remains disabled as per "impossible to start a new script"
      startBtn.disabled = false;
      animating = false;
    }, 5000);
  }

  // Transaction hash from buyer
  if (source === "Agent 2" && msg.includes("Tx Hash:")) {
    const txMatch = msg.match(/Tx Hash:\s*(0x[a-fA-F0-9]+)/);
    if (txMatch) {
      log("fac", `On-chain tx: ${txMatch[1]}`);
    }
  }
}

// ---- Visual Helpers ----

function setTimeline(step) {
  for (let i = 1; i <= 6; i++) {
    const el = timelineSteps[i];
    if (!el) continue;
    el.classList.remove("active", "done");
    if (i < step) el.classList.add("done");
    if (i === step) el.classList.add("active");
  }
}

function glow(node, type) {
  unglow(node);
  node.classList.add("glow-" + type);
}

function unglow(node) {
  node.classList.remove("glow-buyer", "glow-seller", "glow-fac");
}

function status(el, text) {
  el.textContent = text;
  el.style.color =
    text === "IDLE" || text === "LISTENING" || text === "READY"
      ? "var(--text-dim)"
      : "var(--accent)";
}

function explain(html) {
  explainBody.innerHTML = html;
}

function resetAll() {
  // Nodes
  [nodeBuyer, nodeSeller, nodeFac].forEach((n) => {
    unglow(n);
  });
  status(buyerStatus, "IDLE");
  status(sellerStatus, "LISTENING");
  status(facStatus, "READY");

  // Timeline
  for (let i = 1; i <= 6; i++) {
    timelineSteps[i]?.classList.remove("active", "done");
  }

  // Details
  buyerDetail.classList.add("hidden");
  facDetail.classList.add("hidden");
  weatherResult.classList.add("hidden");
  facCore.classList.remove("pulse");
  hideMessage();

  // Explanation
  explain(
    "<p>Click <strong>INITIATE</strong> or wait for the auto-purchase. " +
      "The visualization shows each step of the x402 protocol in real time.</p>" +
      '<p class="dim">The Facilitator verifies EIP-712 signatures off-chain, then submits ' +
      "an EIP-7702 Type 4 transaction so the Buyer never pays gas.</p>",
  );
}

// ---- Logging ----
function log(type, message) {
  const div = document.createElement("div");
  div.className = `log-entry ${type}`;
  const time = new Date().toLocaleTimeString([], { hour12: false });

  // Clean up agent prefixes for readability
  let clean = message.replace(/\s*\[Agent [12]\]\s*/, "");
  // Remove emojis for cleaner log
  clean = clean.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\s*/gu, "");

  div.textContent = `[${time}] ${clean}`;
  if (message.includes("{")) div.style.whiteSpace = "pre-wrap";

  logsContainer.appendChild(div);
  requestAnimationFrame(() => {
    logsContainer.scrollTop = logsContainer.scrollHeight;
  });
}

// ---- Draw SVG connection lines ----
function drawConnections() {
  const svg = $("#conn-svg");
  const connArea = document.querySelector(".connections");
  const rect = connArea.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;

  // Update globals
  width = w;
  midX = w / 2;
  topY = h * 0.2;
  facY = h * 0.65;

  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);

  svg.innerHTML = `
        <line x1="0" y1="${topY}" x2="${w}" y2="${topY}"
              stroke="#1a1c22" stroke-width="2" stroke-dasharray="6,6" />
        <line x1="${midX}" y1="${topY}" x2="${midX}" y2="${facY}"
              stroke="#1a1c22" stroke-width="2" stroke-dasharray="6,6" />
        
        <!-- Nodes (Visual anchors) -->
        <circle cx="0" cy="${topY}" r="3" fill="#1a1c22" />
        <circle cx="${w}" cy="${topY}" r="3" fill="#1a1c22" />
        <circle cx="${midX}" cy="${topY}" r="3" fill="#1a1c22" />
        <circle cx="${midX}" cy="${facY}" r="3" fill="#1a1c22" />
    `;
}

// Redraw on resize
window.addEventListener("resize", drawConnections);

// ---- Start ----
init();
requestAnimationFrame(drawConnections);

// ---- Animation ----
function animatePacket(route) {
  const svg = $("#conn-svg");
  const packet = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "circle",
  );
  packet.setAttribute("r", "4");

  // Set color/class
  packet.classList.add("packet-anim");

  let color = "#fff";
  if (route.startsWith("buyer")) color = "var(--buyer)";
  else if (route.startsWith("seller")) color = "var(--seller)";
  else if (route.startsWith("fac")) color = "var(--facilitator)";
  else color = "var(--accent)";

  packet.style.fill = color;
  // Add glow using filter in CSS or direct style if needed, but CSS is better.

  svg.appendChild(packet);

  let pathD = "";
  // buyer is left (0), seller is right (width)

  if (route === "buyer-seller") {
    pathD = `M 0 ${topY} L ${width} ${topY}`;
  } else if (route === "seller-buyer") {
    pathD = `M ${width} ${topY} L 0 ${topY}`;
  } else if (route === "seller-fac") {
    pathD = `M ${width} ${topY} L ${midX} ${topY} L ${midX} ${facY}`;
  } else if (route === "fac-seller") {
    pathD = `M ${midX} ${facY} L ${midX} ${topY} L ${width} ${topY}`;
  }

  // Create animateMotion
  const anim = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "animateMotion",
  );
  anim.setAttribute("path", pathD);
  anim.setAttribute("dur", "1.2s"); // Slightly slower for "beautiful" visualization
  anim.setAttribute("fill", "freeze");
  anim.setAttribute("calcMode", "linear");

  packet.appendChild(anim);
  anim.beginElement();

  setTimeout(() => {
    if (packet.parentNode) packet.remove();
  }, 1200);
}
