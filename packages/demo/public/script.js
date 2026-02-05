// ---- Config ----
const SELLER_URL = "http://localhost:4001";
const BUYER_URL = "http://localhost:4000";
const FAC_URL = "http://localhost:8080";

// Animation duration for packets (ms)
const PACKET_DURATION = 1000;

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

const buyerUsdt = $("#buyer-usdt");
const buyerUsdc = $("#buyer-usdc");
const sellerUsdt = $("#seller-usdt");
const sellerUsdc = $("#seller-usdc");
const facEth = $("#fac-eth");

const tokenIndicator = $("#token-indicator");

const buyerDetail = $("#buyer-detail");
const facDetail = $("#fac-detail");
const sigLabel1 = $("#sig-label-1");
const sigLabel2 = $("#sig-label-2");
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
const buyUsdtBtn = $("#buy-usdt-btn");
const buyUsdcBtn = $("#buy-usdc-btn");
const nextBtn = $("#next-btn");
const modeToggle = $("#mode-toggle");
const msgBar = $("#message-bar");
const systemStatus = $("#system-status");
const ts3Detail = $("#ts-3-detail");

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
let prevBuyerUsdt = null;
let prevBuyerUsdc = null;
let prevSellerUsdt = null;
let prevSellerUsdc = null;
let prevFacEth = null;
let stepMode = false;
let midX = 0,
  topY = 0,
  facY = 0,
  width = 0;

// Track current token type being used
let currentToken = null; // "usdt" or "usdc"

// Track pending gas deduction (to show when tx is actually submitted)
let pendingGasDeduction = false;

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

// ---- Mobile tooltip handling ----
function setupMobileTooltips() {
  const steps = $$(".timeline-step[data-tooltip]");
  let activeTooltip = null;

  steps.forEach((step) => {
    step.addEventListener("click", (e) => {
      // Only for touch devices
      if (window.matchMedia("(hover: none)").matches) {
        e.preventDefault();

        // Close any existing tooltip
        if (activeTooltip && activeTooltip !== step) {
          activeTooltip.classList.remove("tooltip-active");
        }

        // Toggle this tooltip
        step.classList.toggle("tooltip-active");
        activeTooltip = step.classList.contains("tooltip-active") ? step : null;
      }
    });
  });

  // Close tooltip when clicking elsewhere
  document.addEventListener("click", (e) => {
    if (activeTooltip && !e.target.closest(".timeline-step")) {
      activeTooltip.classList.remove("tooltip-active");
      activeTooltip = null;
    }
  });
}

// ---- Init ----
function init() {
  // Set initial inactive state for seller and facilitator
  nodeSeller.classList.add("inactive");
  nodeFac.classList.add("inactive");

  pollBalances();
  setInterval(pollBalances, 2500);
  pollHealth();
  setInterval(pollHealth, 5000);
  setupSSE();
  setupMobileTooltips();

  buyUsdtBtn.addEventListener("click", () => triggerPurchase("usdt"));
  buyUsdcBtn.addEventListener("click", () => triggerPurchase("usdc"));
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
      fetch(`${FAC_URL}/info`)
        .then((r) => r.json())
        .catch(() => null),
    ]);

    if (b) {
      const usdt = parseFloat(b.usdt).toFixed(2);
      const usdc = parseFloat(b.usdc).toFixed(2);
      if (prevBuyerUsdt !== null && prevBuyerUsdt !== usdt)
        flashValue(buyerUsdt);
      if (prevBuyerUsdc !== null && prevBuyerUsdc !== usdc)
        flashValue(buyerUsdc);
      prevBuyerUsdt = usdt;
      prevBuyerUsdc = usdc;
      buyerUsdt.textContent = usdt;
      buyerUsdc.textContent = usdc;
    }
    if (s) {
      const usdt = parseFloat(s.usdt).toFixed(2);
      const usdc = parseFloat(s.usdc).toFixed(2);
      if (prevSellerUsdt !== null && prevSellerUsdt !== usdt)
        flashValue(sellerUsdt);
      if (prevSellerUsdc !== null && prevSellerUsdc !== usdc)
        flashValue(sellerUsdc);
      prevSellerUsdt = usdt;
      prevSellerUsdc = usdc;
      sellerUsdt.textContent = usdt;
      sellerUsdc.textContent = usdc;
    }
    if (f && f.networks && f.networks.length > 0) {
      const newEth = parseFloat(f.networks[0].eth).toFixed(4);
      // Only flash if we're tracking gas deduction during animation
      if (pendingGasDeduction && prevFacEth !== null && prevFacEth !== newEth) {
        flashGasDeducted(facEth);
        pendingGasDeduction = false;
      }
      prevFacEth = newEth;
      facEth.textContent = newEth;
    }
  } catch (_) {}
}

