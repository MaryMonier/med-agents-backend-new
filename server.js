require("dotenv").config();
const app = require("./src/app");
const connectDB = require("./src/config/db");
const { PORT } = require("./src/config/env");
const {
  startFollowupCron,
  checkExpiredFollowups,
} = require("./src/jobs/followupCron");

const startServer = async () => {
  await connectDB();

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  checkExpiredFollowups().catch((err) => {
    console.error("checkExpiredFollowups failed:", err.message);
  });


  startFollowupCron();
};

process.on("SIGINT", async () => {
  console.log("Server shutting down...");
  process.exit(0);
});

startServer();

module.exports = app;