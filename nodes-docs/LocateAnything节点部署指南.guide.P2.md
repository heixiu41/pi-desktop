---
title: LocateAnything节点部署指南
description: 在 Pi 节点系统中部署 NVIDIA LocateAnything-3B（ggml 移植）为目标检测节点：权重下载、源码编译、节点使用、性能与故障排查。含 2080 Ti（Turing）硬件适配说明。
tags: [guide, deploy, vision, locateanything, ggml, cpp]
---

# LocateAnything 节点部署指南（guide.P2）

## 1. 模型与方案

- **模型**：NVIDIA **LocateAnything-3B**——开词表目标检测/视觉定位 VLM（Qwen2.5-3B + MoonViT + 2 层 MLP）。输入图片 + 自然语言提示词 → 输出带标签检测框。
- **方案**：**ggml 移植（`locate-anything.cpp`，MIT）**而非官方 PyTorch。原因：
  - 官方模型 **BF16 only、要求 Ampere 及以上（compute≥8.0）**，本机 RTX 2080 Ti（Turing 7.5）**不满足**，且官方路线需 Linux+Python+Docker。
  - ggml 移植：**纯 CPU 可跑**（AVX512/AVX2），检测结果与官方逐像素一致（IoU 1.000），量化 q8_0 仅 6.26GB。
- **许可证**：模型本体为 **NVIDIA 非商用/学术许可**；移植代码 MIT。商用需另行授权。

## 2. 目录与产物

| 项 | 位置 |
|---|---|
| GGUF 权重 (6.26GB) | `~/.pi/models/locate-anything/locate-anything-q8_0.gguf` |
| 源码 | `Desktop/UI/locate-anything.cpp-master/`（含 `third_party/ggml` 子模块） |
| 编译产物 | `Desktop/UI/locate-anything.cpp-master/build/examples/cli/Release/locate-anything-cli.exe` |
| 节点定义 | `~/.pi/nodes/locate_anything.json` + `locate_anything.js` |

## 3. 部署步骤（一次性）

### 3.1 下载权重（hf-mirror，已验证可下）
```
https://hf-mirror.com/mudler/locate-anything.cpp-gguf/resolve/main/locate-anything-q8_0.gguf
```
校验：字节数 6259931712；文件头 magic 为 `GGUF`。

### 3.2 获取源码（GitHub 直连在本网络受限，需手动下载）
- 主仓库：`https://github.com/mudler/locate-anything.cpp`（zip 即可）
- **ggml 子模块（必须）**：zip 不含子模块，需单独下载，commit 固定为
  `https://github.com/ggml-org/ggml/archive/7142aa6bf9fcaeec0fef8d80fcd90afe4268adf1.zip`
  解压后把内容放入 `locate-anything.cpp-master/third_party/ggml/`。

### 3.3 编译（需 MSVC Build Tools + CMake，已装）
CPU 版：
```
cmake -B build -G "Visual Studio 17 2022" -A x64 -DLA_BUILD_CLI=ON
cmake --build build --config Release -j 8
```
**CUDA 版（推荐，2080 Ti 显著提速）**：需先装 CUDA Toolkit 12.6（`developer.download.nvidia.com/compute/cuda/12.6.2/local_installers/cuda_12.6.2_561.17_windows.exe`），然后：
```
cmake -B build-cuda -G "Visual Studio 17 2022" -A x64 -DLA_BUILD_CLI=ON -DLA_BUILD_SERVER=ON -DLA_GGML_CUDA=ON -DGGML_CUDA_ARCHITECTURES=75
cmake --build build-cuda --config Release -j 8
```
`GGML_CUDA_ARCHITECTURES=75` 对应 2080 Ti（Turing，sm_75）。

### 3.4 注册节点
主进程 `window.pi.nodeReload()` → 节点库出现 `locate_anything`。

## 4. 节点用法

- **输入**：`image`（图片路径）、`prompt`（检测描述，如 `bus` 或 `person</c>car`）
- **输出**：`detections`（JSON 文本：`[{label, box:[x0,y0,x1,y1]}...]`）、`annotated`（标注图路径）
- **config**：`cli/server`（二进制路径，默认自动探测）、`model`（GGUF 路径）、`mode`（`slow|hybrid|fast`，默认 hybrid）、`threads`、`outputDir`
- **推理通道**：优先 `locate-anything-server`（**常驻模型服务**，模型加载一次多次推理）；未找到则回退一次性 `locate-anything-cli`

