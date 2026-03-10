# Learnix Project Structure

## Folder Layout

```text
.
|-- public/
|   |-- assets/
|   |   |-- css/
|   |   |   `-- main.css
|   |   |-- js/
|   |   |   |-- demo.js
|   |   |   |-- firebase-config.js
|   |   |   |-- firebase-signup.js
|   |   |   `-- main.js
|   |   `-- media/
|   |       `-- videos/
|   |           |-- DS.mp4
|   |           |-- Python.mp4
|   |           |-- UIUX.mp4
|   |           `-- Web_dev.mp4
|   |-- pages/
|   |   |-- index.html
|   |   |-- home.html
|   |   |-- login.html
|   |   |-- signup.html
|   |   |-- dashboard.html
|   |   |-- profile.html
|   |   |-- demo.html
|   |   |-- courses.html
|   |   |-- webdev-video.html
|   |   |-- python-video.html
|   |   |-- ds-video.html
|   |   |-- uiux-video.html
|   |   `-- temp-ds.html
|   `-- uploads/
|-- src/
|   |-- config/
|   |   |-- database.js
|   |   `-- firebaseAdmin.js
|   |-- routes/
|   |   `-- auth.js
|   `-- server.js
|-- sql/
|   `-- schema.sql
|-- scripts/
|   `-- db-check.js
|-- .env
|-- package.json
`-- package-lock.json
```

## URL Conventions

- Pages now live under `/pages/*`
- Shared CSS/JS now live under `/assets/*`
- Static course videos now live under `/assets/media/videos/*`
- Teacher-uploaded videos continue to use `/uploads/*`

## Backward Compatibility

Legacy URLs like `/login.html`, `/home.html`, `/courses.html`, and video page URLs are redirected to `/pages/...` from `src/server.js`.

## Run

```bash
npm install
npm start
```