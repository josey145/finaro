const pool = require('../config/database');

async function applySavingsInterest() {
    try {
        // Apply 0.5% monthly interest to savings accounts
        const [result] = await pool.execute(
            `UPDATE accounts 
             SET balance = balance * 1.005 
             WHERE account_type = 'savings' 
             AND status = 'active' 
             AND balance > 0`
        );
        
        console.log(`[${new Date().toISOString()}] Applied interest to ${result.affectedRows} savings accounts`);
    } catch (error) {
        console.error('Interest job failed:', error);
    }
}

// Run monthly (you'll need node-cron)
function startInterestJob() {
    const cron = require('node-cron');
    // Run at midnight on 1st of every month
    cron.schedule('0 0 1 * *', applySavingsInterest);
    console.log('Savings interest job scheduled (monthly)');
}

module.exports = { applySavingsInterest, startInterestJob };