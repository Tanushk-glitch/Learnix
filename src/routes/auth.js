const express = require("express");
const bcrypt = require("bcrypt");
const db = require("../config/database");
const path = require("path");

const router = express.Router();
const AUTH_TABLE = "auth_users";
const DEPT_TABLE = "dept";
let deptColumnCache = null;

db.query(
  `CREATE TABLE IF NOT EXISTS ${DEPT_TABLE} (
    dept_id INT AUTO_INCREMENT PRIMARY KEY,
    dept_name VARCHAR(50) NOT NULL UNIQUE
  )`,
  (err) => {
    if (err) console.error("Failed to ensure dept table:", err.message);
  }
);

db.query(
  `CREATE TABLE IF NOT EXISTS ${AUTH_TABLE} (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    phone_no VARCHAR(15) NOT NULL,
    role VARCHAR(20) NOT NULL,
    dept_id INT NULL,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dept_id) REFERENCES ${DEPT_TABLE}(dept_id)
  )`,
  (err) => {
    if (err) console.error("Failed to ensure auth_users table:", err.message);
  }
);

const ensureColumn = (columnName, definition) => {
  db.query(
    `SHOW COLUMNS FROM ${AUTH_TABLE} LIKE ?`,
    [columnName],
    (showErr, results) => {
      if (showErr) {
        console.error(`Failed to check column ${columnName}:`, showErr.message);
        return;
      }

      if (results && results.length > 0) return;

      db.query(
        `ALTER TABLE ${AUTH_TABLE} ADD COLUMN ${columnName} ${definition}`,
        (alterErr) => {
          if (alterErr) {
            console.error(`Failed to add column ${columnName}:`, alterErr.message);
          }
        }
      );
    }
  );
};

ensureColumn("role", "VARCHAR(20) NOT NULL DEFAULT 'student'");
ensureColumn("dept_id", "INT NULL");
ensureColumn("phone_no", "VARCHAR(15) NULL");

const getDeptColumns = (callback) => {
  if (deptColumnCache) {
    return callback(null, deptColumnCache);
  }

  db.query(`SHOW COLUMNS FROM ${DEPT_TABLE}`, (err, rows) => {
    if (err) return callback(err);

    const fields = new Set((rows || []).map((row) => row.Field));
    const idCol = fields.has("dept_id") ? "dept_id" : fields.has("id") ? "id" : null;
    const nameCol = fields.has("dept_name") ? "dept_name" : fields.has("name") ? "name" : null;
    const idColumnMeta = (rows || []).find((row) => row.Field === idCol);
    const idAutoIncrement = !!(
      idColumnMeta &&
      String(idColumnMeta.Extra || "").toLowerCase().includes("auto_increment")
    );

    if (!idCol || !nameCol) {
      return callback(new Error("Department table is missing required columns"));
    }

    deptColumnCache = { idCol, nameCol, idAutoIncrement };
    return callback(null, deptColumnCache);
  });
};

const resolveDepartmentId = ({ deptId, departmentName, createIfMissing }, callback) => {
  const normalizedDepartment = departmentName ? String(departmentName).trim() : "";
  const parsedDeptId = deptId ? Number(deptId) : null;

  getDeptColumns((deptColumnsErr, deptColumns) => {
    if (deptColumnsErr) return callback(deptColumnsErr);

    const { idCol, nameCol, idAutoIncrement } = deptColumns;

    if (Number.isInteger(parsedDeptId) && parsedDeptId > 0) {
      db.query(
        `SELECT ${idCol} AS dept_id, ${nameCol} AS dept_name FROM ${DEPT_TABLE} WHERE ${idCol} = ?`,
        [parsedDeptId],
        (err, rows) => {
          if (err) return callback(err);
          if (!rows || rows.length === 0) {
            return callback(new Error("Invalid department selected"));
          }
          return callback(null, rows[0].dept_id, rows[0].dept_name);
        }
      );
      return;
    }

    if (!normalizedDepartment) {
      return callback(new Error("Department is required"));
    }

    db.query(
      `SELECT ${idCol} AS dept_id, ${nameCol} AS dept_name FROM ${DEPT_TABLE} WHERE ${nameCol} = ?`,
      [normalizedDepartment],
      (findErr, rows) => {
        if (findErr) return callback(findErr);
        if (rows && rows.length > 0) {
          return callback(null, rows[0].dept_id, rows[0].dept_name);
        }

        if (!createIfMissing) {
          return callback(new Error("Invalid department selected"));
        }

        if (idAutoIncrement) {
          db.query(
            `INSERT INTO ${DEPT_TABLE} (${nameCol}) VALUES (?)`,
            [normalizedDepartment],
            (insertErr, result) => {
              if (insertErr) return callback(insertErr);
              return callback(null, result.insertId, normalizedDepartment);
            }
          );
          return;
        }

        db.query(
          `SELECT COALESCE(MAX(${idCol}), 0) + 1 AS next_id FROM ${DEPT_TABLE}`,
          (maxErr, maxRows) => {
            if (maxErr) return callback(maxErr);
            const nextId = maxRows[0].next_id;

            db.query(
              `INSERT INTO ${DEPT_TABLE} (${idCol}, ${nameCol}) VALUES (?, ?)`,
              [nextId, normalizedDepartment],
              (insertErr) => {
                if (insertErr) return callback(insertErr);
                return callback(null, nextId, normalizedDepartment);
              }
            );
          }
        );
      }
    );
  });
};

