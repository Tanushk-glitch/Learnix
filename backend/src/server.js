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
      videoCol
    };
    return callback(null, courseColumnCache);
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

const buildUploadedCoursePagePath = (courseName, videoPath) => {
  const params = new URLSearchParams({
    course: String(courseName || "").trim() || "Uploaded Course",
    video: String(videoPath || "").trim()
  });
  return `/pages/uploaded-course.html?${params.toString()}`;
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
    const coursePeriod =
      req.body && req.body.coursePeriod ? String(req.body.coursePeriod).trim() : "";
    if (!courseName) {
      return res.status(400).json({ error: "courseName is required" });
    }

    if (!coursePeriod) {
      return res.status(400).json({ error: "coursePeriod is required" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "courseVideo file is required" });
    }

    const filePath = `/uploads/${req.file.filename}`;
    const coursePagePath = buildUploadedCoursePagePath(courseName, filePath);
    const teacherId = req.session.user && req.session.user.id ? Number(req.session.user.id) : null;
    const teacherDeptId =
      req.session.user && req.session.user.dept_id ? Number(req.session.user.dept_id) : null;

    getCourseColumns((metaErr, courseMeta) => {
      if (metaErr) {
        console.error(metaErr);
        return res.status(500).json({ error: "Failed to load courses schema" });
      }

      const { idCol, nameCol, creditsCol, periodCol, deptCol, teacherCol, videoCol } = courseMeta;

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
              return res.json({
                message: "Video uploaded successfully",
                filePath,
                coursePagePath,
                courseName,
                coursePeriod,
                courseId
              });
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

                return res.json({
                  message: "Video uploaded successfully",
                  filePath,
                  courseName,
                  coursePeriod,
                  courseId
                });
              }
            );
            return;
          }

          const insertColumns = [nameCol];
          const insertValues = [courseName];
          const placeholders = ["?"];

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

              return res.json({
                message: "Video uploaded successfully",
                filePath,
                coursePagePath,
                courseName,
                coursePeriod,
                courseId: insertResult.insertId
              });
            }
          );
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

                          const rawVideoPath = String(course.video_path || "").trim();
                          if (rawVideoPath.startsWith("/uploads/")) {
                            const absoluteVideoPath = path.join(PUBLIC_DIR, rawVideoPath.replace(/^\//, ""));
                            fs.unlink(absoluteVideoPath, (unlinkErr) => {
                              if (unlinkErr && unlinkErr.code !== "ENOENT") {
                                console.error("Failed to remove uploaded video:", unlinkErr.message);
                              }
                            });
                          }

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

