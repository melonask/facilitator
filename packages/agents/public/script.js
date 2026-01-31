const AGENT_SELLER_URL = 'http://localhost:4000';
const AGENT_BUYER_URL = 'http://localhost:4001';
const FACILITATOR_URL = 'http://localhost:3000';

// Elements
const ethSeller = document.querySelector('#agent-seller .eth-value');
const tokenSeller = document.querySelector('#agent-seller .token-value');
const ethBuyer = document.querySelector('#agent-buyer .eth-value');
const tokenBuyer = document.querySelector('#agent-buyer .token-value');
const ethFacilitator = document.querySelector('#agent-facilitator .eth-value');

const cardSeller = document.getElementById('agent-seller');
const cardBuyer = document.getElementById('agent-buyer');
const cardFacilitator = document.getElementById('agent-facilitator');

const step1 = document.getElementById('step-1');
const step2 = document.getElementById('step-2');
const step3 = document.getElementById('step-3');
const step4 = document.getElementById('step-4');

const startBtn = document.getElementById('start-btn');
const logsContainer = document.getElementById('logs-container');

// Weather Elements
const weatherWidget = document.getElementById('weather-display');
const weatherTemp = document.querySelector('.weather-temp');
const weatherLoc = document.querySelector('.weather-loc');

// State
let polling = true;

// --- Animation Queue System ---
const visualQueue = [];
let isAnimating = false;

function addToQueue(action, delay = 1000) {
    visualQueue.push({ action, delay });
    if (!isAnimating) {
        processQueue();
    }
}

async function processQueue() {
    if (visualQueue.length === 0) {
        isAnimating = false;
        return;
    }

    isAnimating = true;
    const item = visualQueue.shift();
    
    // Execute visual update
    item.action();
    
    // Wait for the specified delay before next frame
    await new Promise(r => setTimeout(r, item.delay));
    
    processQueue();
}

// --- Init ---
function init() {
    updateBalances();
    setupLogs(); // Connect to SSE
    
    // Poll balances every 2s
    setInterval(updateBalances, 2000);
}

// Update Balances
async function updateBalances() {
    if (!polling) return;
    try {
        const [sellerRes, buyerRes, facRes] = await Promise.all([
            fetch(`${AGENT_SELLER_URL}/balance`).then(r => r.json()),
            fetch(`${AGENT_BUYER_URL}/balance`).then(r => r.json()),
            fetch(`${FACILITATOR_URL}/balance`).then(r => r.ok ? r.json() : { eth: '---' })
        ]);

        ethSeller.textContent = parseFloat(sellerRes.eth).toFixed(4);
        tokenSeller.textContent = parseFloat(sellerRes.tokens).toFixed(2);

        ethBuyer.textContent = parseFloat(buyerRes.eth).toFixed(4);
        tokenBuyer.textContent = parseFloat(buyerRes.tokens).toFixed(2);
        
        if (facRes.eth !== '---') {
            ethFacilitator.textContent = parseFloat(facRes.eth).toFixed(4);
        }
    } catch (e) {
        // console.error("Polling error (agents might be restarting):", e);
    }
}

// Trigger Purchase
startBtn.addEventListener('click', async () => {
    log('system', 'INITIATING_SEQUENCE: Buyer -> Seller');
    
    // Immediate Reset
    resetVisualsImmediate();
    
    try {
        const res = await fetch(`${AGENT_BUYER_URL}/buy`);
        if (res.ok) {
            log('system', 'COMMAND_SENT: Awaiting Agent Response...');
        } else {
            log('system', 'ERROR: Command failed.');
        }
    } catch (e) {
        log('system', 'ERROR: Connection failed.');
    }
});


// Logs (Server Sent Events)
function setupLogs() {
    const eventSource = new EventSource('/logs');
    
    eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        let msg = data.message.trim();
        let source = data.source;

        // Visual Logic based on logs
        queueVisualUpdates(source, msg);
        
        // Log to Console
        let type = 'system';
        if (source === 'Agent 1') type = 'agent-1';
        if (source === 'Agent 2') type = 'agent-2';
        
        log(type, msg);
    };
}

