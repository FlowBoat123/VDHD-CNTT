// services/chat.service.js
import { detectIntent } from "./dialogflow.service.js";
import { getUserPreferences, saveChatMessage } from "./firebase.service.js";
import crypto from "crypto";

/**
 * Handle a chat message from user → detect intent → save user & bot messages
 * @param {object} payload
 * @param {string} payload.message - User's message text
 * @param {string|null} payload.sessionId - Session ID for Dialogflow
 * @param {string|null} payload.chatId - Chat ID (null if new chat)
 * @param {string|null} payload.uid - Firebase user ID
 * @param {string} [payload.languageCode="vi"] - Language code
 */
export async function handleChatMessage({
  message,
  sessionId,
  chatId,
  uid,
  languageCode = "vi",
}) {
  if (!message) throw new Error("message required");

  // If no chatId → this is first message → create one
  let activeChatId = chatId;
  if (!activeChatId) {
    activeChatId = crypto.randomUUID();
  }

  // Send message to Dialogflow
  const dfResponse = await detectIntent(
    message,
    sessionId || activeChatId,
    languageCode
  );

  // Save user message (if authenticated)
  if (uid) {
    await saveChatMessage(uid, activeChatId, {
      sender: "user",
      content: message,
    });

    if (dfResponse.fulfillmentText) {
      await saveChatMessage(uid, activeChatId, {
        sender: "assistant",
        text: dfResponse.fulfillmentText,
      });
    }

    // Attach user preferences if available
    const preferences = await getUserPreferences(uid);
    dfResponse.userPreferences = preferences;
  }

  return { chatId: activeChatId, ...dfResponse };
}
