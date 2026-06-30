// PWA Installation handling
let deferredPrompt;
const installBtn = document.getElementById('pwa-install-btn');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.style.display = 'inline-flex';
});

installBtn.addEventListener('click', async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      installBtn.style.display = 'none';
    }
    deferredPrompt = null;
  }
});

// Register Service Worker for offline PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('Service Worker registered.'))
      .catch(err => console.log('Service Worker registration failed: ', err));
  });
}

// Elements
const inputDepot = document.getElementById('input-depot');
const inputRisk = document.getElementById('input-risk');
const inputEntry = document.getElementById('input-entry');
const inputStop = document.getElementById('input-stop');
const inputTarget = document.getElementById('input-target');
const inputFees = document.getElementById('input-fees');

const btnRiskPercent = document.getElementById('btn-risk-percent');
const btnRiskVal = document.getElementById('btn-risk-val');

const outShares = document.getElementById('out-shares');
const outSharesSub = document.getElementById('out-shares-sub');
const outPosition = document.getElementById('out-position');
const outMaxRisk = document.getElementById('out-max-risk');
const outRiskPerShare = document.getElementById('out-risk-per-share');
const outPortfolioShare = document.getElementById('out-portfolio-share');
const outCrv = document.getElementById('out-crv');
const outCrvRating = document.getElementById('out-crv-rating');
const tileCrvContainer = document.getElementById('tile-crv-container');

// IBKR Helper Elements
const ibkrHelperCard = document.getElementById('ibkr-helper-card');
const ibkrQty = document.getElementById('ibkr-qty');
const ibkrStopPrice = document.getElementById('ibkr-stop-price');
const ibkrSlPrice = document.getElementById('ibkr-sl-price');

const validationAlert = document.getElementById('validation-alert');
const validationMsg = document.getElementById('validation-msg');

// State
let riskMode = 'percent'; // 'percent' or 'value'
let activeSymbol = ''; // Loaded from URL parameters if present

// Initialize event listeners
btnRiskPercent.addEventListener('click', () => setRiskMode('percent'));
btnRiskVal.addEventListener('click', () => setRiskMode('value'));

// Parse localized German numbers (e.g. "10.000,50" -> 10000.5)
function parseLocaleFloat(valueStr) {
  if (!valueStr) return NaN;
  // Remove all dots (thousands separators) and replace comma with dot
  const clean = valueStr.toString().replace(/\./g, '').replace(',', '.');
  return parseFloat(clean);
}

// Format an input field value with thousands separators
function formatInputField(inputElement, fractionDigits = null) {
  let rawVal = inputElement.value.trim();
  if (!rawVal) return;
  
  let val = parseLocaleFloat(rawVal);
  if (isNaN(val)) return;

  let formatted;
  if (fractionDigits !== null) {
    formatted = new Intl.NumberFormat('de-DE', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits
    }).format(val);
  } else {
    // Detect decimals automatically from user input
    const parts = rawVal.split(',');
    const decimals = parts.length > 1 ? parts[1].length : 0;
    formatted = new Intl.NumberFormat('de-DE', {
      minimumFractionDigits: Math.min(decimals, 4),
      maximumFractionDigits: Math.min(decimals, 4)
    }).format(val);
  }
  inputElement.value = formatted;
}

const inputs = [inputDepot, inputRisk, inputEntry, inputStop, inputTarget, inputFees];
inputs.forEach(input => {
  input.addEventListener('input', () => {
    // Clean typing input: only allow digits, dots, commas
    let start = input.selectionStart;
    let oldVal = input.value;
    let newVal = oldVal.replace(/[^0-9.,-]/g, '');
    if (oldVal !== newVal) {
      input.value = newVal;
      // Adjust cursor position
      input.setSelectionRange(start - 1, start - 1);
    }
    calculate();
    saveToLocalStorage();
  });

  input.addEventListener('blur', () => {
    // Format nicely on blur (when user finishes editing)
    if (input === inputDepot) {
      formatInputField(input, 0); // Depotwert integer
    } else if (input === inputRisk) {
      formatInputField(input, riskMode === 'percent' ? 1 : 0);
    } else {
      formatInputField(input); // Auto-detect for prices
    }
  });
});

