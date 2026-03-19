const mysql = require("mysql2");

const db = mysql.createConnection({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "Sunil#1978.",
  database: process.env.DB_NAME || "university"
});

db.connect((err) => {
  if (err) {
    console.error("MySQL connection failed:", err.message);
    process.exit(1);
  }
  console.log("Connected to MySQL database!");
});

module.exports = db;
