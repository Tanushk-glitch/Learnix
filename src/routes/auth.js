const express = require("express");
const bcrypt = require("bcrypt");
const db = require("../config/database");
const path = require("path");

const router = express.Router();
const AUTH_TABLE = "auth_users";

db.query(
  `CREATE TABLE IF NOT EXISTS ${AUTH_TABLE} (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  (err) => {
    if (err) console.error("Failed to ensure auth_users table:", err.message);
  }
);

/*signup*/


router.post("/signup", async (req, res) => {
  const { username, email, password, confirmPassword } = req.body;

  if (!username || !email || !password || !confirmPassword) {
    return res.status(400).send("All fields are required");
  }

  if (password !== confirmPassword) {
    return res.status(400).send("Passwords do not match");
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  db.query(
    `INSERT INTO ${AUTH_TABLE} (username, email, password) VALUES (?, ?, ?)`,
    [username, email, hashedPassword],
    (err) => {
      if (err) {
        console.error(err);
        if (err.code === "ER_DUP_ENTRY") {
          return res.status(400).send("Email already registered");
        }
        return res.status(500).send(`Error during registration: ${err.sqlMessage}`);
      }
      res.redirect("/login.html");
    }
  );
});

/*login*/


router.post("/login", (req, res) => {
    const { username: email, password } = req.body;

    db.query(
       `SELECT * FROM ${AUTH_TABLE} WHERE email = ?`,
         [email], 
         async (err, results) => {
            if (err) {
                console.error(err);
                return res.send("Error during login");
            }
            if (!results ||results.length === 0) 
                return res.send("Invalid email or password");

            const isMatch = await bcrypt.compare(password, results[0].password);
            if (!isMatch) 
                return res.send("Invalid email or password");

            req.session.userId = results[0].id;
            req.session.user = {
                id: results[0].id,
                username: results[0].username,
                email: results[0].email
            };
            res.redirect("/dashboard");
        }
    );
});

/*DAshboard*/
router.get("/dashboard", (req, res) => {
    if (!req.session.userId) return res.redirect("/login.html");
    res.sendFile(path.join(__dirname, "..", "..", "public", "dashboard.html"));
});

router.get("/profile", (req, res) => {
    if (!req.session.userId) return res.redirect("/login.html");
    res.sendFile(path.join(__dirname, "..", "..", "public", "profile.html"));
});

router.get("/api/me", (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
    }

    if (req.session.user) {
        return res.json(req.session.user);
    }

    db.query(
        `SELECT id, username, email FROM ${AUTH_TABLE} WHERE id = ?`,
        [req.session.userId],
        (err, results) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: "Failed to fetch user profile" });
            }

            if (!results || results.length === 0) {
                return res.status(404).json({ error: "User not found" });
            }

            req.session.user = results[0];
            return res.json(results[0]);
        }
    );
});
/*logout*/ 

router.get("/logout", (req, res) => {
    req.session.destroy();
    res.redirect("/login.html");
});

module.exports = router;
