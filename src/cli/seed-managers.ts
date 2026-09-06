import { runCli } from "../lib/cli.js";
import { seedDepartmentTable } from "./seed.js";

runCli(() => seedDepartmentTable("department_managers", "data/master/department_managers.csv"));
