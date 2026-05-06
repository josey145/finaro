// Transaction Model - Database queries for transaction logging
const pool = require('../config/database');

class Transaction {
  // Create transaction record
  static async create(transactionData) {
    const { userId, type, amount, description, status = 'completed', reference } = transactionData;
    const [result] = await pool.query(
      'INSERT INTO transactions (user_id, type, amount, description, status, reference, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
      [userId, type, amount, description, status, reference]
    );
    return result.insertId;
  }

  // Get user transactions
  static async getUserTransactions(userId, limit = 50, offset = 0) {
    const [rows] = await pool.query(
      'SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [userId, limit, offset]
    );
    return rows;
  }

  // Get all transactions (admin)
  static async getAllTransactions(limit = 50, offset = 0) {
    const [rows] = await pool.query(
      'SELECT t.*, u.first_name, u.last_name, u.email FROM transactions t JOIN users u ON t.user_id = u.id ORDER BY t.created_at DESC LIMIT ? OFFSET ?',
      [limit, offset]
    );
    return rows;
  }

  // Get transaction by reference
  static async getByReference(reference) {
    const [rows] = await pool.query(
      'SELECT * FROM transactions WHERE reference = ?',
      [reference]
    );
    return rows[0];
  }

  // Get transaction statistics
  static async getStatistics(userId) {
    const [rows] = await pool.query(
      `SELECT 
        COUNT(*) as total_transactions,
        SUM(CASE WHEN type = 'deposit' THEN amount ELSE 0 END) as total_deposits,
        SUM(CASE WHEN type = 'withdrawal' THEN amount ELSE 0 END) as total_withdrawals,
        SUM(CASE WHEN type = 'transfer' THEN amount ELSE 0 END) as total_transfers
      FROM transactions WHERE user_id = ?`,
      [userId]
    );
    return rows[0];
  }
}

module.exports = Transaction;
