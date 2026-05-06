const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const generateToken = () => crypto.randomBytes(32).toString('hex');
const generateVerificationToken = () => crypto.randomBytes(32).toString('hex');

const generateWithdrawalCode = () => {
    return Math.floor(1000000 + Math.random() * 9000000).toString();
};

const generateAccountNumber = () => {
    return 'FN' + Date.now() + Math.floor(Math.random() * 1000);
};

const hashPin = async (pin) => {
    const salt = await bcrypt.genSalt(12);
    return bcrypt.hash(pin, salt);
};

const verifyPin = async (inputPin, hashedPin) => {
    return bcrypt.compare(inputPin, hashedPin);
};

// const formatCurrency = (amount, currency = 'USD') => {
//     return new Intl.NumberFormat('en-US', {
//         style: 'currency',
//         currency
//     }).format(amount);
// };

const { formatMoney, getSymbol } = require('./currencyConverter');

// Replace your old formatCurrency with this async version
async function formatCurrency(amount, currency = 'USD') {
    return await formatMoney(amount, currency);
}

// Keep the old one for non-async contexts (fallback)
function formatCurrencySync(amount, currency = 'USD') {
    const symbols = {
        USD: '$', EUR: '€', GBP: '£', JPY: '¥', MYR: 'RM', NGN: '₦',
        CAD: 'C$', AUD: 'A$', SGD: 'S$', HKD: 'HK$', KRW: '₩',
        INR: '₹', CNY: '¥', CHF: 'Fr', SEK: 'kr', NOK: 'kr'
    };
    const symbol = symbols[currency] || currency + ' ';
    const num = parseFloat(amount) || 0;
    return symbol + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}



module.exports = {
    generateToken,
    generateVerificationToken,
    generateWithdrawalCode,
    generateAccountNumber,  // <-- MUST BE EXPORTED
    hashPin,
    verifyPin,
    formatCurrency,
    formatCurrencySync,
    getSymbol
};