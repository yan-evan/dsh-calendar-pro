<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="/assets/logo_with_name_dark.svg" />
    <img alt="dsh-calendar-pro" src="/assets/logo_with_name.svg" width="420" />
  </picture>
</p>

<h3 align="center">为 DSH 打造的日历插件：开箱即用，让智能体帮助你管理日程。</h3>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%5E22.19.0%20%7C%7C%20%3E%3D24.0.0-green.svg" alt="Node" /></a>
  <a href="https://github.com/deepseek-ai"><img src="https://img.shields.io/badge/DSH-%3E%3D0.2.1--rc.3-purple.svg" alt="DSH" /></a>
</p>

<p align="center">
| <a href="#快速开始"><b>快速开始</b></a> | <a href="MANUAL.md"><b>操作手册</b></a> | <a href="CHANGELOG.md"><b>变更日志</b></a> | <a href="README.en.md"><b>English</b></a> |
</p>

---

> **语言**：中文（本页） · [English](README.en.md)
>
> 相关文档：[操作手册](MANUAL.md) · [变更日志](CHANGELOG.md)

## 关于

dsh-calendar-pro 是 [DSH（DeepSeek Harness）](https://github.com/deepseek-ai)的日历插件。

**让智能体接管日程：**

- **自然语言查询**：直接问「下周三有什么安排」，重复日程自动展开到具体场次，不用自己算日期
- **对话式增改删**：新建、修改、删除一句话交代，全天事件与重复规则（RRULE）完整支持
- **空闲时段推荐**：说明时长与偏好即给出可约候选，默认工作日 09:00–18:00
- **全字段搜索**：按关键词匹配标题、描述与地点，不必记得它落在哪个月
- **可靠的安全约束**：删除重复日程系列、批量删除前，智能体必须先说明影响范围并等你确认

**跨设备日程管理：**

- **支持 CalDAV**：iCloud、Google、Nextcloud，以及任何兼容 CalDAV 的服务，接上即同步
- **融合原生提醒**：同步到 iPhone、iPad 与 Mac 后由系统日历照常提醒，不必额外装 App
- **双向同步**：手机上记的一件事，电脑上能看到；电脑上改过的时间，手机上同样是最新的
- **一份日程，多端一致**：出差用手机看，坐下用电脑改，看到的永远是同一份

**易用性设计：**

- **悬浮日历**：对话页右下角随手点开，不打断当前对话，Esc 收起
- **农历与调休**：法定节假日、调休的休 / 班角标直接标在日期上，排班约人不用另查
- **经期预测**：记录周期并预测下一次的时间，需要时提前提醒，数据只保存在本机
- **直接操作**：点开即详情、拖动即改期、空白处即新建，全程不用跳页面
- **中英双语**：跟随 DSH 界面语言自动切换，不用手动设置

**传统日历，完整保留：**

- **本地日历**：零配置、零账号，不连接任何服务器也能完整使用，给不想折腾 CalDAV 的人一条退路
- **手动建改**：月 / 周 / 议程三视图，点击新建、拖动改时间、框选调整时段，全程不需要智能体
- **ICS 导入导出**：从别的日历搬家不用重录，想带走也随时能导出
- **稳定可靠**：每一次日程操作都有确定结果。

各功能的详细用法见[操作手册](MANUAL.md)，版本变化见[变更日志](CHANGELOG.md)。

## 快速开始

**从 npm 安装：**

```bash
dsh plugin --profile web add dsh-calendar-pro
dsh   # 重启后侧栏出现「日历」
```

也可以完全不开命令行：打开 DSH 的**插件菜单 → 安装插件**，输入 `dsh-calendar-pro` 确认。

**从源码安装**：

```bash
dsh plugin --profile web add file:<本项目的绝对路径>
dsh
```

**从第三方插件市场安装：**

在 DSH 的插件市场里搜索 `dsh-calendar-pro`，点击安装即可。

装完之后，对智能体说一句话试试：

```
你：下周哪天适合安排一次两小时的复盘会？
DSH：下周二 14:00–16:00 和周四 10:00–12:00 都空闲，要帮你把周二那场建上吗？

你：建在周二下午两点，标题「Q4 复盘」。
DSH：已创建。
```

**卸载：**

`dsh plugin --profile web remove dsh-calendar-pro`。

## 交流与反馈

欢迎关注微信公众号与我交流：

![微信公众号二维码](assets/wechat-qr.jpg)

遇到问题、有想法或想提需求，欢迎[提 Issue](https://github.com/yan-evan/dsh-calendar-pro/issues)交流，也欢迎 PR。

## 鸣谢

本项目基于 [STARDUSTLC666/dsh-calendar](https://github.com/STARDUSTLC666/dsh-calendar) **v0.14.3** 版本开发，感谢原作者 [stardustlc](https://github.com/STARDUSTLC666) 与上游社区打下的扎实基础。


| 功能 | dsh-calendar 0.14.3 | dsh-calendar-pro |
| --- | --- | --- |
| 本地日历 | 不支持 | **支持** |
| 数据源迁移 | 不支持 | **支持** |
| 农历、法定节假日与调休 | 不支持 | **支持** |
| 经期记录与预测 | 不支持 | **支持** |
| ICS 导出 | 不支持 | **支持** |
| 交互易用性 | 易用 | **更易用** |
| CalDAV 连接 | 支持 | 支持 |
| 智能体工具 | 支持 | 支持 |
| 日历视图与手动操作 | 支持 | 支持 |
| 重复日程与全天事件 | 支持 | 支持 |
| ICS 导入 | 支持 | 支持 |
| 悬浮日历与中英双语 | 支持 | 支持 |

## License

[MIT](LICENSE)