// Set active risk mode
function setRiskMode(mode) {
  if (riskMode === mode) return;
  const prevMode = riskMode;
  riskMode = mode;

  if (mode === 'percent') {
    btnRiskPercent.classList.add('active');
    btnRiskVal.classList.remove('active');
    inputRisk.placeholder = 'z.B. 1,0';
    // Convert current value roughly
    const val = parseLocaleFloat(inputRisk.value);
    const depot = parseLocaleFloat(inputDepot.value);
    if (val && depot) {
      const converted = ((val / depot) * 100).toFixed(1);
      inputRisk.value = converted.replace('.', ',');
    }
  } else {
    btnRiskPercent.classList.remove('active');
    btnRiskVal.classList.add('active');
    inputRisk.placeholder = 'z.B. 100';
    // Convert current value roughly
    const val = parseLocaleFloat(inputRisk.value);
    const depot = parseLocaleFloat(inputDepot.value);
    if (val && depot) {
      const converted = Math.round((val / 100) * depot);
      inputRisk.value = converted.toString();
    }
  }
  formatInputField(inputRisk, mode === 'percent' ? 1 : 0);
  calculate();
  saveToLocalStorage();
}

// Format Currency
function formatCurrency(val) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(val);
}

// Format Number
function formatNumber(val, decimals = 0) {
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(val);
}

// Main logic
function calculate() {
  const depot = parseLocaleFloat(inputDepot.value);
  const riskInput = parseLocaleFloat(inputRisk.value);
  const entry = parseLocaleFloat(inputEntry.value);
  const stop = parseLocaleFloat(inputStop.value);
  const target = parseLocaleFloat(inputTarget.value);
  const fees = parseLocaleFloat(inputFees.value) || 0;

  // Clear errors first
  validationAlert.style.display = 'none';

  // If core inputs are missing, reset display
  if (isNaN(depot) || isNaN(riskInput) || isNaN(entry) || isNaN(stop)) {
    resetOutputs();
    return;
  }

  // Validations
  if (depot <= 0 || riskInput <= 0 || entry <= 0 || stop <= 0) {
    showError('Alle Werte müssen größer als 0 sein.');
    resetOutputs();
    return;
  }

  if (stop >= entry) {
    showError('Der Stop-Loss muss unter dem Einstiegspreis liegen.');
    resetOutputs();
    return;
  }

  if (target && target <= entry) {
    showError('Der Take-Profit (Ziel) muss über dem Einstiegspreis liegen.');
    resetOutputs();
    return;
  }

  // 1. Calculate Max Risk
  let maxRiskVal = 0;
  if (riskMode === 'percent') {
    maxRiskVal = (depot * riskInput) / 100;
  } else {
    maxRiskVal = riskInput;
  }

  // Adjust risk for transaction fees (buying + selling fees reduce available risk budget)
  // Total Risk = (Entry - Stop) * Shares + TotalFees
  // Therefore: Available risk budget for share price movement = maxRiskVal - TotalFees
  const adjustedRiskVal = maxRiskVal - (fees * 2);

  if (adjustedRiskVal <= 0) {
    showError('Die Transaktionsgebühren überschreiten das maximale Risiko!');
    resetOutputs();
    return;
  }

  // 2. Risk per share
  const riskPerShare = entry - stop;

  // 3. Recommended Share Count
  const shares = Math.floor(adjustedRiskVal / riskPerShare);

  if (shares <= 0) {
    showError('Das Risiko pro Aktie ist zu groß für das festgelegte Risikobudget. Keine Aktien kaufbar.');
    resetOutputs();
    return;
  }

  // 4. Position Volume / Capital Required
  const positionVolume = shares * entry;

  // 5. Portfolio Weight
  const portfolioShare = (positionVolume / depot) * 100;

  // Output Rendering
  outShares.textContent = formatNumber(shares);
  const symbolStr = activeSymbol ? ` von ${activeSymbol}` : '';
  outSharesSub.textContent = `Kaufe ${shares} Anteile${symbolStr} zu je ${formatNumber(entry, 2)}`;
  outPosition.textContent = formatNumber(positionVolume, 2);
  outMaxRisk.textContent = formatNumber(maxRiskVal, 2);
  outRiskPerShare.textContent = formatNumber(riskPerShare, 2);
  outPortfolioShare.textContent = `${formatNumber(portfolioShare, 1)}%`;

  // Risk-Reward-Ratio (CRV)
  if (target) {
    const rewardPerShare = target - entry;
    const crv = rewardPerShare / riskPerShare;
    
    tileCrvContainer.style.display = 'flex';
    outCrv.textContent = `1 : ${formatNumber(crv, 2)}`;
    
    // Evaluate CRV quality
    if (crv >= 2.0) {
      outCrvRating.textContent = 'Hervorragend';
      outCrvRating.className = 'crv-rating crv-good';
    } else if (crv >= 1.5) {
      outCrvRating.textContent = 'Akzeptabel';
      outCrvRating.className = 'crv-rating crv-good';
    } else {
      outCrvRating.textContent = 'Gering (CRV < 1.5)';
      outCrvRating.className = 'crv-rating crv-bad';
    }
  } else {
    tileCrvContainer.style.display = 'none';
  }

  // Populate IBKR Helper Panel
  ibkrQty.textContent = formatNumber(shares);
  ibkrStopPrice.textContent = formatNumber(entry, 2);
  ibkrSlPrice.textContent = formatNumber(stop, 2);
}

