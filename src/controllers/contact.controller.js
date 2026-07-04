const ContactMessage = require("../models/ContactMessage");

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

const getMessages = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";

    const filter = search
      ? {
          $or: [
            { name: { $regex: search, $options: "i" } },
            { email: { $regex: search, $options: "i" } },
            { message: { $regex: search, $options: "i" } },
          ],
        }
      : {};

    const total = await ContactMessage.countDocuments(filter);

    const messages = await ContactMessage.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return res.status(200).json({
      success: true,
      data: messages,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;

    const message = await ContactMessage.findByIdAndUpdate(
      id,
      { status: "read" },
      { new: true }
    );

    if (!message) {
      return res.status(404).json({ success: false, message: "Message not found" });
    }

    return res.status(200).json({ success: true, data: message });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  sendMessage,
  getMessages,
  markAsRead,
};