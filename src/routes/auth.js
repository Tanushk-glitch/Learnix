const express = require("express");
const bcrypt = require("bcrypt");
const db = require("../config/database");
const path = require("path");

const router = express.Router();
const AUTH_TABLE = "auth_users";
const TEACHER_TABLE = "teacher";
const DEPT_TABLE = "dept";
const COURSE_TABLE = "courses";
const ENROLL_TABLE = "enrollment";
const ENROLL_REQUEST_TABLE = "enrollment_requests";
let deptColumnCache = null;
let teacherIdAutoIncrement = null;
let courseColumnCache = null;

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

db.query(
  `CREATE TABLE IF NOT EXISTS ${TEACHER_TABLE} (
    teacher_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    phone_no VARCHAR(15) NOT NULL,
    dept_id INT,
    FOREIGN KEY (dept_id) REFERENCES ${DEPT_TABLE}(dept_id)
  )`,
  (err) => {
    if (err) console.error("Failed to ensure teacher table:", err.message);
  }
);

db.query(
  `CREATE TABLE IF NOT EXISTS ${COURSE_TABLE} (
    course_id INT AUTO_INCREMENT PRIMARY KEY,
    course_name VARCHAR(100) NOT NULL,
    credits INT NOT NULL,
    dept_id INT NULL,
    teacher_id INT NULL,
    FOREIGN KEY (dept_id) REFERENCES ${DEPT_TABLE}(dept_id),
    FOREIGN KEY (teacher_id) REFERENCES ${TEACHER_TABLE}(teacher_id)
  )`,
  (err) => {
    if (err) console.error("Failed to ensure courses table:", err.message);
  }
);

db.query(
  `CREATE TABLE IF NOT EXISTS ${ENROLL_TABLE} (
    enrollment_id INT AUTO_INCREMENT PRIMARY KEY,
    grade VARCHAR(2),
    enrollment_date DATE,
    auth_user_id INT,
    course_id INT,
    FOREIGN KEY (auth_user_id) REFERENCES ${AUTH_TABLE}(id),
    FOREIGN KEY (course_id) REFERENCES ${COURSE_TABLE}(course_id)
  )`,
  (err) => {
    if (err) console.error("Failed to ensure enrollment table:", err.message);
  }
);

db.query(
  `CREATE TABLE IF NOT EXISTS ${ENROLL_REQUEST_TABLE} (
    request_id INT AUTO_INCREMENT PRIMARY KEY,
    student_name VARCHAR(200) NOT NULL,
    student_email VARCHAR(150) NOT NULL,
    student_phone VARCHAR(15) NOT NULL,
    department VARCHAR(100),
    course_id INT NOT NULL,
    request_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (course_id) REFERENCES ${COURSE_TABLE}(course_id)
  )`,
  (err) => {
    if (err) console.error("Failed to ensure enrollment_requests table:", err.message);
  }
);

const repairCoursesForeignKeys = () => {
  db.query(
    `SELECT CONSTRAINT_NAME
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND REFERENCED_TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [COURSE_TABLE, TEACHER_TABLE, "course_id"],
    (findErr, rows) => {
      if (findErr) {
        console.error("Failed to inspect course foreign keys:", findErr.message);
        return;
      }

      const badConstraints = (rows || []).map((r) => r.CONSTRAINT_NAME).filter(Boolean);
      badConstraints.forEach((constraintName) => {
        db.query(
          `ALTER TABLE ${COURSE_TABLE} DROP FOREIGN KEY \`${constraintName}\``,
          (dropErr) => {
            if (dropErr) {
              console.error(`Failed to drop bad foreign key ${constraintName}:`, dropErr.message);
            } else {
              console.log(`Dropped invalid foreign key ${constraintName} on ${COURSE_TABLE}.course_id`);
            }
          }
        );
      });
    }
  );
};

repairCoursesForeignKeys();

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

const getTeacherIdAutoIncrement = (callback) => {
  if (teacherIdAutoIncrement !== null) {
    return callback(null, teacherIdAutoIncrement);
  }

  db.query(`SHOW COLUMNS FROM ${TEACHER_TABLE} LIKE 'teacher_id'`, (err, rows) => {
    if (err) return callback(err);
    if (!rows || rows.length === 0) {
      return callback(new Error("Teacher table is missing teacher_id column"));
    }

    teacherIdAutoIncrement = String(rows[0].Extra || "").toLowerCase().includes("auto_increment");
    return callback(null, teacherIdAutoIncrement);
  });
};

