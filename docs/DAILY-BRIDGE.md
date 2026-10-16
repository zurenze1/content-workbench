# 现有Codex每日任务 → 工作台

上海时间09:00开始，先把有来源的热点、关注博主评论和公开活动入库，再继续原有双平台成稿。不是工作台内置免费API，也不读取ChatGPT登录令牌；由已有Codex自动化使用其模型和联网工具完成。需本机与Codex运行。

项目位置：`/Users/zurenze/Desktop/小工具/content-workbench`（桌面整理保留的稳定软链接）。Node：`/Users/zurenze/Documents/Codex/tools/node/bin/node`。

1. 运行 `node scripts/workbench-daily.mjs context`，每次读取最新关注博主与采集身份偏好。新增对标账号默认关注，可在“博主与评论”关闭。不能只用旧的固定三个名单。
2. 读取真实热点，保留实际发布时间和来源。使用AIHOT时先读其技能；它的摘要与原文核对分开。人物经历、文学情节、新闻和编辑建议分开。与原任务保持一致，不改变原有每日成稿文件。
3. 在用户正常登录的网页中采集公开评论。优先身份见context.collector。先核对网页昵称与抖音号一致，禁止用客户端的另一个账号；未登录/身份不符则记录“等待指定网页账号登录”，不复制Cookie、不切换客户端。正常操作只读公开作品与评论，不发消息、不点赞、不下载私人信息。2026-10-16实测：内置浏览器的抖音DOM读取超时，Chrome扩展接口连接失败，但 `cua.getApp('com.google.Chrome')` 的原生无障碍界面可用。可通过此正常界面核对“刘爷爷 / 44626857051”，读取公开主页、作品与评论，保留范围。用正常新标签访问主页；不用隐藏API、CDP、开发者控制台或会话导出作为绕过手段。
4. 遍历所有关注博主的可见最新作品，每人先看最近3条作品，每条最多读取20条可见一级评论；按真实点赞数排序选每条最多3条，总量建议30条。保留公开评论原话、公开昵称、原视频URL/标题、评论定位、点赞原标签、采集时间、来源和所读样本范围。不是全站排行榜。未知点赞填null；如“1.2万”估算12000并在scope标“界面约数”。读取失败仍为每位博主提交creatorChecks，不虚构评论或用历史评论冒充当天新采集。
5. 查未来30天已公开官宣的名人出席、演讲、品牌发布会、作品宣发、平台大会，优先人物故事/文化/创作相关。阅读当事方、主办方、场馆或官方品牌公告；区分公告日期、活动日期、时区与具体时间。不能从会议整体日期推定某个人具体发言日期。没有具体场次则暂不落到某天，或仅保存会议主体活动，标明个人场次待核验。不记录私人行踪。对照context.existingEvents：同一场活动的取消、延期或地点更正，填原eventId更新并保留旧版；不同日期的独立场次分开保存。各人的行程不可从历史惯例推测。
6. 保存当前北京时间日期的JSON至原任务当日 `资料备份/编辑资料/工作台日报.json`。运行 `node /Users/zurenze/Desktop/小工具/content-workbench/scripts/workbench-daily.mjs import --file /完整路径/工作台日报.json`，并核对返回news/comments数量和day。脚本直接入库，服务暂未启动也可写入；重启工作台即可看到。不需要开放额外监听端口或关闭CSRF。
7. 评论受限不阻止热点/日历先送达；没有足够可靠新闻不凑数。原任务继续产出既定文件。未来调度只有实际发生才称已验证。

JSON结构（以下是字段示意，不作为实际内容入库）：

```json
{
  "day": "北京时间 YYYY-MM-DD",
  "generatedAt": "实际ISO时间",
  "model": "本次实际使用的模型",
  "news": [{"title":"标题","category":"AI / 社会 / 人物","facts":"已核对事实或明确标注所读摘要","analysis":"编辑判断","publishedAt":"原发布时间或未知","readScope":"实际读取范围","sources":[{"name":"来源名","url":"https://原出处"}]}],
  "comments": [{"accountId":"context中的id","videoUrl":"https://作品","videoTitle":"实际标题","commentId":"可取得时填","commentUrl":"可定位链接，取不到用原视频URL","author":"公开昵称","text":"真实原话","likes":123,"likesLabel":"123","observedAt":"实际ISO时间","origin":"指定网页账号正常浏览","scope":"读了哪些作品和多少评论，仅样本排序"}],
  "creatorChecks": [{"accountId":"context中的id","status":"已读取 / 受限 / 等待指定网页账号登录","note":"实际结果与原因","url":"https://实际主页","observedAt":"实际ISO时间"}],
  "events": [{"eventId":"更新existingEvents已有场次时填id，新活动省略","title":"活动名","subject":"人物 / 品牌 / 平台","eventDate":"YYYY-MM-DD","timeLabel":"当地具体时间；未知如实写","timezone":"Asia/Shanghai或实际IANA时区","location":"公开场馆或线上","kind":"演讲 / 出席活动 / 品牌发布会 / 宣发 / 平台大会","status":"已官宣 / 报道待核验 / 待核验 / 已取消 / 已延期 / 已举行（已核验）","sourceType":"当事方官方公告 / 媒体报道 / 待核验","announcementUrl":"https://已读公告","announcedAt":"原公告日期；未知空字符串","evidence":"实际读到的依据，概述和短引语分清"}],
  "note":"覆盖时间、实际数量、失败和待核验项目"
}
```

相同JSON重试不会重复投递；同日新版本保留历史。原始JSON随完整备份保存。每日评论只在当前聊天及本机工作台交付，不自动发送给第三方。
