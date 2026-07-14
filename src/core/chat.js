import { Router } from "express";
import conversationsRouter from "./chat/conversations.js";
import messagesRouter from "./chat/messages.js";
import ideasRouter from "./chat/ideas.js";

const router = Router();

router.use(conversationsRouter);
router.use(messagesRouter);
router.use(ideasRouter);

export default router;
