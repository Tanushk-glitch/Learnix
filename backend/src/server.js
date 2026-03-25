require("dotenv").config();
const express = require("express");
const session = require("express-session");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const authRoutes = require("./routes/auth");
const db = require("./config/database");

const app = express();
const PUBLIC_DIR = path.join(__dirname, "..", "..", "frontend", "public");
const UPLOADS_DIR = path.join(PUBLIC_DIR, "uploads");
const COURSE_TOPIC_TABLE = "course_topics";
const COURSE_TOPIC_ATTENDANCE_TABLE = "course_topic_attendance";
let courseColumnCache = null;
let enrollmentCourseColumnCache = null;

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const safeName = String(file.originalname || "video")
      .replace(/[^\w.\-]/g, "_")
      .toLowerCase();
    cb(null, `${Date.now()}-${safeName}`);
  }
});

const uploadVideo = multer({
  storage: uploadStorage,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (String(file.mimetype || "").startsWith("video/")) {
      cb(null, true);
      return;
    }
    cb(new Error("Only video files are allowed"));
  }
});

const getCourseColumns = (callback) => {
  if (courseColumnCache) {
    return callback(null, courseColumnCache);
  }

  db.query("SHOW COLUMNS FROM courses", (err, rows) => {
    if (err) {
      return callback(err);
    }

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
    const periodCol = fields.has("course_period")
      ? "course_period"
      : fields.has("period")
        ? "period"
        : null;
    const deptCol = fields.has("dept_id") ? "dept_id" : null;
    const teacherCol = fields.has("teacher_id") ? "teacher_id" : null;
    const videoCol = fields.has("video_path")
      ? "video_path"
      : fields.has("video_url")
        ? "video_url"
        : null;
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
      periodCol,
      deptCol,
      teacherCol,
      videoCol,
      idAutoIncrement
    };
    return callback(null, courseColumnCache);
  });
};

const backfillLegacyCourseIds = () => {
  db.query("SHOW COLUMNS FROM courses", (metaErr, metaRows) => {
    if (metaErr) {
      console.error("Failed to inspect courses schema for legacy id backfill:", metaErr.message);
      return;
    }

    const fields = new Set((metaRows || []).map((row) => row.Field));
    const nameCol = fields.has("course_name")
      ? "course_name"
      : fields.has("courses_name")
        ? "courses_name"
        : fields.has("name")
          ? "name"
          : null;

    if (!fields.has("course_id") || !nameCol) {
      return;
    }

    db.query(
      `SELECT course_id FROM courses WHERE course_id IS NOT NULL`,
      (findErr, rows) => {
        if (findErr) {
          console.error("Failed to inspect legacy course ids:", findErr.message);
          return;
        }

        const numericIds = (rows || [])
          .map((row) => Number(row.course_id))
          .filter((value) => Number.isInteger(value) && value > 0);
        let nextId = numericIds.length ? Math.max(...numericIds) + 1 : 1;

        db.query(
          `SELECT ${nameCol} AS course_name, course_id, video_path
           FROM courses
           WHERE course_id IS NULL`,
          (legacyErr, legacyRows) => {
            if (legacyErr) {
              console.error("Failed to fetch legacy courses without ids:", legacyErr.message);
              return;
            }

            (legacyRows || []).forEach((row) => {
              const rawName = row.course_name || `legacy-course-${nextId}`;
              const assignedId = nextId++;
              db.query(
                `UPDATE courses
                 SET course_id = ?
                 WHERE course_id IS NULL AND ${nameCol} = ? AND video_path <=> ?`,
                [assignedId, rawName, row.video_path || null],
                (updateErr) => {
                  if (updateErr) {
                    console.error(`Failed to assign legacy course id for ${rawName}:`, updateErr.message);
                  } else {
                    courseColumnCache = null;
                  }
                }
              );
            });
          }
        );
      }
    );
  });
};