function queueVisualUpdates(source, msg) {
    // 1. Request Flow (Agent 2 -> Agent 1 -> 402)
    if (source === 'Agent 2' && msg.includes('Contacting Agent 1')) {
         addToQueue(() => {
             setNodeStatus(cardBuyer, 'active', 'REQUESTING WEATHER');
         }, 800);
    }

    if (source === 'Agent 1' && msg.includes('Sending 402')) {
        addToQueue(() => {
            setNodeStatus(cardSeller, 'active', 'PAYMENT REQUIRED');
            highlightStep(step1);
        }, 1200);
    }

    // 2. Signing Flow (Agent 2)
    if (source === 'Agent 2' && msg.includes('Signing EIP-712')) {
        addToQueue(() => {
            setNodeStatus(cardBuyer, 'active', 'SIGNING INTENT');
            showBadge(cardBuyer, 'SIGNING...');
            highlightStep(step2);
        }, 1500);
    }
    
    // 3. Settlement Flow (Agent 1 -> Facilitator)
    if (source === 'Agent 1' && msg.includes('Requesting Settlement')) {
        addToQueue(() => {
            hideBadges(); // Hide previous signing badge
            setNodeStatus(cardSeller, 'active', 'SETTLING...');
            setNodeStatus(cardFacilitator, 'processing', 'BROADCASTING TX');
            highlightStep(step3);
        }, 2000); // Longer delay for "Blockchain" feel
    }
    
    if (source === 'Agent 1' && msg.includes('Settlement Confirmed')) {
         addToQueue(() => {
             setNodeStatus(cardFacilitator, 'active', 'TX CONFIRMED');
         }, 1000);

         addToQueue(() => {
             setNodeStatus(cardSeller, 'active', 'DELIVERING ASSET');
             showBadge(cardSeller, 'DELIVERING');
             highlightStep(step4);
         }, 1500);
    }

    // 4. Completion & Data Delivery
    if (source === 'Agent 2' && msg.includes('Data Received')) {
        // Extract Data
        let parsedData = null;
        try {
            const jsonMatch = msg.match(/{[\s\S]*}/);
            if (jsonMatch) {
                let location = "San Francisco";
                let tempF = 72;
                if (msg.includes('location: "')) location = msg.split('location: "')[1].split('"')[0];
                if (msg.includes('temperature:')) tempF = parseInt(msg.split('temperature:')[1].trim());
                parsedData = { location, tempC: Math.round((tempF - 32) * 5 / 9) };
            }
        } catch (e) {}

        addToQueue(() => {
            setNodeStatus(cardBuyer, 'active', 'DATA RECEIVED');
            hideBadges(); // Hide delivering badge
            if (parsedData) {
                updateWeatherDisplay(parsedData.location, parsedData.tempC);
            }
        }, 3000); // Keep the data visible for a while
        
        // Reset Phase
        addToQueue(() => {
            resetVisualsImmediate();
        }, 100);
    }
}

// --- Visual Helpers ---

function setNodeStatus(card, status, text) {
    // If clearing specific card
    if (!card) return;

    // Reset specific class first
    card.classList.remove('active', 'processing');
    
    if (status === 'active') card.classList.add('active');
    if (status === 'processing') card.classList.add('processing');
    
    if (text) {
        card.querySelector('.status-indicator').textContent = text;
    }
}

function updateWeatherDisplay(location, tempC) {
    weatherWidget.classList.add('active');
    weatherTemp.textContent = `${tempC}°C`;
    weatherLoc.textContent = location;
}

function resetVisualsImmediate() {
    // Reset Cards
    [cardBuyer, cardSeller, cardFacilitator].forEach(c => {
        c.classList.remove('active', 'processing');
        c.querySelector('.status-indicator').textContent = 'IDLE';
    });
    
    // Reset Steps
    [step1, step2, step3, step4].forEach(s => s.classList.remove('active'));
    
    // Reset Badges
    hideBadges();
    
    // Reset Weather
    weatherWidget.classList.remove('active');
    setTimeout(() => {
        if (!weatherWidget.classList.contains('active')) {
            weatherTemp.textContent = '--°C';
            weatherLoc.textContent = 'WAITING FOR DATA';
        }
    }, 500); // Clear text after fade out
}

function highlightStep(stepEl) {
    if (stepEl) stepEl.classList.add('active');
}

function showBadge(card, text) {
    const badge = card.querySelector('.action-badge');
    if (badge) {
        badge.textContent = text;
        badge.classList.remove('hidden');
    }
}

function hideBadges() {
    document.querySelectorAll('.action-badge').forEach(b => b.classList.add('hidden'));
}


function log(type, message) {
    const div = document.createElement('div');
    div.className = `log-entry ${type}`;
    
    const time = new Date().toLocaleTimeString([], { hour12: false });
    
    // JSON formatting
    if (message.includes('{') && message.includes('}')) {
        div.style.whiteSpace = 'pre-wrap';
    }

    div.textContent = `[${time}] ${message}`;
    
    logsContainer.appendChild(div);
    
    // Force scroll to bottom
    requestAnimationFrame(() => {
        logsContainer.scrollTop = logsContainer.scrollHeight;
    });
}

init();