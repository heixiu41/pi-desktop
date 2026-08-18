/**
 * 知识库（RAG）工具：让 pi 能检索知识库、导入文档
 */
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";

export function createKnowledgeTools({ ragEngine }) {
  return [
    defineTool({
      name: "search_knowledge",
      label: "检索知识库",
      description:
        "在本地知识库中做语义检索（RAG）。回答涉及用户导入过的文档/资料时，先用它检索相关内容，再结合检索结果回答。",
      parameters: Type.Object({
        query: Type.String({ description: "检索查询，用自然语言描述想找的内容" }),
        k: Type.Optional(Type.Number({ description: "返回条数，默认 4" })),
      }),
      execute: async (_id, params) => {
        try {
          const results = await ragEngine.search(params.query, params.k || 4);
          if (!results.length) {
            return {
              content: [{ type: "text", text: "知识库中没有匹配的内容。" }],
              details: {},
            };
          }
          const text = results
            .map(
              (r, i) =>
                `【${i + 1}】（相关度 ${r.score}，来源：${r.docName || "未知"}）\n${r.text}`
            )
            .join("\n\n---\n\n");
          return {
            content: [
              {
                type: "text",
                text: `知识库检索「${params.query}」命中 ${results.length} 条：\n\n${text}`,
              },
            ],
            details: { count: results.length },
          };
        } catch (err) {
          return {
            content: [{ type: "text", text: `检索失败：${err?.message || err}` }],
            details: {},
          };
        }
      },
    }),

    defineTool({
      name: "import_knowledge",
      label: "导入知识库",
      description:
        "把一段文本或一个本地文件导入知识库（向量化索引），之后可用 search_knowledge 检索。text 与 filePath 二选一。",
      parameters: Type.Object({
        text: Type.Optional(Type.String({ description: "要导入的文本内容" })),
        filePath: Type.Optional(
          Type.String({ description: "要导入的本地文件路径（txt/md 等）" })
        ),
        name: Type.Optional(Type.String({ description: "文档名称，缺省取文件名为自动命名" })),
      }),
      execute: async (_id, params) => {
        try {
          if (!ragEngine.modelReady) {
            return {
              content: [
                { type: "text", text: "嵌入模型尚未就绪，请稍后再试或检查下载面板中的模型下载。" },
              ],
              details: {},
            };
          }
          let result;
          if (params.filePath) {
            result = await ragEngine.importFile(params.filePath);
          } else if (params.text) {
            result = await ragEngine.importText({
              name: params.name,
              content: params.text,
            });
          } else {
            return {
              content: [{ type: "text", text: "需要提供 text 或 filePath。" }],
              details: {},
            };
          }
          return {
            content: [
              {
                type: "text",
                text: `已导入「${result.name}」，共 ${result.chunks} 个片段。可用 search_knowledge 检索。`,
              },
            ],
            details: result,
          };
        } catch (err) {
          return {
            content: [{ type: "text", text: `导入失败：${err?.message || err}` }],
            details: {},
          };
        }
      },
    }),
  ];
}