const getEnrollmentCourseColumn = (callback) => {
  if (enrollmentCourseColumnCache) {
    return callback(null, enrollmentCourseColumnCache);
  }

  db.query("SHOW COLUMNS FROM enrollment", (err, rows) => {
    if (err) {
      return callback(err);
    }

    const fields = new Set((rows || []).map((row) => row.Field));
    const courseCol = fields.has("course_id")
      ? "course_id"
      : fields.has("courses_id")
        ? "courses_id"
        : fields.has("course")
          ? "course"
          : fields.has("enrollment")
            ? "enrollment"
            : null;

    if (!courseCol) {
      return callback(new Error("Enrollment table is missing a course reference column"));
    }

    enrollmentCourseColumnCache = courseCol;
    return callback(null, enrollmentCourseColumnCache);
  });
};

const buildUploadedCoursePagePath = (courseId, courseName, topicId, videoPath) => {
  const params = new URLSearchParams();
  const normalizedCourseId = Number(courseId);
  const normalizedTopicId = Number(topicId);
  const normalizedCourseName = String(courseName || "").trim() || "Uploaded Course";
  const normalizedVideoPath = String(videoPath || "").trim();

  params.set("course", normalizedCourseName);
  if (Number.isInteger(normalizedCourseId) && normalizedCourseId > 0) {
    params.set("courseId", String(normalizedCourseId));
  }
  if (Number.isInteger(normalizedTopicId) && normalizedTopicId > 0) {
    params.set("topicId", String(normalizedTopicId));
  }
  if (normalizedVideoPath) {
    params.set("video", normalizedVideoPath);
  }
  return `/pages/uploaded-course.html?${params.toString()}`;
};

const removeUploadedFile = (rawVideoPath) => {
  const normalizedPath = String(rawVideoPath || "").trim();
  if (!normalizedPath.startsWith("/uploads/")) return;

  const absoluteVideoPath = path.join(PUBLIC_DIR, normalizedPath.replace(/^\//, ""));
  fs.unlink(absoluteVideoPath, (unlinkErr) => {
    if (unlinkErr && unlinkErr.code !== "ENOENT") {
      console.error("Failed to remove uploaded video:", unlinkErr.message);
    }
  });
};


app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: "secret123",
  resave: false,
  saveUninitialized: true,
}));
app.use(authRoutes);

// Root -> login
app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "pages", "login.html"));
});

// Force dashboard file URL through protected dashboard route.
app.get("/dashboard.html", (req, res) => {
  res.redirect("/dashboard");
});

app.get("/profile.html", (req, res) => {
  res.redirect("/profile");
});

// Legacy page URLs -> new structured locations.
app.get("/login.html", (_req, res) => res.redirect("/pages/login.html"));
app.get("/home_page.html", (_req, res) => res.redirect("/pages/home.html"));
app.get("/sign_up.html", (_req, res) => res.redirect("/pages/signup.html"));
app.get("/demo.html", (_req, res) => res.redirect("/pages/demo.html"));
app.get("/Courses.html", (_req, res) => res.redirect("/pages/courses.html"));
app.get("/Sample_vid.html", (_req, res) => res.redirect("/pages/webdev-video.html"));
app.get("/Python_vid.html", (_req, res) => res.redirect("/pages/python-video.html"));
app.get("/DS_vid.html", (_req, res) => res.redirect("/pages/ds-video.html"));
app.get("/UIUX_vid.html", (_req, res) => res.redirect("/pages/uiux-video.html"));
app.get("/temp_ds.html", (_req, res) => res.redirect("/pages/temp-ds.html"));

app.use(express.static(PUBLIC_DIR));
backfillLegacyCourseIds();

db.query(
  `CREATE TABLE IF NOT EXISTS ${COURSE_TOPIC_TABLE} (
    topic_id INT AUTO_INCREMENT PRIMARY KEY,
    course_id INT NOT NULL,
    topic_name VARCHAR(150) NOT NULL,
    topic_order INT NOT NULL DEFAULT 1,
    video_path VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_course_topic (course_id, topic_name),
    CONSTRAINT fk_course_topics_course
      FOREIGN KEY (course_id) REFERENCES courses(course_id)
      ON DELETE CASCADE
  )`,
  (err) => {
    if (err) console.error("Failed to ensure course_topics table:", err.message);
  }
);

