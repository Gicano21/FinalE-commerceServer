require('dotenv').config();
const express = require("express");
const nodemailer = require("nodemailer");
const axios = require("axios");

const app = express();
app.use(express.json());
const API_URL = process.env.API_URL || "http://localhost:3000";

// --- Email Configuration Setup ---
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "yawningeverytime@gmail.com",
    pass: "fmohmrhvgicanitb"
  },
  tls: { rejectUnauthorized: false }
});

// --- Action Email Functions ---
async function sendCode(data) {
  try {
    await transporter.sendMail({
      from: '"Tech Store" <yawningeverytime@gmail.com>',
      to: data.Email,
      subject: "Verify your email",
      html: `
<body style="margin: 0; padding: 0; background-color: #f4f4f7; font-family: 'Segoe UI', Helvetica, Arial, sans-serif;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table border="0" cellpadding="0" cellspacing="0" width="500" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.08); border: 1px solid #e1e1e7;">
          <tr>
            <td align="center" style="background-color: #1a1f36; padding: 30px;">
              <div style="color: #ffffff; font-size: 14px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; opacity: 0.9;">
                Security Verification
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px 40px 30px 40px; text-align: center;">
              <h2 style="color: #333333; margin: 0 0 10px 0; font-size: 20px;">Confirm Your Identity</h2>
              <p style="color: #666666; font-size: 15px; margin-bottom: 30px; line-height: 1.5;">
                Use the following code to complete your request. This code is valid for a limited time.
              </p>
              <div style="background-color: #f8f9ff; border: 1px dashed #4a55ea; padding: 20px; border-radius: 6px; display: inline-block;">
                <span style="font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: bold; color: #4a55ea; letter-spacing: 5px;">
                  ${data.code}
                </span>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 40px 40px;">
              <div style="background-color: #fff9f0; border-left: 4px solid #ffb020; padding: 15px; font-size: 13px; color: #7a5c1a; line-height: 1.4;">
                <strong>Security Note:</strong> This was requested for security purposes. If you did not request this verification code, please ignore this email or contact support if you suspect unauthorized activity.
              </div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding: 20px; background-color: #f9f9fb; color: #999999; font-size: 11px;">
              <p style="margin: 0;">&copy; 2026 YourCompany Security Team</p>
              <p style="margin: 5px 0 0;">This is an automated message, please do not reply.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>`
    });
    console.log(`Code sent to ${data.Email}`);
  } catch (error) {
    console.error("Nodemailer Error (Code):", error);
  }
}

async function sendFeedBack(data) {
  try {
    await transporter.sendMail({
      from: `"Feedback" <yawningeverytime@gmail.com>`,
      to: "yawningeverytime@gmail.com",
      subject: data.Subject,
      html: `
<body style="margin: 0; padding: 0; background-color: #f4f4f7; font-family: 'Segoe UI', Helvetica, Arial, sans-serif;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table border="0" cellpadding="0" cellspacing="0" width="600" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <tr>
            <td align="center" style="background-color: #4a55ea; padding: 20px;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px; letter-spacing: 1px; text-transform: uppercase;">
                User Feedback
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px 30px;">
              <p style="color: #888888; font-size: 14px; margin-bottom: 5px;">From:</p>
              <h3 style="color: #333333; margin: 0 0 20px 0; font-size: 18px;">
                ${data.Name}
              </h3>
              <hr style="border: 0; border-top: 1px solid #eeeeee; margin: 20px 0;">
              <div style="color: #555555; line-height: 1.6; font-size: 16px; background-color: #fafafa; padding: 20px; border-radius: 4px; border-left: 4px solid #4a55ea;">
                ${data.Message}
              </div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding: 20px; background-color: #f9f9fb; color: #999999; font-size: 12px;">
              <p style="margin: 0;">Sent via Corporate Feedback Portal &copy; 2026</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>`
    });
    console.log(`Feedback sent for ${data.Name}`);
  } catch (error) {
    console.error("Nodemailer Error (Feedback):", error);
  }
}

// --- Polling Logic ---
async function sync() {
  try {
    const response = await axios.get(`${API_URL}/worker/poll`);
    const { emails } = response.data;
    
    if (emails && emails.length > 0) {
      for (const email of emails) {
        if (email.type === "code") {
          await sendCode(email);
        } else if (email.type === "feedback") {
          await sendFeedBack(email);
        }
      }
    }
  } catch (e) {
    if (e.code !== 'ECONNREFUSED') {
       console.log("Email Worker: Waiting for CodeMaker (Cloud Server)... retrying.");
    }
  }
}

setInterval(sync, 1000);

const EMAIL_WORKER_PORT = process.env.EMAIL_WORKER_PORT || 3002;
app.listen(EMAIL_WORKER_PORT, () => {
  console.log(`Worker (Email Engine) running on port ${EMAIL_WORKER_PORT}`);
  sync();
});