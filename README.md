# 红中宝 · 红中麻将

基于两大开源项目融合打造的麻将游戏 App：

- **框架与界面**：[babykylin/babykylin_scmj](https://github.com/babykylin/babykylin_scmj)（幼麟棋牌-四川麻将，业界验证的 Cocos Creator + Node.js 全栈框架）
- **核心算法**：[xiyoufang/mahjong](https://github.com/xiyoufang/mahjong)（商业级麻将胡牌/听牌/杠分析算法，由 C++ 移植为 JavaScript）

## 玩法

| 玩法 | 说明 |
|---|---|
| **红中麻将**（主打） | 112 张牌（万条筒+4 红中癞子），可碰可杠不可吃，自摸/接炮/抢杠胡，规则全部可配置 |
| 血战到底 | babykylin 原生四川玩法 |
| 血流成河 | babykylin 原生四川玩法 |

红中麻将可配置规则（建房时选择）：
- 允许接炮 / 仅自摸
- 抢杠胡 开关
- 红中可打出（癞子杠）开关
- 每个手中红中 +1 番 开关
- 底分（1/2/5）、封顶番（3/4/5）、局数（4/8 局）
- 机器人凑桌（0 或 3 个）

## 目录结构

```
红中宝/
├── client/                  # Cocos Creator 2.0.6 客户端（新 App 界面）
│   └── assets/scripts/
│       ├── components/      # 大厅/牌桌/结算等 UI 组件（含红中麻将建房选项）
│       ├── localserver/     # 内嵌服务端（单机模式：房间/游戏/机器人全套）
│       │   └── algorithm/   # 算法模块（与服务端共享同一源码）
│       ├── LocalGame.js     # 单机对局入口
│       ├── LocalNet.js      # 单机网络层（与 Net.js 同接口）
│       └── utils/           # 单机模式 db/crypto 桩件
├── server/                  # Node.js 服务端（账号服/大厅服/游戏服）
│   └── game_server/
│       ├── algorithm/       # ★ 算法核心（xiyoufang 移植）
│       │   ├── GameLogic.js    # 胡牌/听牌/杠分析（34 索引 0x 制）
│       │   ├── LaiziLogic.js   # 癞子扩展（红中万能牌）
│       │   ├── AIEngine.js     # 机器人大脑
│       │   └── TileMap.js      # 牌值映射
│       ├── gamemgr_hzmj.js  # ★ 红中麻将游戏管理器
│       ├── gamemgr_xzdd.js  # 血战到底（原生）
│       ├── gamemgr_xlch.js  # 血流成河（原生）
│       └── botmgr.js        # 机器人管理器（凑桌/托管）
├── server/tests/            # 全部测试（Node 原生断言，零依赖）
├── babykylin_scmj/          # 参考源码：幼麟棋牌（未改动）
└── xiyoufang_mahjong/       # 参考源码：Cocos2d-x 单机麻将（未改动）
```

## 运行测试

```bash
cd server

# 算法单元测试（42 项断言：胡牌/听牌/癞子/七对/碰碰胡/清一色/AI 出牌）
node tests/algorithm.test.js

# 红中麻将服务端全链路集成测试（4 机器人完整对局、零和校验、房间生命周期）
node tests/hzmj_game.test.js

# 单机模式无头仿真测试（内嵌服务端 + 协议路由）
node tests/localgame.test.js
```

## 部署服务端

环境：Node.js（>= 8）、MySQL（>= 5.1，utf8 字符集）

```bash
# 1. 建库
mysql -uroot -p < server/sql/db_babykylin.sql

# 2. 修改 server/configs.js 中的数据库与端口配置（如有）

# 3. 启动三个服务进程
node server/account_server/app.js
node server/hall_server/app.js
node server/game_server/app.js
```

## 构建客户端

1. 用 **Cocos Creator 2.0.6**（必须此版本）打开 `client/` 目录
2. 首次打开会自动为 `localserver/`、`utils/` 等新文件生成 `.meta`
3. 菜单 项目 → 构建发布 → 选择 Android / iOS / H5

客户端单机模式无需任何服务器即可运行（大厅 → 单机模式按钮）。

## 技术要点

- **牌值编码**：算法层使用商业麻将 0x 制（34 索引），框架层使用 babykylin 0-33 id 制，`TileMap.js` 双向桥接
- **癞子算法**：癞子剥离计数 + 将眼枚举 + 递归面子拆分（支持癞子补刻子/顺子/将眼，含七对/碰碰胡/清一色癞子判定），千次判定约 3ms
- **多人响应裁决**：出牌/抢杠引起的碰杠胡响应统一收集，按 胡(截胡顺序)>杠>碰>全过 裁决，支持动作超时自动托管
- **机器人**：负数 userId，fake socket 接入 userMgr，对游戏管理器完全透明；AI 用听口评估选出牌（已听不碰，未听有碰就碰）
- **单机模式**：服务端模块（roommgr/gamemgr/botmgr）原样嵌入客户端，保证单机与联网规则 100% 一致

## 开源协议与致谢

- 幼麟棋牌-四川麻将 v1.0（babykylin）© 成都幼麟科技有限公司，感谢其回馈社区的开源版本
- xiyoufang/mahjong © farmer，MIT License
- 本项目新增代码（红中麻将玩法、癞子算法移植、机器人、单机模式）同样以 MIT 协议发布

仅供学习交流，请勿用于赌博等非法用途。