db.query(
  `CREATE TABLE IF NOT EXISTS ${COURSE_TOPIC_ATTENDANCE_TABLE} (
    topic_attendance_id INT AUTO_INCREMENT PRIMARY KEY,
    topic_id INT NOT NULL,
    course_id INT NOT NULL,
    auth_user_id INT NOT NULL,
    marked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_topic_attendance (topic_id, auth_user_id),
    CONSTRAINT fk_topic_attendance_topic
      FOREIGN KEY (topic_id) REFERENCES ${COURSE_TOPIC_TABLE}(topic_id)
      ON DELETE CASCADE,
    CONSTRAINT fk_topic_attendance_course
      FOREIGN KEY (course_id) REFERENCES courses(course_id)
      ON DELETE CASCADE
  )`,
  (err) => {
    if (err) console.error("Failed to ensure course_topic_attendance table:", err.message);
  }
);

app.get("/api/courses/:courseId/topics", (req, res) => {
  const courseId = Number(req.params.courseId);
  if (!Number.isInteger(courseId) || courseId <= 0) {
    return res.status(400).json({ error: "Valid courseId is required" });
  }

  getCourseColumns((metaErr, courseMeta) => {
    if (metaErr) {
      console.error(metaErr);
      return res.status(500).json({ error: "Failed to load courses schema" });
    }

    const currentStudentId =
      req.session &&
      req.session.userSource !== "teacher" &&
      Number.isInteger(Number(req.session.userId))
        ? Number(req.session.userId)
        : null;
    const attendanceJoin = currentStudentId
      ? `LEFT JOIN ${COURSE_TOPIC_ATTENDANCE_TABLE} a
           ON a.topic_id = t.topic_id AND a.auth_user_id = ${db.escape(currentStudentId)}`
      : "";

    db.query(
      `SELECT t.topic_id, t.course_id, c.${courseMeta.nameCol} AS course_name,
              t.topic_name, t.topic_order, t.video_path,
              ${currentStudentId ? "a.marked_at AS attendance_marked_at" : "NULL AS attendance_marked_at"}
       FROM ${COURSE_TOPIC_TABLE} t
       JOIN courses c ON c.${courseMeta.idCol} = t.course_id
       ${attendanceJoin}
       WHERE t.course_id = ?
       ORDER BY t.topic_order ASC, t.topic_id ASC`,
      [courseId],
      (err, rows) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: "Failed to load course topics" });
        }

        const topics = (rows || []).map((topic) => ({
          ...topic,
          attendance_marked: !!topic.attendance_marked_at,
          page_path: buildUploadedCoursePagePath(
            topic.course_id,
            topic.course_name,
            topic.topic_id,
            topic.video_path
          )
        }));

        return res.json({ topics });
      }
    );
  });
});

