# AGENTS.md —— 红中宝项目指南

## 项目概况

红中麻将 App = babykylin（Cocos Creator 客户端 + Node.js 服务端框架）
\+ xiyoufang（C++ 麻将算法，已移植为 JS）。新增红中麻将玩法、AI 机器人（凑桌/托管）、单机模式。

## 验证命令（改代码后必跑）

```bash
cd server
node tests/algorithm.test.js     # 算法单元测试（42 项断言）
node tests/hzmj_game.test.js     # 服务端全链路集成（4 机器人对局）
node tests/localgame.test.js     # 单机模式仿真（需先同步 localserver）
```

全部为零依赖 Node 脚本，数据库已打桩。客户端构建需 Cocos Creator 2.0.6 编辑器（本环境无）。

## 关键约束

1. **算法单一事实源**在 `server/game_server/algorithm/`。改动后必须
   `cp server/game_server/algorithm/*.js client/assets/scripts/localserver/algorithm/`
   同步到客户端单机模式（两副本须保持一致）。
2. **牌编码双制式**：框架层 babykylin id（0-26 筒条万，27 红中）⇔ 算法层 0x 制 34 索引，统一经 `TileMap.js` 转换，不要自写转换。
3. **服务端↔客户端事件协议**必须与 `client/assets/scripts/GameNetMgr.js` 的 `initHandlers` 保持一致（`*_push` 事件名与数据形状）。改 gamemgr_hzmj 的事件前先查 GameNetMgr。
4. 机器人 userId 为负数；`seat.userId === 0` 才是空位（roommgr 曾在此踩坑：`<=0` 会把机器人座位覆盖）。
5. babykylin 原始服务端文件保留 CRLF 行尾与 tab 缩进，编辑时保持一致。
6. `babykylin_scmj/` 与 `xiyoufang_mahjong/` 是**只读参考源码**，勿改。
7. 客户端新文件首次在 Creator 打开时自动生成 `.meta`，提交前确认已生成。

## 调试技巧

- `BOT_DEBUG=1 node tests/hzmj_game.test.js` 打印每个机器人的事件与决策。
- 集成测试里 `botmgr.setThinkDelay(3,10)` 加速对局；生产默认 600-1500ms。

## 待办（未来方向）

- 回放（ReplayMgr）适配红中麻将（actionList 已记录，客户端回放未接）
- 战绩分享/马牌等扩展玩法
- CI（GitHub Actions 跑三个测试脚本；客户端 Web 版构建需 Creator 命令行环境）
