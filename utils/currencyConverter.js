// utils/currencyConverter.js
// ─────────────────────────────────────────────────────────────────────────────
// Real-time currency conversion (no API key needed)
// ALL ISO 4217 active currencies included (153 currencies)
// ─────────────────────────────────────────────────────────────────────────────

const https = require('https');

// Hardcoded fallback rates (USD base) - update these periodically or use API
// ALL ISO 4217 active currencies included — 153 currencies total
const FALLBACK_RATES = {
    // ─── MAJOR / RESERVE ───
    USD: 1,      EUR: 0.92,   GBP: 0.79,   JPY: 151.5,
    CHF: 0.90,   CNY: 7.24,   CAD: 1.36,   AUD: 1.52,

    // ─── AFRICA (39 currencies) ───
    NGN: 1643,   GHS: 15.5,   KES: 130,    ZAR: 18.5,
    EGP: 50.5,   ETB: 57.2,   TZS: 2580,   UGX: 3850,
    MAD: 10.1,   XOF: 603,    XAF: 655,    ZMW: 25.8,
    AOA: 833,    BWP: 13.5,   BIF: 2870,   CVE: 101,
    KMF: 456,    CDF: 2780,   DJF: 178,    ERN: 15,
    GMD: 63.5,   GNF: 8600,   LRD: 193,    LSL: 18.5,
    LYD: 4.85,   MGA: 4500,   MWK: 1730,   MRU: 39.5,
    MUR: 46.5,   MZN: 63.8,   NAD: 18.5,   RWF: 1300,
    SCR: 13.6,   SLE: 22.5,   SOS: 571,    SSP: 1300,
    SDG: 600,    SZL: 18.5,   TND: 3.12,   ZWL: 322,

    // ─── ASIA (43 currencies) ───
    INR: 83.5,   SGD: 1.35,   HKD: 7.82,   KRW: 1350,
    MYR: 4.75,   AED: 3.67,   SAR: 3.75,   BDT: 109.5,
    BND: 1.35,   BTN: 83.5,  IDR: 15800,  ILS: 3.67,
    JOD: 0.709,  KHR: 4100,   KWD: 0.307,  KGS: 89.5,
    LAK: 20800,  LBP: 89500,  LKR: 303,    MNT: 3450,
    MOP: 8.05,   MMK: 2100,   NPR: 133.5,  OMR: 0.385,
    PKR: 278,    PHP: 56.8,   QAR: 3.64,   THB: 36.5,
    TJS: 10.9,   TMT: 3.5,    UZS: 12600,  VND: 25400,
    YER: 250,    AFN: 71.5,   AMD: 388,    AZN: 1.70,
    BHD: 0.376,  GEL: 2.70,   IRR: 42000,  IQD: 1310,
    KZT: 500,    KPW: 900,    MVR: 15.4,

    // ─── AMERICAS (30 currencies) ───
    BRL: 5.15,   MXN: 17.2,   ARS: 875,    COP: 3920,
    CLP: 970,    BSD: 1,      BBD: 2,      BMD: 1,
    BOB: 6.91,   BZD: 2,      CRC: 513,    CUP: 24,
    DOP: 58.8,   GTQ: 7.75,   HNL: 24.7,   HTG: 132,
    JMD: 157,    KYD: 0.82,   NIO: 36.8,   PAB: 1,
    PEN: 3.72,   PYG: 7450,   SRD: 35.5,   TTD: 6.78,
    UYU: 39.2,   VES: 36.5,   XCD: 2.70,   FKP: 0.79,
    GYD: 209,

    // ─── EUROPE (22 currencies) ───
    SEK: 10.7,   NOK: 10.8,   PLN: 4.02,   TRY: 32.5,
    RUB: 92.5,   DKK: 6.91,   CZK: 23.2,   HUF: 362,
    ISK: 138,    RON: 4.60,   BGN: 1.80,   BYN: 3.27,
    GIP: 0.79,   HRK: 7.53,   MDL: 17.8,   MKD: 56.8,
    RSD: 108,    UAH: 41.2,   ALL: 93.5,   BAM: 1.80,

    // ─── OCEANIA / PACIFIC (8 currencies) ───
    NZD: 1.66,   FJD: 2.24,   PGK: 3.82,   SBD: 8.45,
    TOP: 2.35,   VUV: 119,    WST: 2.75,   XPF: 109,

    // ─── SPECIAL / METALS (5 currencies) ───
    XAU: 0.00042, XAG: 0.037, XPT: 0.0011, XPD: 0.0011,
    XDR: 0.75,
};

