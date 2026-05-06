// User Model - Database queries for user operations
const pool = require('../config/database');

class User {
  // Find user by email
  static async findByEmail(email) {
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    return rows[0];
  }

  // Find user by ID
  static async findById(id) {
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
    return rows[0];
  }

  // Create new user
  static async create(userData) {
    const { firstName, lastName, email, phone, password, pin, country, idType, idNumber } = userData;
    const [result] = await pool.query(
      'INSERT INTO users (first_name, last_name, email, phone, password, pin, country, id_type, id_number, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
      [firstName, lastName, email, phone, password, pin, country, idType, idNumber]
    );
    return result.insertId;
  }

  // Update user profile
  static async updateProfile(userId, data) {
    const [result] = await pool.query(
      'UPDATE users SET first_name = ?, last_name = ?, phone = ?, country = ? WHERE id = ?',
      [data.firstName, data.lastName, data.phone, data.country, userId]
    );
    return result.affectedRows;
  }

  // Verify email
  static async verifyEmail(userId) {
    const [result] = await pool.query(
      'UPDATE users SET email_verified = 1, email_verified_at = NOW() WHERE id = ?',
      [userId]
    );
    return result.affectedRows;
  }

  // Get all users (admin)
  static async getAllUsers(limit = 50, offset = 0) {
    const [rows] = await pool.query(
      'SELECT id, first_name, last_name, email, phone, status, created_at FROM users LIMIT ? OFFSET ?',
      [limit, offset]
    );
    return rows;
  }

  // Update user status (admin)
  static async updateStatus(userId, status) {
    const [result] = await pool.query(
      'UPDATE users SET status = ? WHERE id = ?',
      [status, userId]
    );
    return result.affectedRows;
  }
}

module.exports = User;
