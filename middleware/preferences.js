// middleware/preferences.js
const pool = require('../config/database');
const { formatMoneySync, getSymbol } = require('../utils/currencyConverter');

module.exports = async function preferencesMiddleware(req, res, next) {
    // ── Defaults ─────────────────────────────────────────────────────────────
    res.locals._lang = 'en';
    res.locals._theme = 'light';
    res.locals._currency = 'USD';
    res.locals._symbol = '$';
    res.locals.lang = 'en';
    res.locals.theme = 'light';
    res.locals.currency = 'USD';
    res.locals.currencySymbol = '$';
    res.locals.formatMoney = (amt) => '$' + (parseFloat(amt)||0).toFixed(2);

    if (!req.user || !req.user.id) return next();

    try {
        const [[prefs]] = await pool.execute(
            `SELECT preferred_language, preferred_currency, preferred_theme,
                    notif_email, notif_sms, notif_push
             FROM users WHERE id = ?`,
            [req.user.id]
        );

        if (prefs) {
            const lang = prefs.preferred_language || 'en';
            const currency = prefs.preferred_currency || 'USD';
            const theme = prefs.preferred_theme || 'light';
            const symbol = getSymbol(currency);

            res.locals._lang = lang;
            res.locals._theme = theme;
            res.locals._currency = currency;
            res.locals._symbol = symbol;
            res.locals.lang = lang;
            res.locals.theme = theme;
            res.locals.currency = currency;
            res.locals.currencySymbol = symbol;

            // THIS IS THE FIX: Use async formatMoney that CONVERTS
            const { formatMoney } = require('../utils/currencyConverter');
            res.locals.formatMoney = async (amt) => await formatMoney(amt, currency);
            
            // Also provide a sync version for EJS that uses pre-converted values
            res.locals._fmt = (amt) => symbol + (parseFloat(amt)||0).toLocaleString('en-US', {minimumFractionDigits: 2});

            req.session.lang = lang;
            req.session.currency = currency;
            req.session.theme = theme;
        }
    } catch (err) {
        console.error('Preferences middleware error:', err.message);
    }

    next();
};