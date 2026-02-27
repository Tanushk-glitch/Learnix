const express = require("express");
const session = require("express-session");
const path = require("path");
const authRoutes = require("./routes/auth");

const app = express();
const PUBLIC_DIR = path.join(__dirname, "..", "public");


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
  res.sendFile(path.join(PUBLIC_DIR, "login.html"));
});

// Force dashboard file URL through protected dashboard route.
app.get("/dashboard.html", (req, res) => {
  res.redirect("/dashboard");
});

app.get("/profile.html", (req, res) => {
  res.redirect("/profile");
});

app.use(express.static(PUBLIC_DIR));

// Simple AI generation endpoint. If OPENAI_API_KEY is set, this will call OpenAI's chat API.
app.post('/api/generate', async (req, res) => {
  const { videoUrl, maxQuestions = 5 } = req.body || {};

  // Basic validation
  if (!videoUrl) return res.status(400).json({ error: 'videoUrl required' });

  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) {
    // Return a safe mock response if no API key is configured.
    const summary = `This video (${videoUrl}) is an introductory lecture on Data Science. It covers core concepts such as data cleaning, exploratory data analysis, and an overview of common tools like Python, R, and visualization libraries. The lecture also briefly introduces machine learning approaches and the roles of statistics and domain knowledge in building models.`;
    const questions = [
      { question: 'What is the main goal of data cleaning?', answer: 'To remove or correct errors and inconsistencies so data is reliable for analysis.' },
      { question: 'Name one common language used in data science.', answer: 'Python' },
      { question: 'What does exploratory data analysis help with?', answer: 'Understanding data distributions and spotting anomalies before modeling.' }
    ];
    return res.json({ summary, summary_html: `<p>${summary}</p>`, questions: questions.slice(0, maxQuestions) });
  }

  try {
    const prompt = `You are an assistant that reads a short description or metadata about a video and returns: 1) a 2-3 paragraph summary in plain text, 2) an HTML-safe summary in \
      a single string, and 3) a JSON array of ${maxQuestions} question objects with 'question' and concise 'answer' fields. Return JSON only.\n\nVideo reference: ${videoUrl}`;

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
