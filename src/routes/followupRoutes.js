const express = require('express');

const {
  createFollowup,
  getFollowups,
  getFollowupById,
  updateFollowup,
  deleteFollowup,
} = require('../controllers/followupController');

const router = express.Router();

router.route('/')
  .post(createFollowup)
  .get(getFollowups);

router.route('/:id')
  .get(getFollowupById)
  .put(updateFollowup)
  .delete(deleteFollowup);

module.exports = router;