// brevo.js
const SibApiV3Sdk = require('sib-api-v3-sdk');

// Configure API client
const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY;

// Create instance for transactional emails
const tranEmailApi = new SibApiV3Sdk.TransactionalEmailsApi();

async function sendEmail(toEmail, toName, subject, htmlContent) {
  try {
    if (!process.env.BREVO_API_KEY) {
      throw new Error('BREVO_API_KEY not configured in environment variables');
    }

    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();

    // Update sender info for your brand
    sendSmtpEmail.sender = { 
      name: "SabrShukr", 
      email: "support@sabrshukr.store" // Use your verified domain
    };
    sendSmtpEmail.to = [{ email: toEmail, name: toName }];
    sendSmtpEmail.subject = subject;
    sendSmtpEmail.htmlContent = htmlContent;

    const data = await tranEmailApi.sendTransacEmail(sendSmtpEmail);
    console.log("✅ Email sent successfully via Brevo:", data.messageId);
    return data;
  } catch (error) {
    console.error("❌ Error sending email via Brevo:", error);
    throw error;
  }
}

module.exports = { sendEmail };
