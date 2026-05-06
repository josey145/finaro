const axios = require('axios');
require('dotenv').config();

const sendSMS = async (phone, message) => {
    if (!process.env.TERMII_API_KEY) {
        console.log('⚠️  Termii not configured. SMS skipped.');
        return false;
    }
    if (!phone) {
        console.log('⚠️  No phone number. SMS skipped.');
        return false;
    }

    try {
        const response = await axios.post('https://v3.api.termii.com/api/sms/send', {
            to:      phone,
            from:    process.env.TERMII_SENDER_ID || 'Finora',
            sms:     message,
            type:    'plain',
            channel: 'generic',
            api_key: process.env.TERMII_API_KEY,
        });

        console.log('📱 SMS sent to', phone, '| Status:', response.data.message);
        return true;
    } catch (error) {
        console.error('❌ Termii SMS failed:', error.response?.data || error.message);
        return false;
    }
};

const sendTransactionSMS = async (phone, transaction) => {
    const { type, amount, description } = transaction;

    const formatted = parseFloat(amount).toLocaleString('en-US', {
        style: 'currency', currency: 'USD'
    });

    const isCredit = type === 'admin_credit';
    const icon     = isCredit ? '💰' : '💸';
    const verb     = isCredit ? 'credited to' : 'deducted from';

    const message =
        `${icon} Finora Bank: ${formatted} has been ${verb} your account. ` +
        `Ref: ${description || type}. ` +
        `If unauthorized, contact support immediately.`;

    return sendSMS(phone, message);
};

module.exports = { sendSMS, sendTransactionSMS };