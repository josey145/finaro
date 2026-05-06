// Account Model - Database queries for account and balance operations
const pool = require('../config/database');

class Account {
  // Get user account
  static async getAccount(userId) {
    const [rows] = await pool.query(
      'SELECT * FROM accounts WHERE user_id = ?',
      [userId]
    );
    return rows[0];
  }

  // Create account for user
  static async createAccount(userId, accountNumber, accountType = 'savings') {
    const [result] = await pool.query(
      'INSERT INTO accounts (user_id, account_number, account_type, balance, status, created_at) VALUES (?, ?, ?, 0, "active", NOW())',
      [userId, accountNumber, accountType]
    );
    return result.insertId;
  }

  // Get account balance
  static async getBalance(userId) {
    const [rows] = await pool.query(
      'SELECT balance FROM accounts WHERE user_id = ?',
      [userId]
    );
    return rows[0] ? rows[0].balance : 0;
  }

  // Add funds to account
  static async addFunds(userId, amount) {
    const [result] = await pool.query(
      'UPDATE accounts SET balance = balance + ? WHERE user_id = ?',
      [amount, userId]
    );
    return result.affectedRows;
  }

  // Withdraw funds from account
  static async withdrawFunds(userId, amount) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      
      const [account] = await conn.query(
        'SELECT balance FROM accounts WHERE user_id = ? FOR UPDATE',
        [userId]
      );
      
      if (!account[0] || account[0].balance < amount) {
        throw new Error('Insufficient funds');
      }

      await conn.query(
        'UPDATE accounts SET balance = balance - ? WHERE user_id = ?',
        [amount, userId]
      );

      await conn.commit();
      return true;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  // Get all accounts (admin)
  static async getAllAccounts(limit = 50, offset = 0) {
    const [rows] = await pool.query(
      'SELECT a.*, u.first_name, u.last_name, u.email FROM accounts a JOIN users u ON a.user_id = u.id LIMIT ? OFFSET ?',
      [limit, offset]
    );
    return rows;
  }
}

module.exports = Account;
