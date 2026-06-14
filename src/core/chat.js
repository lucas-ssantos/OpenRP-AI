import { Router } from "express";
import conversationsRouter from "./chat/conversations.js";
import messagesRouter from "./chat/messages.js";

const router = Router();

router.use(conversationsRouter);
router.use(messagesRouter);

export default router;
