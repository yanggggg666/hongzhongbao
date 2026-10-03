# CI 构建说明（GitHub Actions 出 Android APK）

本项目可通过 GitHub Actions 自动构建 Android APK，流水线文件：
`.github/workflows/build-android.yml`（手动触发：Actions → 构建 Android APK → Run workflow）。

## 技术方案

| 项 | 选择 | 原因 |
|---|---|---|
| 编辑器 | Cocos Creator **2.4.15**（2.x LTS 最终版） | 2.0.6 项目可自动迁移；工具链现代化（原 2.0.6 需老 JDK8+旧 NDK，极脆弱） |
| Runner | `windows-latest` | 命令行构建需要 GUI 环境（官方文档明确），Windows runner 自带桌面会话 |
| JDK | 8（runner 预装 `JAVA_HOME_8_X64`） | 2.4 Android 模板（AGP 3.x）要求 JDK 8 |
| SDK/NDK | `sdkmanager` 在线安装 android-28 + build-tools 28.0.3 + NDK r21d | r18b~r21d 为 2.4 官方推荐区间，workflow 输入可调 |
| 构建命令 | `CocosCreator.exe --path client --build "platform=android;debug=true;autoCompile=true"` | 官方命令行构建参数 |
| 产物 | debug APK（单 ABI armeabi-v7a，包名 `org.hongzhongbao.mahjong`） | artifact 上传，可安装到手机 |

## ⚠️ 唯一的前置手工步骤：配置 COCOS_PROFILE_B64

**Cocos Creator 2.x 启动时强制登录 Cocos 账号（在线激活）**，CI 中无法交互登录。
解法：从一台已登录的 Windows 电脑导出编辑器档案，在 CI 中还原。

1. 在任意 Windows 电脑安装 Cocos Creator 2.4.x（官网/Dashboard 下载），**打开并登录一次**（账号免费注册）后完全退出编辑器。
2. 在该电脑 PowerShell 执行：
   ```powershell
   Compress-Archive -Path "$env:USERPROFILE\.CocosCreator\*" -DestinationPath profile.zip
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("profile.zip")) | Set-Clipboard
   ```
3. 打开仓库 GitHub 页面 → **Settings → Secrets and variables → Actions → New repository secret**：
   - Name: `COCOS_PROFILE_B64`
   - Value: 剪贴板内容（一大段 base64）
4. 完成。之后每次 Run workflow 即可自动出包。

> 若档案内的登录态过期（通常很久才失效），重复上述步骤更新 secret 即可。

## 替代方案：Self-hosted Runner（更省心，推荐有条件时使用）

如果你有一台常开的 Windows/Mac 电脑：

1. 装好 Cocos Creator 2.4.15 并登录一次；装好 JDK 8 + Android SDK + NDK r21d。
2. 仓库 → Settings → Actions → Runners → New self-hosted runner，按引导注册。
3. 把 workflow 的 `runs-on: windows-latest` 改为 `runs-on: self-hosted`，
   并删掉"下载/解压 Creator"与"还原档案"两个步骤（本机已就绪）。

## 常见失败排查

| 现象 | 原因 | 处理 |
|---|---|---|
| 构建步骤 45 分钟超时 | 卡在登录窗口（档案未配置/失效） | 配置/更新 `COCOS_PROFILE_B64` |
| `sdkmanager` 报错 | runner 镜像 SDK 路径变化 | 查看步骤日志中 `ANDROID_SDK_ROOT` 实际值 |
| gradle 编译报错 NDK 路径 | NDK 版本不被 2.4 支持 | Run workflow 时把 `ndk_version` 改为 `18.1.5063045`（r18b）重试 |
| 编辑器报资源导入错误 | 2.0.6→2.4 迁移个别资源告警 | 查看构建日志；多数告警不影响出包 |
| 找不到 APK 文件 | 输出路径变化 | 查看"命令行构建"步骤日志中的实际输出目录，调整 artifact 路径 |

## 本地构建（不用 CI）

直接用 Cocos Creator 2.4.15 打开 `client/`（首次会自动迁移工程并生成缺失的 .meta），
菜单 项目 → 构建发布 → Android → 构建 + 编译，即可得到 APK。
