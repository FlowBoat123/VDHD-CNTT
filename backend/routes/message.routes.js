// routes/message.routes.js
import express from "express";
import { handleDialogflow } from "../services/dialogflow.service.js";
import {
  getChatMessages,
  getUserChatsId,
  getUserPreferences,
  saveChatMessage,
} from "../services/firebase.service.js";
import { authenticateOptional } from "../middleware/authenticate.js";
const router = express.Router();

router.post("/message", authenticateOptional, async (req, res) => {
  try {
    const { content, sessionId, chatId } = req.body;
    if (!content) return res.status(400).json({ error: "content required" });

    const uid = req.user?.uid || null; // trusted uid (null if guest)

    // Call Dialogflow
    const dfResponse = await handleDialogflow(content, sessionId, "vi");

    // Respond to client
    res.json(dfResponse);

    if (!uid) return; // do not save messages for guest users

    // save user message
    await saveChatMessage(uid, chatId, { sender: "user", content: content });

    // save bot response (text + optional movies) if any
    const fulfillmentMessages = dfResponse.fulfillmentMessages || [];
    let textParts = [];
    let moviesPayload = [];
    for (const msg of fulfillmentMessages) {
      const textArr = msg?.text?.text;
      if (Array.isArray(textArr) && textArr.length > 0) {
        textParts.push(textArr.join("\n"));
      }
      if (
        Array.isArray(msg?.movieSuggestions) &&
        msg.movieSuggestions.length > 0
      ) {
        moviesPayload = msg.movieSuggestions;
      }
    }

    const assistantText =
      textParts.length > 0
        ? textParts.join("\n\n")
        : dfResponse.fulfillmentText || "";
    if (assistantText || moviesPayload.length > 0) {
      await saveChatMessage(uid, chatId, {
        sender: "assistant",
        content: assistantText,
        movies: moviesPayload,
      });
    }

    // attach preferences
    const preferences = await getUserPreferences(uid);
    dfResponse.userPreferences = preferences;
  } catch (err) {
    console.error("Error in /message:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/chats", authenticateOptional, async (req, res) => {
  const { uid } = req.user || {};
  if (!uid) return res.status(401).json({ error: "Unauthorized" });
  try {
    getUserChatsId(uid).then((chatIds) => {
      res.json({ chatIds });
    });
  } catch (err) {
    console.error("Error in /chats:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /chats/:chatId → return specific chat with metadata + messages
router.get("/chats/:chatId", authenticateOptional, async (req, res) => {
  console.log("Fetching chat ID:", req.params.chatId, "for user:", req.user);
  try {
    getChatMessages(req.user?.uid, req.params.chatId).then((messages) => {
      res.json({ data: messages });
      console.log("Fetched chat: ", messages);
    });
  } catch (err) {
    console.error("Error fetching chat:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get(
  "/chats/:chatId/messages",
  authenticateOptional,
  async (req, res) => {
    try {
      const { chatId } = req.params;
      getChatMessages(req.user?.uid, chatId).then((messages) => {
        res.json({ messages: messages });
      });
    } catch (err) {
      console.error("Error fetching chat messages:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