const getCourseColumns = (callback) => {
  if (courseColumnCache) {
    return callback(null, courseColumnCache);
  }

  db.query(`SHOW COLUMNS FROM ${COURSE_TABLE}`, (err, rows) => {
    if (err) return callback(err);

    const fields = new Set((rows || []).map((row) => row.Field));
    const idCol = fields.has("course_id")
      ? "course_id"
      : fields.has("course")
        ? "course"
        : fields.has("id")
          ? "id"
          : null;
    const nameCol = fields.has("course_name")
      ? "course_name"
      : fields.has("courses_name")
        ? "courses_name"
        : fields.has("name")
          ? "name"
          : null;
    const creditsCol = fields.has("credits") ? "credits" : null;
    const deptCol = fields.has("dept_id") ? "dept_id" : null;
    const teacherCol = fields.has("teacher_id") ? "teacher_id" : null;
    const idColumnMeta = (rows || []).find((row) => row.Field === idCol);
    const idAutoIncrement = !!(
      idColumnMeta &&
      String(idColumnMeta.Extra || "").toLowerCase().includes("auto_increment")
    );

    if (!idCol || !nameCol) {
      return callback(new Error("Courses table is missing required columns"));
    }

    courseColumnCache = {
      idCol,
      nameCol,
      creditsCol,
      deptCol,
      teacherCol,
      idAutoIncrement
    };
    return callback(null, courseColumnCache);
  });
};

