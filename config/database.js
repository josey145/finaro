const fs = require('fs');
const mysql = require('mysql2/promise');
require('dotenv').config();

const sslConfig = process.env.NODE_ENV === 'production' 
    ? {
        rejectUnauthorized: true,
        ca: process.env.DB_SSL_CA?.replace(/\\n/g, '\n')
      }
    : {
        rejectUnauthorized: false
      };

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: sslConfig,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
});

pool.getConnection()
    .then(conn => {
        console.log('✅ MySQL connected to:', process.env.DB_NAME);
        conn.release();
    })
    .catch(err => {
        console.error('❌ MySQL connection failed:', err.message);
        process.exit(1);
    });

module.exports = pool;