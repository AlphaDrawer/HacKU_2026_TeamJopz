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

先安装一下 git，安装一些必要的插件。

打开你的编译器，找到 `Clone Repository`。绑定你的 Github 账号，选择一个文件目录，然后将我们的仓库从 github 上复制下来（绿色的 `Code` 点开下面有一个 Clone 的网址），然后就可以开始了。

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

大家可以搜索一下 `git` 指令的使用。这里不再赘述。

每次我们更新的时候，应当先更新到 `develop` 当中。如果要更新到 `main` 是需要在 github 网页端手动操作 + 至少一个人 Review 之后才能 `merge` 的。

不要直接 PR 到 `main` 分支！不要直接 PR 到 `main` 分支！不要直接 PR 到 `main` 分支！

## 如何将你的成果上传到仓库当中

首先，切换到你的分支。

```bash
git checkout dev-<Name>
```

接下来需要将你的修改推送到远程。

在 `Microsoft VS Code` 当中，你可以使用左边栏的 Source Control 中巨大的蓝色 Commit 按键，点击它然后填写修改内容就好了。简单描述你的修改内容即可，我们不设格式要求！

如果你使用命令行，那么你需要在终端中输入如下内容：

```bash
git status # 确认状态
git add .
git commit -m "feat: 完成 xxx 功能" # 这里写描述，简单写写你修改了啥

git push origin dev-<Name>
```

接下来我们的操作会在 Github 网页端进行。

1. 打开仓库页面 → Pull requests → New pull request。

2. 设置：
   
   base：`develop`
   
   compare：`dev-<Name>`
   
3. 填写标题和说明。可以指定人进行 Review。

4. 点击 Create pull request。

5. Review 通过后，点击 Merge pull request。

这样就完成了 `dev-<Name>` 到 `develop` 的过程。`develop` 到 `main` 也是类似的过程。

## `git` 命令速览

| 操作 | 命令 |
| --- | --- |
| 切到 develop | `git checkout develop` |
| 拉取最新 develop | `git pull origin develop` |
| 合并 dev-zane 到 develop | `git merge dev-zane` |
| 切到 main | `git checkout main` |
| 拉取最新 main | `git pull origin main` |
| 合并 develop 到 main | `git merge develop` |
| 推送分支 | `git push origin 分支名` |
| 查看本地分支 | `git branch` |
| 查看远程分支 | `git branch -r` |
| 查看所有分支 | `git branch -a` |
| 删除本地分支 | `git branch -d 分支名` |
| 删除远程分支 | `git push origin --delete 分支名` |