const db = require("../src/config/database");

db.query("SELECT student_id, name, gender, dept_id FROM students", (queryErr, results) => {
  if (queryErr) {
    console.error("Query failed:", queryErr.message);
    db.end();
    process.exit(1);
  }

  console.log("Student Records:");
  results.forEach((student) => {
    console.log(
      `ID: ${student.student_id}, Name: ${student.name}, Gender: ${student.gender}, Dept: ${student.dept_id}`
    );
  });

  db.end();
});
