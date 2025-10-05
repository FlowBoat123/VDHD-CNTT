// firebase.config.js
import admin from "firebase-admin";

admin.initializeApp({
  credential: admin.credential.cert(process.env.SERVICE_ACCOUNT_KEY),
});

var db = admin.firestore();

export { admin, db };