单测：
```
node node-test.mjs locate_anything --inputs '{"image":"<图片>","prompt":"bus"}' --config '{"mode":"fast","server":"<server.exe>"}'
```

## 5. 性能（本机 Ryzen 5 7600X / RTX 2080 Ti 22GB）

| 配置 | 单图耗时（q8_0） | 说明 |
|---|---|---|---|
| CPU 一次性 CLI | ~70s | CPU 推理瓶颈（fast 64s / hybrid 69s / slow 84s） |
| **CUDA 一次性 CLI** | **~6.3s** | 加载到显存 3.5s + 推理 2.8s |
| **CUDA 常驻 server** | **首次 6.2s，之后 2.8s/图** | 模型常驻显存，多次推理免加载 |

- **实测提速**：CPU→CUDA 约 **22×**（64s → 2.8s）。
- CUDA 版需将 `api-ms-win-crt-*.dll`（UCRT）与 `cudart/cublas/cublasLt64_13.dll` 复制到 exe 目录（本机 UCRT 为 downlevel 状态，System32 顶层缺失）。
- 节点自动探测顺序：`build-cuda`（GPU）> `build`（CPU）；优先 `locate-anything-server`（常驻），回退一次性 CLI。

## 6. 故障排查

| 现象 | 原因/解法 |
|---|---|
| `未找到 locate-anything-cli` | 二进制不在自动探测路径 → config.cli/server 显式指定 |
| `未找到 GGUF 权重` | 检查 `~/.pi/models/locate-anything/` |
| 编译失败 | 确认 `third_party/ggml` 已填充（空目录会失败）；CUDA 版确认 CUDA Toolkit 已装且 `GGML_CUDA_ARCHITECTURES` 正确 |
| 检测慢 | CPU 属预期；编译 CUDA 版或用 fast 模式 |
| server 启动超时 | 模型路径错误或二进制与 GGUF 不匹配 |

---

# 附：聊天视觉桥（DeepSeek 看图）

## 原理
DeepSeek API 纯文本（`input:["text"]`），无法原生看图。方案：**图 → 本地视觉模型描述 → 描述注入聊天消息 → DeepSeek 基于描述回答**。

## 组件
1. **视觉模型**：Qwen3-VL-8B-Instruct（GGUF，存放在 `~/.pi/models/qwen3-vl/`）
   - `~/.pi/models/qwen3-vl/Qwen3VL-8B-Instruct-Q4_K_M.gguf` + `mmproj-Qwen3VL-8B-Instruct-F16.gguf`
2. **运行时**：llama.cpp **CUDA 12.4** 预编译版（`Desktop/llama-cpp/bin124/`，**勿用 13.3 版——Turing 上会 illegal memory access**）
3. **服务**：`start-qwen-vl.bat` 启动，端口 8081（OpenAI 兼容 /v1/chat/completions，支持 base64 图片）
4. **节点**：`vision_caption`（函数节点，图→描述，供流水线用）
5. **聊天桥**：`renderer/index.html` 加"📎 上传图片"按钮 + `app.js` 发送前自动调视觉模型生成描述并注入消息

## 使用
- 先跑 `start-qwen-vl.bat`（保持服务常驻）
- 聊天框点 📎 传图 → 输入问题 → 发送 → DeepSeek 先"看图"再回答
- 节点方式：`image → vision_caption → agent(DeepSeek)`

## 注意
- 视觉服务停止时，聊天发图会提示"本地视觉模型暂不可用"（降级为无描述发送）
- 2080 Ti 用 CUDA 12.4；Qwen3-VL Q4 占 ~6GB 显存

## 聊天视觉桥排障记录
- **历史记录打不开 bug**：曾因 `$("id")` 忘写 `#` 导致脚本中断、init 不执行（UI 全瘫）。教训：`$` 是 querySelector，需 CSS 选择器。
- **发图提示"视觉模型不可用"**：根因是 **CSP**——`index.html` 的 `Content-Security-Policy` 只有 `default-src 'self'`，渲染进程 fetch 本地视觉服务被拦截。已在 CSP 增加 `connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*`。
- llama-server CORS 参数名是 `--cors-origins`（不是 `--cors`），默认 `*`。
