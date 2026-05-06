const twilio = require('twilio');

// Initialize Twilio client if credentials exist
let client = null;
if (process.env.TWILIO_SID && process.env.TWILIO_AUTH_TOKEN) {
    client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
}

const sendSMS = async (phone, message) => {
    if (!client) {
        console.log('⚠️  Twilio not configured. SMS skipped.');
        return false;
    }
    if (!phone) {
        console.log('⚠️  No phone number. SMS skipped.');
        return false;
    }

    try {
        await client.messages.create({
            body: message,
            from: process.env.TWILIO_PHONE,
            to: phone
        });
        console.log('📱 SMS sent to', phone);
        return true;
    } catch (error) {
        console.error('❌ SMS failed:', error.message);
        return false;
    }
};

const sendTransactionSMS = async (phone, transaction) => {
    const { type, amount, status } = transaction;
    const amt = parseFloat(amount).toLocaleString('en-US', {
        style: 'currency', currency: 'USD'
    });

    const typeEmoji = {
        withdrawal: '💸',
        transfer: '↔️',
        deposit: '💰',
        move: '🔄'
    };

    const message = `${typeEmoji[type] || '🔔'} Finora Alert: ${type.toUpperCase()} of ${amt} is ${status.toUpperCase()}. If unauthorized, call +1-800-FINORA immediately.`;

    return sendSMS(phone, message);
};

module.exports = { sendSMS, sendTransactionSMS };