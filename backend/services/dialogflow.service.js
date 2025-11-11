import { v4 as uuidv4 } from "uuid";
import { sessionClient } from "../config/dialogflow.config.js";
import { DialogflowAdapter } from "./utils/dialogflow.adapter.js";
import { intentHandlers } from "./utils/stratergies/intent.stratergies.js";

const projectId = process.env.GOOGLE_PROJECT_ID;
if (!projectId) {
  throw new Error("Set GOOGLE_PROJECT_ID env var");
}

// Intents that we just passthrough the text response from Dialogflow
const PASSTHROUGH_INTENTS = ["Default Fallback Intent"];

/**
 *
 * @param {*} message
 * @param {*} sessionId
 * @param {*} languageCode
 * @param {*} uid - Firebase user ID (optional)
 * @returns Dialogflow-like response enhanced by custom handlers
 */
export async function handleDialogflow(
  message,
  sessionId,
  languageCode = "en",
  uid = null
) {
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

  // --- Normalize intent and parameters ---
  const unified = DialogflowAdapter.toUnifiedRequest(responses[0], sid);
  
  // ✅ Attach uid to request so handlers can use it
  unified.uid = uid;

  unified.text = unified.text || message;

  const { intent, allRequiredParamsPresent, parameters } = unified;

  console.log("🔍 Debug Info:");
  console.log("Intent:", intent);
  console.log("Message:", message);
  console.log("All params present:", allRequiredParamsPresent);
  console.log("Parameters:", parameters);

  // Pass-through intents (welcome, fallback, etc.)
  if (PASSTHROUGH_INTENTS.includes(intent)) {
    console.log("⏭️ Passthrough intent");
    return unified;
  }

  // Not all parameters present → return Dialogflow's own response
  if (!allRequiredParamsPresent) {
    console.log("❌ Not all required params present");
    return unified;
  }

  const handler = intentHandlers[intent];
  if (!handler) {
    console.log("⚠️ No handler found for intent:", intent);
    return unified;
  }

  console.log("✅ Calling handler for:", intent);
  // Call the handler
  const handled = await handler(unified);

  return { ...unified, ...handled };
}
