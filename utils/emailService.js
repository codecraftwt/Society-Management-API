const transporter = require("./mailer");

exports.sendCredentialsEmail = async (toEmail, name, password) => {
  if (!transporter) return false;

  try {
    const mailOptions = {
      from: process.env.MAIL_FROM || `"Society Management" <${process.env.MAIL_USER}>`,
      to: toEmail,
      subject: "Welcome to Society Management - Login Credentials",
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6;">
          <h2>Welcome, ${name}!</h2>
          <p>You have been added as a family member with <strong>App Access</strong>.</p>
          <p>You can now log in to the app using the following credentials:</p>
          <div style="background: #f4f4f4; padding: 15px; border-radius: 5px;">
            <p><strong>Email:</strong> ${toEmail}</p>
            <p><strong>Temporary Password:</strong> ${password}</p>
          </div>
          <p>For security reasons, please change your password after your first login.</p>
          <br/>
          <p>Regards,<br/>Society Management Team</p>
        </div>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("✅ Credentials Email Sent:", info.messageId);
    return true;
  } catch (error) {
    console.error("❌ Email Delivery Failed:", error);
    return false;
  }
};
