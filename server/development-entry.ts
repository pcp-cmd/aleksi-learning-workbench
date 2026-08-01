import { loadEnvFileIfPresent } from "./runtime-config";
import { runServer } from "./start-server";

loadEnvFileIfPresent();
runServer();