/*signup*/


router.post("/signup", async (req, res) => {
  const { username, email, phone_no: phoneNo, password, confirmPassword, role, department, dept_id: deptId } = req.body;
  const normalizedRole = role ? String(role).trim().toLowerCase() : "";
  const normalizedPhoneNo = phoneNo ? String(phoneNo).trim() : "";

  if (!username || !email || !normalizedPhoneNo || !password || !confirmPassword || !normalizedRole) {
    return res.status(400).send("All fields are required");
  }

  if (!/^\d{10}$/.test(normalizedPhoneNo)) {
    return res.status(400).send("Phone number must be exactly 10 digits");
  }

  if (!["student", "teacher"].includes(normalizedRole)) {
    return res.status(400).send("Invalid role selected");
  }

  if (password !== confirmPassword) {
    return res.status(400).send("Passwords do not match");
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  resolveDepartmentId(
    { deptId, departmentName: department, createIfMissing: true },
    (deptErr, resolvedDeptId) => {
      if (deptErr) {
        return res.status(400).send(deptErr.message || "Invalid department selected");
      }

      db.query(
        `INSERT INTO ${AUTH_TABLE} (username, email, phone_no, role, dept_id, password) VALUES (?, ?, ?, ?, ?, ?)`,
        [username, email, normalizedPhoneNo, normalizedRole, resolvedDeptId, hashedPassword],
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
    }
  );
});

/*login*/


router.post("/login", (req, res) => {
    const { username: email, password, role, department, dept_id: deptId } = req.body;
    const normalizedRole = role ? String(role).trim().toLowerCase() : "";

    if (!email || !password || !normalizedRole) {
        return res.status(400).send("All fields are required");
    }

    resolveDepartmentId(
      { deptId, departmentName: department, createIfMissing: false },
      (deptErr, resolvedDeptId, resolvedDeptName) => {
        if (deptErr) {
          return res.status(400).send("Invalid department selected");
        }

        db.query(
          `SELECT id, username, email, phone_no, role, dept_id, password
           FROM ${AUTH_TABLE}
           WHERE email = ? AND role = ? AND dept_id = ?`,
          [email, normalizedRole, resolvedDeptId],
          async (err, results) => {
            if (err) {
              console.error(err);
              return res.send("Error during login");
            }
            if (!results || results.length === 0) {
              return res.send("Invalid email or password");
            }

            const isMatch = await bcrypt.compare(password, results[0].password);
            if (!isMatch) {
              return res.send("Invalid email or password");
            }

            req.session.userId = results[0].id;
            req.session.user = {
              id: results[0].id,
              username: results[0].username,
              email: results[0].email,
              phone_no: results[0].phone_no,
              role: results[0].role,
              dept_id: results[0].dept_id,
              department: resolvedDeptName || ""
            };
            res.redirect("/dashboard");
          }
        );
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

    getDeptColumns((deptColumnsErr, deptColumns) => {
        if (deptColumnsErr) {
            console.error(deptColumnsErr);
            return res.status(500).json({ error: "Failed to resolve department schema" });
        }

        db.query(
            `SELECT u.id, u.username, u.email, u.phone_no, u.role, u.dept_id, d.${deptColumns.nameCol} AS department
             FROM ${AUTH_TABLE} u
             LEFT JOIN ${DEPT_TABLE} d ON d.${deptColumns.idCol} = u.dept_id
             WHERE u.id = ?`,
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
});
/*logout*/ 

router.get("/logout", (req, res) => {
    req.session.destroy();
    res.redirect("/login.html");
});

module.exports = router;
