const ContactMessage = require("../models/ContactMessage");

// أي زائر (من غير تسجيل دخول) يقدر يبعت رسالة من صفحة Contact Us
const sendMessage = async (req, res) => {
  try {
    const { name, email, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({
        success: false,
        message: "Name, email and message are all required",
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address",
      });
    }

    await ContactMessage.create({ name, email, message });

    return res.status(201).json({
      success: true,
      message: "Your message has been sent successfully",
    });
  } catch (error) {
    console.error("sendMessage error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to send message, please try again",
    });
  }
};

// للأدمن بس - عرض كل الرسائل اللي وصلت (الأحدث أولًا)
const getMessages = async (req, res) => {
  try {
    const messages = await ContactMessage.find().sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      data: messages,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  sendMessage,
  getMessages,
};
