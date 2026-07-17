// require("dotenv").config();
// const app = require("./src/app");
// const connectDB = require("./src/config/db");
// const { PORT } = require("./src/config/env");
// const {
//   startFollowupCron,
//   checkExpiredFollowups,
// } = require("./src/jobs/followupCron");

// const startServer = async () => {
//   await connectDB();

//   // شغل الـ check فور ما السيرفر يبدأ عشان نعوض أي followups فاتت
//   await checkExpiredFollowups();

//   app.listen(PORT, () => {
//     console.log(`Server running on port ${PORT}`);
//   });

//   startFollowupCron();
// };

// process.on("SIGINT", async () => {
//   console.log("Server shutting down...");
//   process.exit(0);
// });

// startServer();


require("dotenv").config();
const app = require("./src/app");
const connectDB = require("./src/config/db");
const { PORT } = require("./src/config/env");
const {
  startFollowupCron,
  checkExpiredFollowups,
} = require("./src/jobs/followupCron");

// اتصال سريع ومباشر بالـ DB أول ما الملف يقرا
connectDB().catch(err => console.error("Initial DB connection failed:", err));

// تشغيل الـ Cron Jobs والـ check محلياً فقط (Local) وليس على Vercel (Production)
if (process.env.NODE_ENV !== "production") {
  const startLocalServices = async () => {
    try {
      await checkExpiredFollowups();
      startFollowupCron();
    } catch (err) {
      console.error("Failed to start local services:", err);
    }
  };

  app.listen(PORT, () => {
    console.log(`Server running locally on port ${PORT}`);
  });

  startLocalServices();
}

module.exports = app;