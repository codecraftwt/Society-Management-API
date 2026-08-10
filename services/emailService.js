const transporter = require("../utils/mailer");

const sendEmail = async ({ to, subject, html }) => {
  try {
    const info = await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to,
      subject,
      html,
    });

  } catch (error) {
    console.error("Email error:", error);
  }
};

module.exports = { sendEmail };