function flashValue(el) {
  el.classList.add("changed");
  setTimeout(() => el.classList.remove("changed"), 1500);
}

function flashGasDeducted(el) {
  el.classList.add("deducted");
  setTimeout(() => el.classList.remove("deducted"), 1500);
}

// ---- Trigger Purchase ----
async function triggerPurchase(token) {
  if (animating) return;
  buyUsdtBtn.disabled = true;
  buyUsdcBtn.disabled = true;
  if (stepMode) {
    nextBtn.classList.remove("hidden");
    nextBtn.disabled = true;
  }
  log("sys", `Manual purchase triggered (${token.toUpperCase()})`);
  try {
    await fetch(`${BUYER_URL}/buy?token=${token}`);
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

// ---- Detect token type from log messages ----
function detectToken(msg) {
  if (msg.includes("USDC") || msg.includes("ERC-3009")) {
    currentToken = "usdc";
    return "usdc";
  }
  if (msg.includes("USDT") || msg.includes("EIP-7702")) {
    currentToken = "usdt";
    return "usdt";
  }
  return currentToken;
}

function getTokenLabel() {
  return currentToken === "usdc" ? "USDC (ERC-3009)" : "USDT (EIP-7702)";
}

function showTokenIndicator() {
  if (!currentToken) return;
  tokenIndicator.textContent = getTokenLabel();
  tokenIndicator.className = "token-indicator token-" + currentToken;
  tokenIndicator.classList.remove("hidden");
}

// ---- Visual State Machine ----
function handleVisuals(source, msg) {
  // Detect token type from payment messages
  if (source === "Agent 2" && (msg.includes("Paying with") || msg.includes("Signing"))) {
    detectToken(msg);
  }

  // Step 1: Buyer contacts seller
  if (source === "Agent 2" && msg.includes("Contacting Agent 1")) {
    animating = true;

    enqueue(() => {
      resetAll();
      showTokenIndicator();
      setTimeline(1);
      // Buyer glows immediately (it's the initiator)
      glow(nodeBuyer, "buyer");
      status(buyerStatus, "REQUESTING...");
      showMessage("GET /weather →", "buyer");

      // Animate packet to seller, activate seller on arrival
      animatePacket("buyer-seller", () => {
        activateNode(nodeSeller);
      });

      explain(
        "<strong>Step 1: Initial Request</strong>" +
          `<p>The Buyer agent sends a <code>GET /weather</code> request to the Seller, ` +
          `paying with <strong>${getTokenLabel()}</strong>. ` +
          "No payment headers are attached yet — this is a normal HTTP request.</p>" +
          '<p class="dim">The Seller will check for a PAYMENT-SIGNATURE header and reject with 402 if missing.</p>',
      );
    }, PACKET_DURATION + 400);
  }

  // Step 2: Seller sends 402
  if (source === "Agent 1" && msg.includes("Sending 402")) {
    enqueue(() => {
      setTimeline(2);
      glow(nodeSeller, "seller");
      status(sellerStatus, "402 SENT");
      showMessage("← 402 Payment Required", "seller");

      // Animate packet back to buyer
      animatePacket("seller-buyer");

      explain(
        "<strong>Step 2: HTTP 402 Payment Required</strong>" +
          "<p>The Seller responds with status <code>402</code> and includes a " +
          "<code>PAYMENT-REQUIRED</code> header specifying accepted payment options:</p>" +
          "<p><strong>USDT</strong> via <code>eip7702</code> scheme, or " +
          "<strong>USDC</strong> via <code>exact</code> (ERC-3009) scheme.</p>" +
          '<p class="dim">This is the x402 protocol — any HTTP server can become a paid API accepting multiple tokens.</p>',
      );
    }, PACKET_DURATION + 400);
  }

  // Step 2b: Buyer receives 402 and analyzes
  if (source === "Agent 2" && msg.includes("Received 402")) {
    enqueue(() => {
      glow(nodeBuyer, "buyer");
      status(buyerStatus, "ANALYZING COSTS");
      hideMessage();
    }, 800);
  }

  // Step 3: Buyer signs (EIP-7702 path)
  if (source === "Agent 2" && msg.includes("Signing EIP-712")) {
    enqueue(() => {
      setTimeline(3);
      ts3Detail.textContent = "EIP-712 + EIP-7702";
      status(buyerStatus, "SIGNING...");
      buyerDetail.classList.remove("hidden");
      sigLabel1.textContent = "EIP-712";
      sigLabel2.textContent = "EIP-7702";
      sig712.textContent = "PaymentIntent";
      sig712.className = "detail-val pending";
      sig7702.textContent = "Authorization";
      sig7702.className = "detail-val pending";
      explain(
        "<strong>Step 3: EIP-7702 Signatures (USDT)</strong>" +
          "<p>The Buyer creates two signatures:</p>" +
          "<p><strong>EIP-712 PaymentIntent</strong> — structured data specifying token, amount, " +
          "recipient, nonce, and deadline. This is <em>what</em> to pay.</p>" +
          "<p><strong>EIP-7702 Authorization</strong> — delegates the Buyer's EOA to the " +
          "<code>Delegate.sol</code> contract. This allows the relayer to execute a transfer " +
          "from the Buyer's address without the Buyer paying gas.</p>" +
          '<p class="dim">EIP-7702 works with any ERC-20 token including USDT, DAI, WETH.</p>',
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

  // Step 3: Buyer signs (ERC-3009 path)
  if (source === "Agent 2" && msg.includes("Signing ERC-3009")) {
    enqueue(() => {
      setTimeline(3);
      ts3Detail.textContent = "ERC-3009";
      status(buyerStatus, "SIGNING...");
      buyerDetail.classList.remove("hidden");
      sigLabel1.textContent = "EIP-712";
      sigLabel2.textContent = "ERC-3009";
      sig712.textContent = "TransferWithAuth";
      sig712.className = "detail-val pending";
      sig7702.textContent = "Authorization";
      sig7702.className = "detail-val pending";
      explain(
        "<strong>Step 3: ERC-3009 Signature (USDC)</strong>" +
          "<p>The Buyer signs a single <strong>EIP-712 TransferWithAuthorization</strong> message:</p>" +
          "<p>This authorizes a direct transfer of USDC from the Buyer to the Seller. " +
          "The token contract itself supports this — no account delegation needed.</p>" +
          "<p>Fields: from, to, value, validAfter, validBefore, nonce.</p>" +
          '<p class="dim">ERC-3009 is native to USDC — the token contract handles the authorized transfer directly.</p>',
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
      status(buyerStatus, "SENDING PAYMENT");
      showMessage("GET /weather + PAYMENT-SIGNATURE →", "buyer");

      animatePacket("buyer-seller");

      explain(
        "<strong>Step 4: Retry with Payment</strong>" +
          "<p>The Buyer retries the same <code>GET /weather</code> request, now with a " +
          "<code>PAYMENT-SIGNATURE</code> header containing the signed authorization.</p>" +
          `<p>Token: <strong>${getTokenLabel()}</strong></p>` +
          '<p class="dim">The Seller will parse this header and forward it to the Facilitator for settlement.</p>',
      );
    }, PACKET_DURATION + 400);
  }

  // Step 5a: Seller requests verification from Facilitator
  if (source === "Agent 1" && msg.includes("Requesting Verification")) {
    const txType = currentToken === "usdc" ? "ERC-3009" : "EIP-7702 Type 4";

    enqueue(() => {
      setTimeline(5);
      hideMessage();
      glow(nodeSeller, "seller");
      status(sellerStatus, "VERIFYING...");
      showMessage("POST /verify →  Facilitator", "fac");

      // Animate packet to facilitator, activate it on arrival
      animatePacket("seller-fac", () => {
        activateNode(nodeFac);
        glow(nodeFac, "fac");
        status(facStatus, "VERIFYING");
        facCore.classList.add("pulse");

        facDetail.classList.remove("hidden");
        facVerify.textContent = "Checking...";
        facVerify.className = "detail-val pending";
        facTxtype.textContent = txType;
        facTxtype.className = "detail-val";
        facTxhash.textContent = "--";
        facTxhash.className = "detail-val mono";
      });

      log("fac", "POST /verify → Facilitator");

      const verifyExplain = currentToken === "usdc"
        ? "<strong>Step 5a: Facilitator Verification (ERC-3009)</strong>" +
          "<p>The Seller calls <code>POST /verify</code> on the Facilitator.</p>" +
          "<p>The Facilitator verifies the EIP-712 TransferWithAuthorization signature, " +
          "checks the USDC balance, and validates timing constraints.</p>"
        : "<strong>Step 5a: Facilitator Verification (EIP-7702)</strong>" +
          "<p>The Seller calls <code>POST /verify</code> on the Facilitator.</p>" +
          "<p>The Facilitator performs off-chain checks:</p>" +
          "<p>1. Recover signer from EIP-7702 authorization<br>" +
          "2. Verify EIP-712 intent signature<br>" +
          "3. Check deadline and nonce<br>" +
          "4. Check payer token balance</p>";

      explain(
        verifyExplain +
          '<p class="dim">Verification is read-only — no nonce is consumed and no transaction is sent yet.</p>',
      );
    }, PACKET_DURATION + 400);
  }

  // Step 5a result: Verification passed
  if (source === "Agent 1" && msg.includes("Verification Passed")) {
    enqueue(() => {
      animatePacket("fac-seller");
      facVerify.textContent = "VALID";
      facVerify.className = "detail-val ok";
      status(facStatus, "VERIFIED");
      log("fac", "POST /verify → 200 {isValid: true}");
    }, PACKET_DURATION + 400);
  }

  // Step 5b: Seller requests settlement
  if (source === "Agent 1" && msg.includes("Requesting Settlement")) {
    enqueue(() => {
      animatePacket("seller-fac");
      glow(nodeFac, "fac");
      status(sellerStatus, "SETTLING...");
      status(facStatus, "SETTLING");
      facCore.classList.add("pulse");
      showMessage("POST /settle →  Facilitator", "fac");
      facTxhash.textContent = "pending...";
      facTxhash.className = "detail-val mono pending";

      // Mark that we're expecting gas deduction
      pendingGasDeduction = true;

      log("fac", "POST /settle → Facilitator");

      const settleExplain = currentToken === "usdc"
        ? "<strong>Step 5b: On-Chain Settlement (ERC-3009)</strong>" +
          "<p>The Facilitator calls <code>transferWithAuthorization</code> on the USDC contract, " +
          "executing the signed transfer directly. The relayer pays gas.</p>"
        : "<strong>Step 5b: On-Chain Settlement (EIP-7702)</strong>" +
          "<p>The Facilitator submits a <strong>Type 4 transaction</strong> (EIP-7702) through the relayer. " +
          "The Buyer's EOA delegates to <code>Delegate.sol</code> which calls <code>safeTransfer</code> " +
          "to move USDT from Buyer to Seller.</p>";

      explain(
        settleExplain +
          '<p class="dim">This is the core of the Facilitator — it bridges HTTP payments to on-chain settlement.</p>',
      );
    }, PACKET_DURATION + 400);
  }

  // Step 5b: Settlement confirmed
  if (source === "Agent 1" && msg.includes("Settlement Confirmed")) {
    const txMatch = msg.match(/Tx:\s*(0x[a-fA-F0-9]+)/);
    const txHash = txMatch ? txMatch[1] : "0x...";

    // Detect token from settlement message
    if (msg.includes("USDC") || msg.includes("ERC-3009")) {
      currentToken = "usdc";
    } else if (msg.includes("USDT") || msg.includes("EIP-7702")) {
      currentToken = "usdt";
    }

    enqueue(() => {
      animatePacket("fac-seller");
      facVerify.textContent = "VALID";
      facVerify.className = "detail-val ok";
      facTxhash.textContent = txHash.slice(0, 10) + "..." + txHash.slice(-6);
      facTxhash.className = "detail-val mono ok";
      facCore.classList.remove("pulse");
      status(facStatus, "TX CONFIRMED");
      hideMessage();

      // Flash gas deduction if it hasn't been detected yet
      if (pendingGasDeduction) {
        flashGasDeducted(facEth);
        pendingGasDeduction = false;
      }

      log(
        "fac",
        `POST /settle → 200 {tx: ${txHash.slice(0, 10)}...${txHash.slice(-6)}}`,
      );
    }, PACKET_DURATION + 400);

    // Step 6: Deliver data
    enqueue(() => {
      setTimeline(6);
      glow(nodeSeller, "seller");
      status(sellerStatus, "DELIVERING DATA");
      showMessage("← 200 + Weather Data", "seller");

      animatePacket("seller-buyer");

      explain(
        "<strong>Step 6: Data Delivery</strong>" +
          "<p>The on-chain transfer is confirmed. The Seller delivers the weather data " +
          "with a <code>200 OK</code> response and a <code>PAYMENT-RESPONSE</code> header " +
          "containing the transaction hash.</p>" +
          `<p>Token used: <strong>${getTokenLabel()}</strong></p>` +
          '<p class="dim">The Buyer received paid API data without ever paying gas or holding native tokens.</p>',
      );
    }, PACKET_DURATION + 400);
  }

  // Completion: Buyer receives data
  if (source === "Agent 2" && msg.includes("Data Received")) {
    const tokenLabel = getTokenLabel();

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
          `<p>The Buyer received paid weather data. On-chain, 1 token was transferred ` +
          `from Buyer to Seller via <strong>${tokenLabel}</strong>.</p>` +
          "<p>The Facilitator's relayer paid the gas. The Buyer never needed native ETH.</p>" +
          '<p class="highlight">This Facilitator supports multiple mechanisms — ' +
          "EIP-7702 for any ERC-20 (USDT), and ERC-3009 for USDC.</p>",
      );

      log("success", `Transaction complete. ${tokenLabel} transferred on-chain.`);
    }, 15000);

    // Reset after showing result
    enqueue(() => {
      resetAll();
      // Enable buy buttons for retry
      buyUsdtBtn.disabled = false;
      buyUsdcBtn.disabled = false;
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
  node.classList.remove("inactive");
  node.classList.add("glow-" + type);
}

function unglow(node) {
  node.classList.remove("glow-buyer", "glow-seller", "glow-fac");
}

function activateNode(node) {
  node.classList.remove("inactive");
}

function deactivateNode(node) {
  node.classList.add("inactive");
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

  // Deactivate seller and facilitator (they start inactive)
  deactivateNode(nodeSeller);
  deactivateNode(nodeFac);

  // Buyer is always active
  nodeBuyer.classList.remove("inactive");

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
  tokenIndicator.classList.add("hidden");
  facCore.classList.remove("pulse");
  hideMessage();

  // Reset state
  currentToken = null;
  pendingGasDeduction = false;
  ts3Detail.textContent = "EIP-712 + EIP-7702";

  // Explanation
  explain(
    '<p>Click <strong>USDT</strong> or <strong>USDC</strong> to initiate a purchase. ' +
      "The visualization shows each step of the x402 protocol in real time.</p>" +
      '<p class="dim">USDT uses EIP-7702 delegation. USDC uses ERC-3009 transferWithAuthorization. ' +
      "Both are settled by the same Facilitator — the Buyer never pays gas.</p>",
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
function animatePacket(route, onComplete) {
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
  anim.setAttribute("dur", `${PACKET_DURATION}ms`);
  anim.setAttribute("fill", "freeze");
  anim.setAttribute("calcMode", "linear");

  packet.appendChild(anim);
  anim.beginElement();

  setTimeout(() => {
    if (packet.parentNode) packet.remove();
    // Call completion callback to activate the target node
    if (onComplete) onComplete();
  }, PACKET_DURATION);
}