app.post("/api/topics/:topicId/attendance", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Please log in first" });
  }

  if (req.session.userSource === "teacher") {
    return res.status(403).json({ error: "Teachers cannot mark student attendance" });
  }

  const topicId = Number(req.params.topicId);
  if (!Number.isInteger(topicId) || topicId <= 0) {
    return res.status(400).json({ error: "Valid topicId is required" });
  }

  getEnrollmentCourseColumn((metaErr, enrollmentCourseCol) => {
    if (metaErr) {
      console.error(metaErr);
      return res.status(500).json({ error: "Failed to load enrollment schema" });
    }

    db.query("SHOW COLUMNS FROM enrollment", (enrollMetaErr, enrollMetaRows) => {
      if (enrollMetaErr) {
        console.error(enrollMetaErr);
        return res.status(500).json({ error: "Failed to inspect enrollment schema" });
      }

      const enrollFields = new Set((enrollMetaRows || []).map((row) => row.Field));
      const enrollmentUserCol = enrollFields.has("auth_user_id")
        ? "auth_user_id"
        : enrollFields.has("user_id")
          ? "user_id"
          : enrollFields.has("student_id")
            ? "student_id"
            : "auth_user_id";

      db.query(
        `SELECT topic_id, course_id, topic_name
         FROM ${COURSE_TOPIC_TABLE}
         WHERE topic_id = ?
         LIMIT 1`,
        [topicId],
        (findErr, topicRows) => {
          if (findErr) {
            console.error(findErr);
            return res.status(500).json({ error: "Failed to load topic" });
          }

          if (!topicRows || topicRows.length === 0) {
            return res.status(404).json({ error: "Topic not found" });
          }

          const topic = topicRows[0];
          db.query(
            `SELECT 1
             FROM enrollment
             WHERE ${enrollmentUserCol} = ? AND ${enrollmentCourseCol} = ?
             LIMIT 1`,
            [req.session.userId, topic.course_id],
            (enrollErr, enrollRows) => {
              if (enrollErr) {
                console.error(enrollErr);
                return res.status(500).json({ error: "Failed to verify course enrollment" });
              }

              if (!enrollRows || enrollRows.length === 0) {
                return res.status(403).json({ error: "Enroll in this course before marking attendance" });
              }

              db.query(
                `INSERT INTO ${COURSE_TOPIC_ATTENDANCE_TABLE} (topic_id, course_id, auth_user_id)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE marked_at = marked_at`,
                [topic.topic_id, topic.course_id, req.session.userId],
                (insertErr, result) => {
                  if (insertErr) {
                    console.error(insertErr);
                    return res.status(500).json({ error: "Failed to mark attendance" });
                  }

                  return res.json({
                    message:
                      result && result.affectedRows === 1
                        ? "Attendance marked successfully"
                        : "Attendance was already marked for this topic",
                    topicId: topic.topic_id,
                    courseId: topic.course_id,
                    topicName: topic.topic_name,
                    alreadyMarked: !!(result && result.affectedRows !== 1)
                  });
                }
              );
            }
          );
        }
      );
    });
  });
});

