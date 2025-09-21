// server.js
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const dialogflow = require('@google-cloud/dialogflow'); // npm i @google-cloud/dialogflow
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Cấu hình: set environment variables trước khi chạy:
// GOOGLE_PROJECT_ID, (và) GOOGLE_APPLICATION_CREDENTIALS hoặc deploy dưới môi trường có permission
const projectId = process.env.GOOGLE_PROJECT_ID;
if (!projectId) {
  console.error('Set GOOGLE_PROJECT_ID env var');
  process.exit(1);
}

// client sẽ tự dùng GOOGLE_APPLICATION_CREDENTIALS nếu set, hoặc bạn có thể truyền keyFilename
const sessionClient = new dialogflow.SessionsClient(); // dùng ADC (Application Default Credentials)

app.post('/api/message', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    if (!message) return res.status(400).json({error: 'message required'});

    // sessionId: frontend nên gửi 1 id cố định cho mỗi user (localStorage)
    const sid = sessionId || uuidv4();
    const sessionPath = sessionClient.projectAgentSessionPath(projectId, sid);

    const request = {
      session: sessionPath,
      queryInput: {
        text: {
          text: message,
          languageCode: 'vi' // hoặc 'vi-VN'
        }
      }
    };

    const responses = await sessionClient.detectIntent(request);
    const result = responses[0].queryResult;

    // Trả lại cho frontend: text chính, mảng messages thô (để render card/quick replies), intent, parameters
    res.json({
      sessionId: sid,
      fulfillmentText: result.fulfillmentText,
      fulfillmentMessages: result.fulfillmentMessages,
      intent: result.intent ? result.intent.displayName : null,
      parameters: result.parameters ? result.parameters.fields : null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