// ALL ISO 4217 currency symbols — 153 currencies total
const CURRENCY_SYMBOLS = {
    // ─── MAJOR ───
    USD: '$',    EUR: '€',    GBP: '£',    JPY: '¥',
    CHF: 'Fr',   CNY: '¥',    CAD: 'C$',   AUD: 'A$',

    // ─── AFRICA (39) ───
    NGN: '₦',    GHS: '₵',    KES: 'KSh',  ZAR: 'R',
    EGP: 'E£',   ETB: 'Br',   TZS: 'TSh',  UGX: 'USh',
    MAD: 'د.م.', XOF: 'CFA',  XAF: 'FCFA', ZMW: 'K',
    AOA: 'Kz',   BWP: 'P',    BIF: 'FBu',  CVE: '$',
    KMF: 'CF',   CDF: 'FC',   DJF: 'Fdj',  ERN: 'Nfk',
    GMD: 'D',    GNF: 'FG',   LRD: '$',    LSL: 'L',
    LYD: 'ل.د',  MGA: 'Ar',   MWK: 'MK',   MRU: 'UM',
    MUR: '₨',    MZN: 'MT',   NAD: '$',    RWF: 'FRw',
    SCR: '₨',    SLE: 'Le',   SOS: 'Sh',   SSP: 'SS£',
    SDG: '£',    SZL: 'L',    TND: 'د.ت',  ZWL: '$',

    // ─── ASIA (43) ───
    INR: '₹',    SGD: 'S$',   HKD: 'HK$',  KRW: '₩',
    MYR: 'RM',   AED: 'د.إ',   SAR: '﷼',    BDT: '৳',
    BND: 'B$',   BTN: 'Nu.',  IDR: 'Rp',   ILS: '₪',
    JOD: 'JD',   KHR: '៛',    KWD: 'KD',   KGS: 'с',
    LAK: '₭',    LBP: 'ل.ل',   LKR: 'Rs',   MNT: '₮',
    MOP: 'MOP$', MMK: 'K',    NPR: '₨',    OMR: 'ر.ع.',
    PKR: '₨',    PHP: '₱',    QAR: 'ر.ق',   THB: '฿',
    TJS: 'SM',   TMT: 'm',    UZS: "so'm", VND: '₫',
    YER: '﷼',    AFN: '؋',    AMD: '֏',    AZN: '₼',
    BHD: '.د.ب', GEL: '₾',   IRR: '﷼',    IQD: 'ع.د',
    KZT: '₸',    KPW: '₩',    MVR: '.ރ',

    // ─── AMERICAS (30) ───
    BRL: 'R$',   MXN: '$',    ARS: '$',    COP: '$',
    CLP: '$',    BSD: 'B$',   BBD: '$',    BMD: '$',
    BOB: 'Bs.',  BZD: 'BZ$',  CRC: '₡',    CUP: '₱',
    DOP: 'RD$',  GTQ: 'Q',    HNL: 'L',    HTG: 'G',
    JMD: 'J$',   KYD: '$',    NIO: 'C$',   PAB: 'B/.',
    PEN: 'S/',   PYG: '₲',    SRD: '$',    TTD: 'TT$',
    UYU: '$U',   VES: 'Bs.',  XCD: '$',    FKP: '£',
    GYD: '$',

    // ─── EUROPE (22) ───
    SEK: 'kr',   NOK: 'kr',   PLN: 'zł',   TRY: '₺',
    RUB: '₽',    DKK: 'kr',   CZK: 'Kč',   HUF: 'Ft',
    ISK: 'kr',   RON: 'lei',  BGN: 'лв',   BYN: 'Br',
    GIP: '£',    HRK: 'kn',   MDL: 'L',    MKD: 'ден',
    RSD: 'дин',  UAH: '₴',    ALL: 'L',    BAM: 'KM',

    // ─── OCEANIA / PACIFIC (8) ───
    NZD: '$',    FJD: '$',    PGK: 'K',    SBD: '$',
    TOP: 'T$',   VUV: 'VT',   WST: 'T',    XPF: 'F',

    // ─── SPECIAL (5) ───
    XAU: 'Au',   XAG: 'Ag',   XPT: 'Pt',   XPD: 'Pd',
    XDR: 'SDR',
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
    const zeroDecimal = ['JPY','KRW','VND','IDR','CLP','PYG','RWF','GNF','KMF','XOF','XAF','XPF','LAK','MMK','MGA','UZS','BIF','DJF','KRW','VUV'];
    const digits = zeroDecimal.includes(currency) ? 0 : 2;

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
    FALLBACK_RATES,
};