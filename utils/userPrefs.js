// utils/userPrefs.js
// ─────────────────────────────────────────────────────────────────────────────
// Call getUserPrefs(pool, userId) in any controller to get the user's
// currency, theme, language and a ready-made formatMoney function.
// ─────────────────────────────────────────────────────────────────────────────

const CURRENCY_SYMBOLS = {
    USD:'$',  EUR:'€',  GBP:'£',  JPY:'¥',  CHF:'Fr', CAD:'CA$',
    AUD:'A$', CNY:'¥',  NGN:'₦',  GHS:'₵',  KES:'KSh',ZAR:'R',
    EGP:'E£', ETB:'Br', TZS:'TSh',UGX:'USh',MAD:'د.م.',XOF:'CFA',
    INR:'₹',  SGD:'S$', HKD:'HK$',KRW:'₩',  MYR:'RM', IDR:'Rp',
    PHP:'₱',  THB:'฿',  AED:'د.إ',SAR:'﷼',  BRL:'R$', MXN:'MX$',
    ARS:'AR$',COP:'COP',CLP:'CLP',SEK:'kr',  NOK:'kr', DKK:'kr',
    PLN:'zł', TRY:'₺',  RUB:'₽',
};

const getUserPrefs = async (pool, userId) => {
    try {
        const [[prefs]] = await pool.execute(
            `SELECT preferred_language, preferred_currency, preferred_theme,
                    notif_email, notif_sms, notif_push
             FROM users WHERE id = ?`,
            [userId]
        );

        const lang     = prefs?.preferred_language || 'en';
        const currency = prefs?.preferred_currency || 'USD';
        const theme    = prefs?.preferred_theme    || 'light';
        const symbol   = CURRENCY_SYMBOLS[currency] || currency;

        const formatMoney = (amount) => {
            const num = parseFloat(amount || 0);
            return symbol + num.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            });
        };

        return { lang, currency, theme, currencySymbol: symbol, formatMoney };
    } catch (err) {
        console.error('getUserPrefs error:', err.message);
        // Safe defaults if DB fails
        const formatMoney = (amount) => '$' + parseFloat(amount || 0).toFixed(2);
        return { lang: 'en', currency: 'USD', theme: 'light', currencySymbol: '$', formatMoney };
    }
};

module.exports = { getUserPrefs, CURRENCY_SYMBOLS };