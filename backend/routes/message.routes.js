// routes/message.routes.js
import express from "express";
import { handleDialogflow } from "../services/dialogflow.service.js";
import {
  getChatMessages,
  getUserChats,
  getUserPreferences,
  saveChatMessage,
  updateChatTitle,
  deleteChat,
} from "../services/firebase.service.js";
import { authenticateOptional } from "../middleware/authenticate.js";
const router = express.Router();

router.post("/message", authenticateOptional, async (req, res) => {
  try {
    const { content, sessionId, chatId } = req.body;
    if (!content) return res.status(400).json({ error: "content required" });

    const uid = req.user?.uid || null; // trusted uid (null if guest)

    // Call Dialogflow with uid
    const dfResponse = await handleDialogflow(content, sessionId, "vi", uid);

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
    const chatsInfo = await getUserChats(uid);
    res.json(chatsInfo);
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

// POST /chats/:chatId/title: Cập nhật tiêu đề của một cuộc trò chuyện
router.post("/chats/:chatId/title", authenticateOptional, async (req, res) => {
  try {
    // 1. Xác thực người dùng từ middleware
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    // 2. Lấy chatId từ URL và title từ body của request
    const { chatId } = req.params;
    const { title } = req.body;

    // 3. Kiểm tra xem title có được cung cấp không
    if (!title) {
      return res.status(400).json({ error: "Title is required" });
    }

    // 4. Gọi hàm dịch vụ để cập nhật vào Firestore
    await updateChatTitle(uid, chatId, title);

    // 5. Trả về phản hồi thành công cho frontend
    res.json({ id: chatId, title: title });
  } catch (err) {
    console.error("Error updating chat title:", err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /chats/:chatId → delete a specific chat and its messages
router.delete("/chats/:chatId", authenticateOptional, async (req, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const { chatId } = req.params;
    if (!chatId) return res.status(400).json({ error: "Chat ID is required" });

    await deleteChat(uid, chatId);

    res.status(200).json({ id: chatId, message: "Chat deleted successfully" });
  } catch (err) {
    console.error("Error deleting chat:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
