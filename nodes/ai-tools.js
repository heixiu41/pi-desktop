/**
 * AI 工具集：让 pi 能查看节点库、创建自定义节点、运行蓝图、查询结果
 */
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";

const truncate = (s, n = 4000) =>
  s.length > n ? s.slice(0, n) + `\n…（已截断，共 ${s.length} 字符）` : s;

export function createNodeTools({ registry, blueprintManager }) {
  return [
    defineTool({
      name: "view_node_library",
      label: "查看节点库",
      description:
        "查看当前可用的全部节点类型：内置类型（input/output/agent）与自定义节点。创建或运行节点前可先查看。",
      parameters: Type.Object({}),
      execute: async () => {
        const nodes = registry.list();
        const text = [
          "【内置类型】input（输入）、output（输出）、agent（智能体）",
          `【自定义节点】${nodes.length ? "" : "无"}`,
          ...nodes.map(
            (n) =>
              `- ${n.name}（${n.label}）${n.hasImplementation ? "[函数]" : "[智能体]"}：${n.description} | 输入: ${n.inputs.map((i) => i.name + ":" + i.type).join(", ")} | 输出: ${n.outputs.map((o) => o.name + ":" + o.type).join(", ")}`
          ),
        ].join("\n");
        return { content: [{ type: "text", text }], details: {} };
      },
    }),

    defineTool({
      name: "create_node",
      label: "创建自定义节点",
      description:
        "按标准范式创建自定义节点（声明式 JSON + 可选 JS 实现）。创建前必须先阅读文档 ~/.pi/nodes-docs/自定义节点创建规范.create.P0.md。节点写入 ~/.pi/nodes/，同名覆盖会重新加载。",
      parameters: Type.Object({
        name: Type.String({
          description: "节点唯一标识，小写英文+下划线，如 translate_agent",
        }),
        label: Type.String({ description: "显示名称，如 翻译智能体" }),
        description: Type.String({ description: "节点用途说明" }),
        inputs: Type.Array(
          Type.Object({
            name: Type.String({ description: "输入端口名" }),
            type: Type.String({ description: "类型：text/image/file/path/any" }),
            label: Type.Optional(Type.String()),
          }),
          { description: "输入端口列表（至少 1 个）" }
        ),
        outputs: Type.Array(
          Type.Object({
            name: Type.String({ description: "输出端口名" }),
            type: Type.String({ description: "类型：text/image/file/path/any" }),
            label: Type.Optional(Type.String()),
          }),
          { description: "输出端口列表（至少 1 个）" }
        ),
        systemPrompt: Type.Optional(
          Type.String({
            description: "无 JS 实现时作为智能体节点的系统提示词",
          })
        ),
        implementationCode: Type.Optional(
          Type.String({
            description:
              "可选 JS 实现（ESM，export default { async execute(inputs, config, ctx) {...} }）。提供后节点按函数运行",
          })
        ),
        tools: Type.Optional(
          Type.Array(Type.String(), { description: "智能体节点允许的工具白名单" })
        ),
      }),
      execute: async (_id, params) => {
        const def = {
          name: params.name,
          label: params.label,
          description: params.description,
          category: "agent",
          inputs: params.inputs,
          outputs: params.outputs,
          systemPrompt: params.systemPrompt,
          tools: params.tools,
        };
        try {
          const created = await registry.create(def, params.implementationCode);
          return {
            content: [
              {
                type: "text",
                text: `节点「${created.name}」已创建${created.implementationPath ? "（含 JS 实现）" : "（智能体模式）"}并注册。可用 view_node_library 确认。`,
              },
            ],
            details: {},
          };
        } catch (err) {
          return {
            content: [{ type: "text", text: `创建失败：${err?.message || err}` }],
            details: {},
          };
        }
      },
    }),

    defineTool({
      name: "list_blueprints",
      label: "查看蓝图列表",
      description: "列出全部蓝图：内置预设 + 已保存的蓝图",
      parameters: Type.Object({}),
      execute: async () => {
        const presets = blueprintManager.presetList();
        const saved = blueprintManager.blueprintList();
        const text = [
          "【内置预设】",
          ...presets.map((p) => `- ${p.id}（${p.name}）：${p.description}`),
          `【已保存蓝图】${saved.length ? "" : "无"}`,
          ...saved.map((b) => `- ${b.id}（${b.name}）`),
        ].join("\n");
        return { content: [{ type: "text", text }], details: {} };
      },
    }),

    defineTool({
      name: "run_blueprint",
      label: "运行蓝图",
      description:
        "运行一张蓝图。可传蓝图名称/ID（预设或已保存），或直接传蓝图 JSON 字符串。默认等待完成并返回各节点结果；wait=false 时后台运行并立即返回 runId。",
      parameters: Type.Object({
        name: Type.Optional(
          Type.String({ description: "蓝图名称或 ID（预设/已保存）" })
        ),
        graphJson: Type.Optional(
          Type.String({ description: "蓝图 JSON 字符串（与 name 二选一）" })
        ),
        inputs: Type.Optional(
          Type.Record(Type.String(), Type.String(), {
            description: "输入节点内容，key 为输入节点标题",
          })
        ),
        wait: Type.Optional(
          Type.Boolean({ description: "是否等待完成，默认 true" })
        ),
      }),
      execute: async (_id, params, signal, onUpdate) => {
        let bp = null;
        if (params.graphJson) {
          try {
            bp = JSON.parse(params.graphJson);
          } catch {
            return {
              content: [{ type: "text", text: "graphJson 不是有效的 JSON" }],
              details: {},
            };
          }
        } else if (params.name) {
          bp = blueprintManager.findBlueprint(params.name);
          if (!bp) {
            return {
              content: [
                { type: "text", text: `找不到蓝图「${params.name}」，可用 list_blueprints 查看` },
              ],
              details: {},
            };
          }
        }
        if (!bp) {
          return {
            content: [
              { type: "text", text: "需要提供 name 或 graphJson" },
            ],
            details: {},
          };
        }

        const { runId, run } = blueprintManager.run({
          blueprint: bp,
          inputs: params.inputs,
        });

        const onAbort = () => blueprintManager.abort(runId);
        signal?.addEventListener("abort", onAbort, { once: true });

        // 订阅进度推给聊天工具卡片
        const onNode = (ev) => {
          const head = ev.type === "node-update" ? "…" : ev.type === "node-start" ? "▶ " : ev.type === "node-end" ? (ev.status === "done" ? "✓ " : "✗ ") : "";
          const line = ev.error ? `（${ev.error.slice(0, 120)}）` : ev.text ? ev.text.slice(-300) : "";
          onUpdate?.({
            content: [
              {
                type: "text",
                text: `${head}${ev.nodeTitle}${line ? ": " + line : ""}`,
              },
            ],
            details: {},
          });
        };
        blueprintManager.on("node-event", onNode);

        try {
          if (params.wait === false) {
            return {
              content: [
                {
                  type: "text",
                  text: `蓝图「${run.name}」已启动（runId: ${runId}）。可用 view_blueprint_result 查询结果。`,
                },
              ],
              details: { runId },
            };
          }
          const res = await run.promise;
          const lines = Object.entries(res.results || {}).map(
            ([title, r]) =>
              `【${title}】${r.ok ? (r.output || "").slice(0, 1500) : `失败: ${r.error}`}`
          );
          return {
            content: [
              {
                type: "text",
                text:
                  `蓝图「${run.name}」运行${res.status === "done" ? "完成" : res.status === "aborted" ? "已中止" : "出错"}：\n` +
                  (lines.length ? lines.join("\n\n") : "(无结果)"),
              },
            ],
            details: { runId, status: res.status },
          };
        } finally {
          blueprintManager.off("node-event", onNode);
          signal?.removeEventListener("abort", onAbort);
        }
      },
    }),

    defineTool({
      name: "view_blueprint_result",
      label: "查看蓝图结果",
      description: "查询某次蓝图运行（runId）的状态与各节点结果",
      parameters: Type.Object({
        runId: Type.String({ description: "运行 ID" }),
      }),
      execute: async (_id, params) => {
        const run = blueprintManager.getRun(params.runId);
        if (!run) {
          return {
            content: [{ type: "text", text: `找不到运行 ${params.runId}` }],
            details: {},
          };
        }
        const results = summarizeForAI(run);
        return {
          content: [
            {
              type: "text",
              text:
                `蓝图「${run.name}」状态：${run.status}${run.error ? `（${run.error}）` : ""}\n` +
                truncate(results, 6000),
            },
          ],
          details: { status: run.status },
        };
      },
    }),
  ];
}

function summarizeForAI(run) {
  const lines = [];
  for (const [nodeId, r] of Object.entries(run.results)) {
    const node = run.graph.nodes.find((n) => n.id === nodeId);
    const title = node?.title || nodeId;
    if (r.ok) {
      const out = typeof r.output === "string" ? r.output : JSON.stringify(r.output);
      lines.push(`【${title}】\n${truncate(out, 2000)}`);
    } else {
      lines.push(`【${title}】失败：${r.error}`);
    }
  }
  return lines.join("\n\n");
}
