// utils/currencyConverter.js
// ─────────────────────────────────────────────────────────────────────────────
// Real-time currency conversion (no API key needed)
// ─────────────────────────────────────────────────────────────────────────────

const https = require('https');

// Hardcoded fallback rates (USD base) - update these periodically or use API
const FALLBACK_RATES = {
    USD: 1,      EUR: 0.92,   GBP: 0.79,   JPY: 151.5,
    NGN: 1643,   GHS: 15.5,   KES: 130,    ZAR: 18.5,
    MYR: 4.75,   INR: 83.5,   CAD: 1.36,   AUD: 1.52,
    SGD: 1.35,   HKD: 7.82,   KRW: 1350,   CNY: 7.24,
    CHF: 0.90,   SEK: 10.7,   NOK: 10.8,   DKK: 6.91,
    PLN: 4.02,   TRY: 32.5,   RUB: 92.5,   AED: 3.67,
    SAR: 3.75,   BRL: 5.15,   MXN: 17.2,   ARS: 875,
    COP: 3920,   CLP: 970,    EGP: 50.5,   ETB: 57.2,
    TZS: 2580,   UGX: 3850,   MAD: 10.1,   XOF: 603,
    PHP: 56.8,   THB: 36.5,   IDR: 15800,
};

const CURRENCY_SYMBOLS = {
    USD: '$',    EUR: '€',    GBP: '£',    JPY: '¥',
    NGN: '₦',    GHS: '₵',    KES: 'KSh',  ZAR: 'R',
    MYR: 'RM',   INR: '₹',    CAD: 'C$',   AUD: 'A$',
    SGD: 'S$',   HKD: 'HK$',  KRW: '₩',    CNY: '¥',
    CHF: 'Fr',   SEK: 'kr',   NOK: 'kr',   DKK: 'kr',
    PLN: 'zł',   TRY: '₺',    RUB: '₽',    AED: 'د.إ',
    SAR: '﷼',    BRL: 'R$',   MXN: '$',    ARS: '$',
    COP: 'COP',  CLP: 'CLP',  EGP: 'E£',   ETB: 'Br',
    TZS: 'TSh',  UGX: 'USh',  MAD: 'د.م.', XOF: 'CFA',
    PHP: '₱',    THB: '฿',    IDR: 'Rp',
};

let cachedRates = null;
let cacheTime = 0;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

async function fetchRates() {
    return new Promise((resolve, reject) => {
        const req = https.get('https://open.er-api.com/v6/latest/USD', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.result === 'success') {
                        resolve(json.rates);
                    } else {
                        reject(new Error('API error'));
                    }
                } catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

async function getRates() {
    const now = Date.now();
    if (cachedRates && (now - cacheTime) < CACHE_DURATION) return cachedRates;
    
    try {
        cachedRates = await fetchRates();
        cacheTime = now;
        console.log('✅ Exchange rates updated');
        return cachedRates;
    } catch (err) {
        console.log('⚠️ Using fallback rates:', err.message);
        return FALLBACK_RATES;
    }
}

/**
 * Convert amount FROM base currency TO target currency
 * @param {number} amount - Amount in base currency
 * @param {string} from - Source currency code (default USD)
 * @param {string} to - Target currency code
 * @returns {number} Converted amount
 */
async function convert(amount, from = 'USD', to = 'USD') {
    if (from === to) return parseFloat(amount) || 0;
    
    const rates = await getRates();
    const fromRate = rates[from] || 1;
    const toRate = rates[to] || 1;
    
    // Convert: amount * (toRate / fromRate)
    return (parseFloat(amount) || 0) * (toRate / fromRate);
}

/**
 * Format money with conversion AND symbol
 * This is what your EJS template _fmt uses
 */
async function formatMoney(amount, currency = 'USD') {
    const converted = await convert(amount, 'USD', currency);
    const symbol = CURRENCY_SYMBOLS[currency] || currency + ' ';
    const digits = ['JPY', 'KRW'].includes(currency) ? 0 : 2;
    
    const formatted = converted.toLocaleString('en-US', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });
    
    return symbol + formatted;
}

/**
 * SYNC version for non-async contexts (just symbol swap, no conversion)
 */
function formatMoneySync(amount, currency = 'USD') {
    const symbol = CURRENCY_SYMBOLS[currency] || currency + ' ';
    const num = parseFloat(amount) || 0;
    return symbol + num.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

function getSymbol(currency) {
    return CURRENCY_SYMBOLS[currency] || currency + ' ';
}

module.exports = {
    convert,
    formatMoney,
    formatMoneySync,
    getSymbol,
    getRates,
    CURRENCY_SYMBOLS,
};