app.post("/api/teacher/upload-video", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Please log in first" });
  }

  if (!req.session.user || req.session.user.role !== "teacher") {
    return res.status(403).json({ error: "Only teachers can upload videos" });
  }

  uploadVideo.single("courseVideo")(req, res, (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ error: uploadErr.message || "Upload failed" });
    }

    const courseName = req.body && req.body.courseName ? String(req.body.courseName).trim() : "";
    const topicName = req.body && req.body.topicName ? String(req.body.topicName).trim() : "";
    const rawTopicOrder = req.body && req.body.topicOrder ? String(req.body.topicOrder).trim() : "";
    const parsedTopicOrder = Number.parseInt(rawTopicOrder || "1", 10);
    const topicOrder = Number.isInteger(parsedTopicOrder) && parsedTopicOrder > 0 ? parsedTopicOrder : 1;
    const coursePeriod =
      req.body && req.body.coursePeriod ? String(req.body.coursePeriod).trim() : "";
    if (!courseName) {
      return res.status(400).json({ error: "courseName is required" });
    }

    if (!topicName) {
      return res.status(400).json({ error: "topicName is required" });
    }

    if (!coursePeriod) {
      return res.status(400).json({ error: "coursePeriod is required" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "courseVideo file is required" });
    }

    const filePath = `/uploads/${req.file.filename}`;
    const teacherId = req.session.user && req.session.user.id ? Number(req.session.user.id) : null;
    const teacherDeptId =
      req.session.user && req.session.user.dept_id ? Number(req.session.user.dept_id) : null;

    getCourseColumns((metaErr, courseMeta) => {
      if (metaErr) {
        console.error(metaErr);
        return res.status(500).json({ error: "Failed to load courses schema" });
      }

      const { idCol, nameCol, creditsCol, periodCol, deptCol, teacherCol, videoCol, idAutoIncrement } = courseMeta;

      const saveTopicAndRespond = (courseId) => {
        db.query(
          `SELECT topic_id, video_path
           FROM ${COURSE_TOPIC_TABLE}
           WHERE course_id = ? AND topic_name = ?
           LIMIT 1`,
          [courseId, topicName],
          (topicFindErr, topicRows) => {
            if (topicFindErr) {
              console.error(topicFindErr);
              return res.status(500).json({ error: "Video uploaded but topic save failed" });
            }

            if (topicRows && topicRows.length > 0) {
              const existingTopic = topicRows[0];
              db.query(
                `UPDATE ${COURSE_TOPIC_TABLE}
                 SET topic_order = ?, video_path = ?
                 WHERE topic_id = ?`,
                [topicOrder, filePath, existingTopic.topic_id],
                (topicUpdateErr) => {
                  if (topicUpdateErr) {
                    console.error(topicUpdateErr);
                    return res.status(500).json({ error: "Video uploaded but topic update failed" });
                  }

                  if (existingTopic.video_path && existingTopic.video_path !== filePath) {
                    removeUploadedFile(existingTopic.video_path);
                  }

                  return res.json({
                    message: "Topic uploaded successfully",
                    filePath,
                    coursePagePath: buildUploadedCoursePagePath(courseId, courseName, existingTopic.topic_id, filePath),
                    courseName,
                    coursePeriod,
                    courseId,
                    topicId: existingTopic.topic_id,
                    topicName,
                    topicOrder
                  });
                }
              );
              return;
            }

            db.query(
              `INSERT INTO ${COURSE_TOPIC_TABLE} (course_id, topic_name, topic_order, video_path)
               VALUES (?, ?, ?, ?)`,
              [courseId, topicName, topicOrder, filePath],
              (topicInsertErr, topicInsertResult) => {
                if (topicInsertErr) {
                  console.error(topicInsertErr);
                  return res.status(500).json({ error: "Video uploaded but topic creation failed" });
                }

                return res.json({
                  message: "Topic uploaded successfully",
                  filePath,
                  coursePagePath: buildUploadedCoursePagePath(courseId, courseName, topicInsertResult.insertId, filePath),
                  courseName,
                  coursePeriod,
                  courseId,
                  topicId: topicInsertResult.insertId,
                  topicName,
                  topicOrder
                });
              }
            );
          }
        );
      };

      db.query(
        `SELECT ${idCol} AS course_id FROM courses WHERE ${nameCol} = ? LIMIT 1`,
        [courseName],
        (findErr, rows) => {
          if (findErr) {
            console.error(findErr);
            return res.status(500).json({ error: "Failed to check existing course" });
          }

          if (rows && rows.length > 0) {
            const courseId = rows[0].course_id;
            const updateAssignments = [];
            const updateValues = [];

            if (videoCol) {
              updateAssignments.push(`${videoCol} = ?`);
              updateValues.push(filePath);
            }
            if (periodCol) {
              updateAssignments.push(`${periodCol} = ?`);
              updateValues.push(coursePeriod);
            }
            if (teacherCol) {
              updateAssignments.push(`${teacherCol} = COALESCE(?, ${teacherCol})`);
              updateValues.push(teacherId);
            }
            if (deptCol) {
              updateAssignments.push(`${deptCol} = COALESCE(?, ${deptCol})`);
              updateValues.push(teacherDeptId);
            }

            if (updateAssignments.length === 0) {
              return saveTopicAndRespond(courseId);
            }

            updateValues.push(courseId);
            db.query(
              `UPDATE courses SET ${updateAssignments.join(", ")} WHERE ${idCol} = ?`,
              updateValues,
              (updateErr) => {
                if (updateErr) {
                  console.error(updateErr);
                  return res.status(500).json({ error: "Video uploaded but course update failed" });
                }

                return saveTopicAndRespond(courseId);
              }
            );
            return;
          }

          const insertColumns = [];
          const insertValues = [];
          const placeholders = [];

          const executeCourseInsert = (explicitCourseId) => {
            if (idCol && !idAutoIncrement) {
              insertColumns.push(idCol);
              insertValues.push(explicitCourseId);
              placeholders.push("?");
            }

            insertColumns.push(nameCol);
            insertValues.push(courseName);
            placeholders.push("?");

            if (creditsCol) {
              insertColumns.push(creditsCol);
              insertValues.push(3);
              placeholders.push("?");
            }
            if (deptCol) {
              insertColumns.push(deptCol);
              insertValues.push(teacherDeptId);
              placeholders.push("?");
            }
            if (teacherCol) {
              insertColumns.push(teacherCol);
              insertValues.push(teacherId);
              placeholders.push("?");
            }
            if (videoCol) {
              insertColumns.push(videoCol);
              insertValues.push(filePath);
              placeholders.push("?");
            }
            if (periodCol) {
              insertColumns.push(periodCol);
              insertValues.push(coursePeriod);
              placeholders.push("?");
            }

            db.query(
              `INSERT INTO courses (${insertColumns.join(", ")})
               VALUES (${placeholders.join(", ")})`,
              insertValues,
              (insertErr, insertResult) => {
                if (insertErr) {
                  console.error(insertErr);
                  return res.status(500).json({ error: "Video uploaded but course creation failed" });
                }

                const createdCourseId = idAutoIncrement ? insertResult.insertId : explicitCourseId;
                return saveTopicAndRespond(createdCourseId);
              }
            );
          };

          if (!idAutoIncrement && idCol) {
            db.query(
              `SELECT COALESCE(MAX(${idCol}), 0) + 1 AS next_course_id FROM courses`,
              (idErr, idRows) => {
                if (idErr) {
                  console.error(idErr);
                  return res.status(500).json({ error: "Failed to generate course id" });
                }

                const nextCourseId = Number(idRows && idRows[0] && idRows[0].next_course_id) || 1;
                return executeCourseInsert(nextCourseId);
              }
            );
            return;
          }

          return executeCourseInsert(null);
        }
      );
    });
  });
});

