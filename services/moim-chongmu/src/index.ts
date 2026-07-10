import { startService } from "@playmcp/mcp-common"
import { createMoimChongmuService } from "./service.js"

const port = Number.parseInt(process.env["PORT"] ?? process.argv.at(-1) ?? "8788", 10)

startService(createMoimChongmuService(), Number.isFinite(port) ? port : 8788)
