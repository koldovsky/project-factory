// @trace FR-1
import { app } from "../app/main.js";
if (app() !== "hello") throw new Error("FR-1 regression");