app.delete("/api/teacher/courses/:courseId", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Please log in first" });
  }

  if (!req.session.user || req.session.user.role !== "teacher") {
    return res.status(403).json({ error: "Only teachers can delete courses" });
  }

  const courseId = Number(req.params.courseId);
  if (!Number.isInteger(courseId) || courseId <= 0) {
    return res.status(400).json({ error: "Valid courseId is required" });
  }

  getCourseColumns((metaErr, courseMeta) => {
    if (metaErr) {
      console.error(metaErr);
      return res.status(500).json({ error: "Failed to load courses schema" });
    }

    const { idCol, nameCol, teacherCol, videoCol } = courseMeta;
    db.query(
      `SELECT ${idCol} AS course_id, ${nameCol} AS course_name,
              ${teacherCol ? `${teacherCol} AS teacher_id,` : "NULL AS teacher_id,"}
              ${videoCol ? `${videoCol} AS video_path` : "NULL AS video_path"}
       FROM courses
       WHERE ${idCol} = ?
       LIMIT 1`,
      [courseId],
      (findErr, rows) => {
        if (findErr) {
          console.error(findErr);
          return res.status(500).json({ error: "Failed to find course" });
        }

        if (!rows || rows.length === 0) {
          return res.status(404).json({ error: "Course not found" });
        }

        const course = rows[0];
        const isOwnedByTeacher = teacherCol && Number(course.teacher_id) === Number(req.session.user.id);
        const isLegacyUploadedCourse =
          !course.teacher_id && String(course.video_path || "").startsWith("/uploads/");

        if (!isOwnedByTeacher && !isLegacyUploadedCourse) {
          return res.status(403).json({ error: "You do not have permission to delete this course" });
        }

        getEnrollmentCourseColumn((enrollmentMetaErr, enrollmentCourseCol) => {
          if (enrollmentMetaErr) {
            console.error(enrollmentMetaErr);
            return res.status(500).json({ error: "Failed to load enrollment schema" });
          }

          db.query(
            `SELECT video_path FROM ${COURSE_TOPIC_TABLE} WHERE course_id = ?`,
            [courseId],
            (topicErr, topicRows) => {
              if (topicErr) {
                console.error(topicErr);
                return res.status(500).json({ error: "Failed to load course topics" });
              }

              const topicVideoPaths = (topicRows || []).map((row) => row.video_path);

              db.query(
                "DELETE FROM enrollment_requests WHERE course_id = ?",
                [courseId],
                (requestErr) => {
                  if (requestErr) {
                    console.error(requestErr);
                    return res.status(500).json({ error: "Failed to remove enrollment requests" });
                  }

                  db.query(
                    "DELETE FROM student_performance WHERE course_id = ?",
                    [courseId],
                    (performanceErr) => {
                      if (performanceErr) {
                        console.error(performanceErr);
                        return res.status(500).json({ error: "Failed to remove performance records" });
                      }

                      db.query(
                        `DELETE FROM enrollment WHERE ${enrollmentCourseCol} = ?`,
                        [courseId],
                        (enrollErr) => {
                          if (enrollErr) {
                            console.error(enrollErr);
                            return res.status(500).json({ error: "Failed to remove enrollments" });
                          }

                          db.query(
                            `DELETE FROM courses WHERE ${idCol} = ?`,
                            [courseId],
                            (deleteErr, result) => {
                              if (deleteErr) {
                                console.error(deleteErr);
                                return res.status(500).json({ error: "Failed to delete course" });
                              }

                              if (!result || result.affectedRows === 0) {
                                return res.status(404).json({ error: "Course not found or already deleted" });
                              }

                              topicVideoPaths.forEach((videoPath) => removeUploadedFile(videoPath));
                              removeUploadedFile(course.video_path);

                              return res.json({
                                message: "Course deleted successfully",
                                courseId,
                                courseName: course.course_name
                              });
                            }
                          );
                        }
                      );
                    }
                  );
                }
              );
            }
          );
        });
      }
    );
  });
});

