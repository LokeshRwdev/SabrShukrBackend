const express = require("express");
const router = express.Router();

const storyController = require("../controllers/storyController");
const authMiddleware = require("../middlewares/auth");

router.get("/public", storyController.getPublicStories);

router.post("/", authMiddleware, storyController.submitStory);

module.exports = router;
