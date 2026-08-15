import { Router, type IRouter } from "express";
import healthRouter from "./health";
import cbtRouter from "./cbt";

const router: IRouter = Router();

router.use(healthRouter);
router.use(cbtRouter);

export default router;