// Simple AI generation endpoint. If OPENAI_API_KEY is set, this will call OpenAI's chat API.
app.post('/api/generate', async (req, res) => {
  const { videoUrl, courseName, maxQuestions = 5 } = req.body || {};
  const safeCourseName = String(courseName || 'this course').trim() || 'this course';

  // Basic validation
  if (!videoUrl) return res.status(400).json({ error: 'videoUrl required' });

  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) {
    // Return a safe mock response if no API key is configured.
    const summary = `${safeCourseName} introduces the core ideas covered in this uploaded lecture and gives learners a quick roadmap of the topic before they dive deeper into practice. It is designed to help students identify the main concepts, terminology, and workflows demonstrated in the video.\n\nThe lesson also encourages review through concise takeaways and short-answer questions so students can connect the explanation in the video with the most important points to remember after watching.`;
    const questions = [
      { question: `What is one main topic introduced in ${safeCourseName}?`, answer: `One main topic is a foundational concept presented in the ${safeCourseName} lecture.` },
      { question: 'Why is it useful to review a summary after watching the lecture?', answer: 'It helps reinforce the most important ideas and improves retention.' },
      { question: 'How do quiz questions help after a video lesson?', answer: 'They help learners check understanding and recall key points actively.' }
    ];
    return res.json({
      summary,
      summary_html: `<p>${summary.replace(/\n\n/g, '</p><p>')}</p>`,
      questions: questions.slice(0, maxQuestions)
    });
  }

  try {
    const prompt = `You are an assistant that reads a short description or metadata about a video and returns: 1) a 2-3 paragraph summary in plain text, 2) an HTML-safe summary in \
      a single string, and 3) a JSON array of ${maxQuestions} question objects with 'question' and concise 'answer' fields. Return JSON only.\n\nCourse name: ${safeCourseName}\nVideo reference: ${videoUrl}`;

    const payload = {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You output JSON only: {"summary":"...","summary_html":"...","questions":[{"question":"...","answer":"..."}] }' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 800
    };

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error('OpenAI error', resp.status, text);
      return res.status(502).json({ error: 'OpenAI API error', detail: text });
    }

    const body = await resp.json();
    const assistant = body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
    // Try to parse JSON out of assistant content
    let parsed = null;
    try {
      parsed = JSON.parse(assistant);
    } catch (e) {
      // If Assistant replied with plain text, wrap it
      parsed = { summary: assistant, summary_html: `<p>${assistant.replace(/\n/g,'</p><p>')}</p>`, questions: [] };
    }

    // Ensure questions array
    parsed.questions = Array.isArray(parsed.questions) ? parsed.questions.slice(0, maxQuestions) : [];

    return res.json(parsed);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
});

app.listen(3000, () => {
  console.log(`Server running at http://localhost:3000`);
});

