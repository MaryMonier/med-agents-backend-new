const User = require("../models/User")
const { calculateNewSubscriptionEnd } = require("../config/plans");

const getMySubscription = async (req, res) => {
  const user = await User.findById(req.user.id).select("subscription");

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

if (!user.subscription) {
  return res.status(404).json({
    success: false,
    message: "Subscription not found",
  });
}

  const { subscription } = user;
if (
  subscription.status === "trial" &&
  new Date() > subscription.trialEnd
) {
  subscription.status = "expired";
  await user.save();
}
  let daysLeft = 0;

  if (subscription.status === "trial") {
    daysLeft = Math.max(
      0,
      Math.ceil(
        (new Date(subscription.trialEnd) - new Date()) /
          (1000 * 60 * 60 * 24)
      )
    );
  }

  if (subscription.status === "active" && subscription.subscriptionEnd) {
    daysLeft = Math.max(
      0,
      Math.ceil(
        (new Date(subscription.subscriptionEnd) - new Date()) /
          (1000 * 60 * 60 * 24)
      )
    );
  }

  res.json({
    success: true,
    data: {
status: subscription.status,
plan: subscription.plan,
trialStart: subscription.trialStart,
trialEnd: subscription.trialEnd,
subscriptionStart: subscription.subscriptionStart,
subscriptionEnd: subscription.subscriptionEnd,
daysLeft
    },
  });
};
const renewSubscription = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { plan, months } = req.body;

    const user = await User.findById(doctorId);

    if (!user || user.role !== "doctor") {
      return res.status(404).json({
        success: false,
        message: "Doctor not found",
      });
    }

    const startDate = new Date();
    const endDate = calculateNewSubscriptionEnd(user.subscription, months);

    user.subscription.status = "active";
    user.subscription.plan = plan || user.subscription.plan;
    user.subscription.subscriptionStart = startDate;
    user.subscription.subscriptionEnd = endDate;

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Subscription renewed successfully",
      data: user.subscription,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
const getDoctorsSubscriptions = async (req, res) => {
  try {
    const { search = "", status = "", plan = "", page = 1, limit = 10 } = req.query;

    const currentPage = Number(page);
    const pageSize = Number(limit);

    const filter = {
      role: "doctor",
    };

    if (search) {
      filter.$or = [
        {
          name: {
            $regex: search,
            $options: "i",
          },
        },
        {
          email: {
            $regex: search,
            $options: "i",
          },
        },
      ];
    }

    if (status) {
      filter["subscription.status"] = status;
    }

    if (plan) {
      filter["subscription.plan"] = plan;
    }

    const totalDoctors = await User.countDocuments(filter);

    const doctors = await User.find(
      filter,
      "name email specialty subscription createdAt"
    )
      .sort({ createdAt: -1 })
      .skip((currentPage - 1) * pageSize)
      .limit(pageSize);

    const doctorsWithDaysLeft = doctors.map((doctor) => {
      const subscription = doctor.subscription;

      let daysLeft = 0;

      if (subscription?.status === "trial" && subscription.trialEnd) {
        daysLeft = Math.max(
          0,
          Math.ceil(
            (new Date(subscription.trialEnd) - new Date()) /
              (1000 * 60 * 60 * 24)
          )
        );
      }

      if (
        subscription?.status === "active" &&
        subscription.subscriptionEnd
      ) {
        daysLeft = Math.max(
          0,
          Math.ceil(
            (new Date(subscription.subscriptionEnd) - new Date()) /
              (1000 * 60 * 60 * 24)
          )
        );
      }

      return {
        ...doctor.toObject(),
        daysLeft,
      };
    });

    return res.status(200).json({
      success: true,
      data: doctorsWithDaysLeft,
      pagination: {
        currentPage,
        pageSize,
        totalDoctors,
        totalPages: Math.ceil(totalDoctors / pageSize),
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};





module.exports = {
  getMySubscription,
  renewSubscription
  ,getDoctorsSubscriptions
};