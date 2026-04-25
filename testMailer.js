import transporter from "./config/mailer.js";

async function sendTest() {
  try {
    await transporter.sendMail({
      from: `"Codezy Test" <${process.env.EMAIL_USER}>`,
      to: "zille626l@gmail.com", 
      subject: "Test Email from Codezy",
      text: "This is a test email. Nodemailer works!",
    });
    console.log("Test email sent successfully");
  } catch (err) {
    console.error("Error sending test email:", err);
  }
}

sendTest();