function resetOutputs() {
  outShares.textContent = '—';
  outSharesSub.textContent = 'Bitte füllen Sie alle Parameter aus';
  outPosition.textContent = '—';
  outMaxRisk.textContent = '—';
  outRiskPerShare.textContent = '—';
  outPortfolioShare.textContent = '—';
  tileCrvContainer.style.display = 'none';
  
  // Reset IBKR helper values instead of hiding
  ibkrQty.textContent = '—';
  ibkrStopPrice.textContent = '—';
  ibkrSlPrice.textContent = '—';
}

function showError(msg) {
  validationMsg.textContent = msg;
  validationAlert.style.display = 'flex';
}

// LocalStorage Persistence
function saveToLocalStorage() {
  const data = {
    depot: inputDepot.value,
    risk: inputRisk.value,
    riskMode: riskMode,
    entry: inputEntry.value,
    stop: inputStop.value,
    target: inputTarget.value,
    fees: inputFees.value
  };
  localStorage.setItem('pos_calc_data', JSON.stringify(data));
}

function formatAllFields() {
  formatInputField(inputDepot, 0);
  formatInputField(inputRisk, riskMode === 'percent' ? 1 : 0);
  formatInputField(inputEntry);
  formatInputField(inputStop);
  formatInputField(inputTarget);
  formatInputField(inputFees);
}

function loadFromLocalStorage() {
  const raw = localStorage.getItem('pos_calc_data');
  if (raw) {
    try {
      const data = JSON.parse(raw);
      if (data.depot) inputDepot.value = data.depot;
      if (data.risk) inputRisk.value = data.risk;
      if (data.entry) inputEntry.value = data.entry;
      if (data.stop) inputStop.value = data.stop;
      if (data.target) inputTarget.value = data.target;
      if (data.fees) inputFees.value = data.fees;
      
      if (data.riskMode) {
        setRiskMode(data.riskMode);
      }
      
      formatAllFields();
      calculate();
    } catch (e) {
      console.error('Fehler beim Laden aus dem LocalStorage:', e);
    }
  }
}
// Initial load
loadFromLocalStorage();

// Override with URL parameters if present
const params = new URLSearchParams(window.location.search);
const entryParam = params.get('entry') || params.get('price');
const stopParam = params.get('stop') || params.get('sl');
const targetParam = params.get('target') || params.get('tp');
const symbolParam = params.get('symbol') || params.get('ticker') || params.get('sym');

if (symbolParam) {
  activeSymbol = symbolParam.toUpperCase();
  const badge = document.getElementById('symbol-badge');
  if (badge) {
    badge.textContent = activeSymbol;
    badge.style.display = 'inline-block';
  }
  document.title = `Positionsrechner - ${activeSymbol}`;
}

if (entryParam) inputEntry.value = entryParam.replace('.', ',');
if (stopParam) inputStop.value = stopParam.replace('.', ',');
if (targetParam) inputTarget.value = targetParam.replace('.', ',');

if (entryParam || stopParam || targetParam) {
  formatAllFields();
  calculate();
}

// Carousel dot indicators logic on mobile
const appMain = document.querySelector('.app-main');
const dots = document.querySelectorAll('.dot');

if (appMain && dots.length > 0) {
  appMain.addEventListener('scroll', () => {
    const width = appMain.clientWidth;
    if (width === 0) return;
    const index = Math.round(appMain.scrollLeft / width);
    
    dots.forEach((dot, idx) => {
      if (idx === index) {
        dot.classList.add('active');
      } else {
        dot.classList.remove('active');
      }
    });
  });

  // Tap dots to navigate
  dots.forEach(dot => {
    dot.addEventListener('click', () => {
      const idx = parseInt(dot.getAttribute('data-index'), 10);
      const width = appMain.clientWidth;
      appMain.scrollTo({
        left: idx * width,
        behavior: 'smooth'
      });
    });
  });
}
