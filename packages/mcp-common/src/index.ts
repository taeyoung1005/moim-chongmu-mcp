import { serve } from "@hono/node-server"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { Hono } from "hono"
import { cors } from "hono/cors"
import type { ZodRawShape } from "zod/v4"
import * as z from "zod/v4"

export type TextContent = {
  readonly type: "text"
  readonly text: string
}

export type ToolResult = {
  readonly content: TextContent[]
  readonly isError?: boolean
}

export type ToolDefinition = {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly inputSchema: ZodRawShape
  readonly openWorldHint: boolean
  readonly handler: (args: Readonly<Record<string, unknown>>) => Promise<ToolResult> | ToolResult
}

export type TypedToolDefinition<Shape extends ZodRawShape> = Omit<
  ToolDefinition,
  "handler" | "inputSchema"
> & {
  readonly inputSchema: Shape
  readonly handler: (args: z.output<z.ZodObject<Shape>>) => Promise<ToolResult> | ToolResult
}

export type ServiceConfig = {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly description: string
  readonly tools: readonly ToolDefinition[]
}

export type ServiceApp = {
  readonly fetch: (request: Request) => Response | Promise<Response>
  readonly config: ServiceConfig
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] }
}

export function errorTextResult(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true }
}

export function defineTool<Shape extends ZodRawShape>(
  definition: TypedToolDefinition<Shape>,
): ToolDefinition {
  const parser = z.object(definition.inputSchema)
  return {
    ...definition,
    handler: (args) => {
      const parsed = parser.safeParse(args)
      if (!parsed.success) {
        return errorTextResult(formatValidationError(parsed.error))
      }
      return definition.handler(parsed.data)
    },
  }
}

export function createServiceApp(config: ServiceConfig): ServiceApp {
  const app = new Hono()

  app.use(
    "*",
    cors({
      origin: "*",
      allowHeaders: ["Content-Type", "Accept", "mcp-session-id", "mcp-protocol-version"],
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      exposeHeaders: ["mcp-session-id", "mcp-protocol-version"],
    }),
  )

  app.get("/health", (c) =>
    c.json({
      ok: true,
      serviceId: config.id,
      serviceName: config.name,
      version: config.version,
    }),
  )

  app.all("/mcp", async (c) => {
    if (c.req.method !== "POST") {
      return c.json(
        {
          jsonrpc: "2.0",
          error: { code: -32000, message: "Method not allowed." },
          id: null,
        },
        405,
      )
    }

    const server = createMcpServer(config)
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    })
    await server.connect(transport)
    try {
      return await transport.handleRequest(c.req.raw)
    } finally {
      await transport.close()
      await server.close()
    }
  })

  app.notFound((c) =>
    c.json(
      {
        ok: false,
        error: "not_found",
        serviceId: config.id,
      },
      404,
    ),
  )

  return { fetch: app.fetch, config }
}

export function startService(app: ServiceApp, port: number): void {
  serve({ fetch: app.fetch, port })
  console.log(`${app.config.id} listening on http://127.0.0.1:${port}`)
}

function createMcpServer(config: ServiceConfig): McpServer {
  const server = new McpServer({
    name: config.id,
    title: config.name,
    version: config.version,
  })

  for (const tool of config.tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          title: tool.title,
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: tool.openWorldHint,
        },
      },
      async (args) => tool.handler(args),
    )
  }

  return server
}

function formatValidationError(error: z.ZodError): string {
  const issues = error.issues
    .slice(0, 4)
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "arguments"
      return `- ${path}: ${issue.message}`
    })
    .join("\n")
  return `## 입력 오류\n\n요청값을 확인해 주세요.\n\n${issues}`
}
