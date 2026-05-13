import { ensureBinary } from "cloakbrowser";

const path = await ensureBinary();
console.log("cloakbrowser binary:", path);
