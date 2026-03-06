const admin = require("firebase-admin");

let appInstance = null;

const getFirebaseAdminApp = () => {
  if (appInstance) {
    return appInstance;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    : null;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Firebase Admin is not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY."
    );
  }

  appInstance = admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey
    })
  });

  return appInstance;
};

const verifyFirebaseIdToken = async (idToken) => {
  if (!idToken) {
    throw new Error("Missing Firebase ID token");
  }

  const app = getFirebaseAdminApp();
  return app.auth().verifyIdToken(idToken, true);
};

module.exports = {
  verifyFirebaseIdToken
};
