// dialogflow.config.js
import dialogflow from "@google-cloud/dialogflow";
import dotenv from "dotenv";
dotenv.config();

const projectId = process.env.GOOGLE_PROJECT_ID;
if (!projectId) {
  throw new Error("Set GOOGLE_PROJECT_ID env var");
}

// Singleton client instance (reuse across app)
const sessionClient = new dialogflow.SessionsClient();

export { sessionClient, projectId };
