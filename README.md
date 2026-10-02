# HacKU_2026_TeamJopz

This is the repository of the Team Jopz in HackU 2026 Hackathon contest!

## 项目结构

```text
.
├── .github/                 # GitHub 配置
├── docs/                    # 项目文档、架构图、Statement、Handbook
├── public/                  # 静态资源
├── src/                     # 源代码
├── README.md                # 项目说明
└── LICENSE                  # 许可证
```

## 分支结构

| 分支 | 用途 |
| --- | --- |
| `main` | 稳定可演示版本，用于最终提交和展示
| `develop` | 团队集成分支，功能合并到这里联调
| `dev-<Name>` | 个人分支

## 创建开发环境

先安装一下 git。

打开你的编译器，找到 `Clone Repository`。绑定你的 Github 账号，选择一个文件目录，然后就可以开始了。

首先，设立自己的个人分支 `dev-<Name>`，打开编译器终端，然后按照指示键入如下指令。

```
# 切到 develop 并拉取最新代码
git checkout develop
git pull origin develop

# 创建并切换到个人分支
git checkout -b dev-<Name>

# 推送到远程，建立跟踪关系
git push -u origin dev-<Name>
```