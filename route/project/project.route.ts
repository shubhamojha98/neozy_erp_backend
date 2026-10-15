import { Router } from "express";
import {
  createProject,
  getAllProjects,
  updateProject,
} from "../../controller/project/project.controller";

const router = Router();

router.post("/create-project", createProject);
router.get("/get-projects", getAllProjects);
router.put("/update-project/:id", updateProject);


export default router;