const insertTeacherAccount = ({ username, email, hashedPassword, phoneNo, deptId }, callback) => {
  getTeacherIdAutoIncrement((metaErr, isAutoIncrement) => {
    if (metaErr) return callback(metaErr);

    if (isAutoIncrement) {
      db.query(
        `INSERT INTO ${TEACHER_TABLE} (name, email, password, phone_no, dept_id) VALUES (?, ?, ?, ?, ?)`,
        [username, email, hashedPassword, phoneNo, deptId],
        callback
      );
      return;
    }

    db.query(
      `SELECT COALESCE(MAX(teacher_id), 0) + 1 AS next_id FROM ${TEACHER_TABLE}`,
      (nextErr, rows) => {
        if (nextErr) return callback(nextErr);
        const nextId = rows[0].next_id;

        db.query(
          `INSERT INTO ${TEACHER_TABLE} (teacher_id, name, email, password, phone_no, dept_id) VALUES (?, ?, ?, ?, ?, ?)`,
          [nextId, username, email, hashedPassword, phoneNo, deptId],
          callback
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

      if (normalizedRole === "teacher") {
        insertTeacherAccount(
          { username, email, hashedPassword, phoneNo: normalizedPhoneNo, deptId: resolvedDeptId },
          (teacherErr) => {
            if (teacherErr) {
              console.error(teacherErr);
              if (teacherErr.code === "ER_DUP_ENTRY") {
                return res.status(400).send("Email already registered");
              }
              return res.status(500).send(`Error during teacher registration: ${teacherErr.sqlMessage}`);
            }
            return res.redirect("/login.html");
          }
        );
        return;
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
          return res.redirect("/login.html");
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

        if (normalizedRole === "teacher") {
          db.query(
            `SELECT teacher_id, name, email, phone_no, dept_id, password
             FROM ${TEACHER_TABLE}
             WHERE email = ? AND dept_id = ?`,
            [email, resolvedDeptId],
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

              req.session.userId = results[0].teacher_id;
              req.session.userSource = "teacher";
              req.session.user = {
                id: results[0].teacher_id,
                username: results[0].name,
                email: results[0].email,
                phone_no: results[0].phone_no,
                role: "teacher",
                dept_id: results[0].dept_id,
                department: resolvedDeptName || ""
              };
              return res.redirect("/home_page.html");
            }
          );
          return;
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
            req.session.userSource = "auth_users";
            req.session.user = {
              id: results[0].id,
              username: results[0].username,
              email: results[0].email,
              phone_no: results[0].phone_no,
              role: results[0].role,
              dept_id: results[0].dept_id,
              department: resolvedDeptName || ""
            };
            res.redirect("/home_page.html");
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

    const userSource = req.session.userSource || "auth_users";

    if (userSource === "teacher") {
      getDeptColumns((deptColumnsErr, deptColumns) => {
        if (deptColumnsErr) {
          console.error(deptColumnsErr);
          return res.status(500).json({ error: "Failed to resolve department schema" });
        }

        db.query(
          `SELECT t.teacher_id AS id, t.name AS username, t.email, t.phone_no, 'teacher' AS role, t.dept_id, d.${deptColumns.nameCol} AS department
           FROM ${TEACHER_TABLE} t
           LEFT JOIN ${DEPT_TABLE} d ON d.${deptColumns.idCol} = t.dept_id
           WHERE t.teacher_id = ?`,
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
      return;
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

router.post("/api/enroll", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Please log in first" });
  }

  if (req.session.userSource === "teacher") {
    return res.status(403).json({ error: "Teachers cannot enroll in courses" });
  }

  const rawCourseName = req.body && req.body.courseName ? String(req.body.courseName).trim() : "";
  if (!rawCourseName) {
    return res.status(400).json({ error: "courseName is required" });
  }

  const userId = req.session.userId;
  const userDeptId = req.session.user && req.session.user.dept_id ? Number(req.session.user.dept_id) : null;

  db.query(
    `SELECT course_id, course_name, credits, dept_id, teacher_id
     FROM ${COURSE_TABLE}
     WHERE course_name = ?
     LIMIT 1`,
    [rawCourseName],
    (courseErr, courseRows) => {
      if (courseErr) {
        console.error(courseErr);
        return res.status(500).json({ error: "Failed to fetch course" });
      }

      const continueWithCourse = (course) => {
        db.query(
          `SELECT enrollment_id, enrollment_date
           FROM ${ENROLL_TABLE}
           WHERE auth_user_id = ? AND course_id = ?
           LIMIT 1`,
          [userId, course.course_id],
          (existingErr, existingRows) => {
            if (existingErr) {
              console.error(existingErr);
              return res.status(500).json({ error: "Failed to check enrollment" });
            }

            if (existingRows && existingRows.length > 0) {
              db.query(
                `SELECT c.course_name, c.credits, d.dept_name, t.name AS teacher_name, e.enrollment_date
                 FROM ${ENROLL_TABLE} e
                 JOIN ${COURSE_TABLE} c ON c.course_id = e.course_id
                 LEFT JOIN ${DEPT_TABLE} d ON d.dept_id = c.dept_id
                 LEFT JOIN ${TEACHER_TABLE} t ON t.teacher_id = c.teacher_id
                 WHERE e.enrollment_id = ?`,
                [existingRows[0].enrollment_id],
                (detailErr, detailRows) => {
                  if (detailErr) {
                    console.error(detailErr);
                    return res.status(500).json({ error: "Failed to load enrollment details" });
                  }
                  return res.json({
                    message: "Already enrolled in this course",
                    alreadyEnrolled: true,
                    enrollment: detailRows[0] || null
                  });
                }
              );
              return;
            }

            db.query(
              `INSERT INTO ${ENROLL_TABLE} (grade, enrollment_date, auth_user_id, course_id)
               VALUES (NULL, CURDATE(), ?, ?)`,
              [userId, course.course_id],
              (insertErr, insertResult) => {
                if (insertErr) {
                  console.error(insertErr);
                  return res.status(500).json({ error: "Failed to enroll in course" });
                }

                db.query(
                  `SELECT c.course_name, c.credits, d.dept_name, t.name AS teacher_name, e.enrollment_date
                   FROM ${ENROLL_TABLE} e
                   JOIN ${COURSE_TABLE} c ON c.course_id = e.course_id
                   LEFT JOIN ${DEPT_TABLE} d ON d.dept_id = c.dept_id
                   LEFT JOIN ${TEACHER_TABLE} t ON t.teacher_id = c.teacher_id
                   WHERE e.enrollment_id = ?`,
                  [insertResult.insertId],
                  (detailErr, detailRows) => {
                    if (detailErr) {
                      console.error(detailErr);
                      return res.status(500).json({ error: "Enrollment succeeded but detail fetch failed" });
                    }
                    return res.json({
                      message: "Enrollment successful",
                      alreadyEnrolled: false,
                      enrollment: detailRows[0] || null
                    });
                  }
                );
              }
            );
          }
        );
      };

      if (courseRows && courseRows.length > 0) {
        continueWithCourse(courseRows[0]);
        return;
      }

      db.query(
        `INSERT INTO ${COURSE_TABLE} (course_name, credits, dept_id, teacher_id)
         VALUES (?, ?, ?, NULL)`,
        [rawCourseName, 3, Number.isInteger(userDeptId) ? userDeptId : null],
        (insertCourseErr, insertCourseResult) => {
          if (insertCourseErr) {
            console.error(insertCourseErr);
            return res.status(500).json({ error: "Failed to create course before enrollment" });
          }

          continueWithCourse({
            course_id: insertCourseResult.insertId,
            course_name: rawCourseName
          });
        }
      );
    }
  );
});

router.post("/api/enroll-request", (req, res) => {
  const {
    courseName,
    studentName,
    studentEmail,
    studentPhone,
    department
  } = req.body || {};

  const normalizedCourse = courseName ? String(courseName).trim() : "";
  const normalizedName = studentName ? String(studentName).trim() : "";
  const normalizedEmail = studentEmail ? String(studentEmail).trim().toLowerCase() : "";
  const normalizedPhone = studentPhone ? String(studentPhone).trim() : "";
  const normalizedDept = department ? String(department).trim() : null;

  if (!normalizedCourse || !normalizedName || !normalizedEmail || !normalizedPhone) {
    return res.status(400).json({ error: "courseName, studentName, studentEmail, and studentPhone are required" });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return res.status(400).json({ error: "Invalid email format" });
  }

  if (!/^\d{10}$/.test(normalizedPhone)) {
    return res.status(400).json({ error: "Phone number must be exactly 10 digits" });
  }

  getCourseColumns((courseMetaErr, courseMeta) => {
    if (courseMetaErr) {
      console.error(courseMetaErr);
      return res.status(500).json({ error: "Failed to load courses schema" });
    }

    const { idCol, nameCol, creditsCol, deptCol, teacherCol, idAutoIncrement } = courseMeta;

    db.query(
      `SELECT ${idCol} AS course_id, ${nameCol} AS course_name FROM ${COURSE_TABLE} WHERE ${nameCol} = ? LIMIT 1`,
      [normalizedCourse],
      (courseErr, courseRows) => {
        if (courseErr) {
          console.error(courseErr);
          return res.status(500).json({ error: `Failed to fetch course: ${courseErr.message}` });
        }

        const insertRequest = (courseId) => {
          db.query(
            `INSERT INTO ${ENROLL_REQUEST_TABLE}
             (student_name, student_email, student_phone, department, course_id, request_date)
             VALUES (?, ?, ?, ?, ?, CURDATE())`,
            [normalizedName, normalizedEmail, normalizedPhone, normalizedDept, courseId],
            (insertErr, result) => {
              if (insertErr) {
                console.error(insertErr);
                return res.status(500).json({ error: "Failed to submit enrollment request" });
              }

              db.query(
                `SELECT r.request_id, r.student_name, r.student_email, r.student_phone, r.department, r.request_date, c.${nameCol} AS course_name
                 FROM ${ENROLL_REQUEST_TABLE} r
                 JOIN ${COURSE_TABLE} c ON c.${idCol} = r.course_id
                 WHERE r.request_id = ?`,
                [result.insertId],
                (detailErr, detailRows) => {
                  if (detailErr) {
                    console.error(detailErr);
                    return res.status(500).json({ error: "Request saved but details failed to load" });
                  }
                  return res.json({
                    message: "Enrollment form submitted successfully",
                    request: detailRows && detailRows[0] ? detailRows[0] : null
                  });
                }
              );
            }
          );
        };

        if (courseRows && courseRows.length > 0) {
          insertRequest(courseRows[0].course_id);
          return;
        }

        const columns = [];
        const values = [];
        const placeholders = [];

        if (idCol && !idAutoIncrement) {
          columns.push(idCol);
          placeholders.push("?");
          values.push(null); // replaced with next id below
        }
        columns.push(nameCol);
        placeholders.push("?");
        values.push(normalizedCourse);

        if (creditsCol) {
          columns.push(creditsCol);
          placeholders.push("?");
          values.push(3);
        }
        if (deptCol) {
          columns.push(deptCol);
          placeholders.push("NULL");
        }
        if (teacherCol) {
          columns.push(teacherCol);
          placeholders.push("NULL");
        }

        const executeInsert = (finalValues) => {
          db.query(
            `INSERT INTO ${COURSE_TABLE} (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`,
            finalValues,
            (createErr, createResult) => {
              if (createErr) {
                console.error(createErr);
                return res.status(500).json({ error: `Failed to create course: ${createErr.message}` });
              }
              const createdCourseId = idAutoIncrement ? createResult.insertId : finalValues[0];
              insertRequest(createdCourseId);
            }
          );
        };

        if (!idAutoIncrement) {
          db.query(
            `SELECT COALESCE(MAX(${idCol}), 0) + 1 AS next_id FROM ${COURSE_TABLE}`,
            (nextErr, nextRows) => {
              if (nextErr) {
                console.error(nextErr);
                return res.status(500).json({ error: "Failed to assign new course id" });
              }
              values[0] = nextRows[0].next_id;
              executeInsert(values);
            }
          );
          return;
        }

        executeInsert(values);
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
