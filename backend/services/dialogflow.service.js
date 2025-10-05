import { v4 as uuidv4 } from "uuid";
import { sessionClient } from "../config/dialogflow.config.js";

const projectId = process.env.GOOGLE_PROJECT_ID;
if (!projectId) {
  throw new Error("Set GOOGLE_PROJECT_ID env var");
}

/**
 * Detect intent from Dialogflow using just text input
 * @param {string} message - User input text
 * @param {string} sessionId - Unique session ID (per user/session)
 * @param {string} languageCode - Language (default "en")
 * @returns {Promise<object>} Dialogflow result
 */
export async function detectIntent(message, sessionId, languageCode = "en") {
  if (!message) throw new Error("Message is required");

  const sid = sessionId || uuidv4();
  const sessionPath = sessionClient.projectAgentSessionPath(projectId, sid);

  const request = {
    session: sessionPath,
    queryInput: {
      text: {
        text: message,
        languageCode,
      },
    },
  };

  const responses = await sessionClient.detectIntent(request);
  // console.log("Dialogflow response:", responses);
  const result = responses[0].queryResult;
  console.log("Dialogflow fulfillment messages:", result.fulfillmentMessages);

  return {
    sessionId: sid,
    // fulfillmentText: result.fulfillmentText,
    fulfillmentMessages: result.fulfillmentMessages,
    intent: result.intent ? result.intent.displayName : null,
    parameters: result.parameters ? result.parameters.fields : null,
    allRequiredParamsPresent: result.allRequiredParamsPresent,
  };
}
