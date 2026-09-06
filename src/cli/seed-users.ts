import { runCli } from "../lib/cli.js";
import { seedDepartmentTable } from "./seed.js";

runCli(() => seedDepartmentTable("user_departments", "data/master/user_departments.csv"));
