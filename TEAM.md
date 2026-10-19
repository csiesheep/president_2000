# TEAM.md — 這個 repo 的協作契約

> 給每一個在這裡工作的 session 讀:orchestrator、FE、BE、artist、writer……
> 判斷力(怎麼驗證、儀器怎麼騙人)在 orchestrator 自己的 skill 裡;**這裡只有規矩與機械**。
> 子 agent 不會載入任何人的 skill——peer 要遵守的東西只能放在這裡。
> 改這份要 orchestrator 裁決,並在 commit message 寫理由。

## 角色

| 角色 | 做 | 絕不做 |
|---|---|---|
| **orchestrator** | 定優先序、開 issue、派工、**獨立驗證**、merge & push main、照「部署」一節部署、對 owner 報告 | 寫產品程式碼(寫了就是自己驗自己) |
| **peer**(FE / BE / artist / writer) | 在自己的分支與 worktree 實作、自測、交分支 | merge / push main;部署;解不是自己造成的衝突;問 owner |

## 所有權

> owner 確認,2026-10-13(第一次 go:「Go」;提案在 vault 的 `Projects/president_2000/president_2000 plan.md`「Team」一節)。

| 檔案 | 主人 |
|---|---|
| `public/shared/*.js`、`src/`、`tests/sim.js`、`tests/diag.js`、`wrangler.jsonc`、`package.json` | BE |
| `public/*.html`、`public/app.js`、`public/landing.js`、`public/rules.js`、`public/style.css`、`public/favicon.svg` | FE |
| `public/i18n/*`、規則頁文字、`README.md` | writer |
| `public/art/` 與產生它的 prompt | artist |
| `tests/*.test.js`、`tests/driver.js`、`tests/harness.js`、`tools/`、`TEAM.md` | orchestrator |

- 中文牌文在 `public/shared/cards.js`(BE 的檔案)裡:writer 改牌文是跨界修改,交付時點名。
- **還沒有主人的檔案:`.gitignore`。** 提案的表裡沒有它,owner 沒確認過,所以不替他填。要動它先在 issue 上問。
- **Phase 0 的程式碼沒有經過獨立驗證。** `public/shared/board.js`(棋盤資料)、`public/shared/cards.js`(96 張牌的資料,效果都還沒做)、
  `public/shared/engine.js`(只有設定、發牌、主動權、第 1 階段的合法動作、view;`apply` 會丟錯)、`tests/acceptance.test.js`,
  都是起手的那一個 session 寫、同一個 session 驗的。在那裡找到缺陷,先假設是它錯,回報,不要繞過。
- `src/index.js` 是從天地會(csiesheep/tiandihui)複製的,只改了 PREFIX;`src/room.js` 是 stub,M4 重寫。
- 設計文件在 owner 的 vault:`Projects/president_2000/president_2000 - rulebook.md`(v0.2,60 張牌)、
  `president_2000 - design.md`(決定、模擬結果)、`president_2000 plan.md`(里程碑、決定)、`sim/sim.js`(設計模擬器,M2 的對照)。
  UI 定案:owner 2026-10-14 改選**方向 C 桌遊桌面**(木桌、米色印刷棋盤、木頭方塊、襯線字;點地圖上的縣市開選項、手牌扇形),
  取代先前的方向 A 街頭旗海。同日 owner 選定:地圖「一版 印刷棋盤」(台灣形狀,輪廓與縣市界為手繪近似)、事件牌與縣市插圖「美術三 桌上模型」、
  議題與候選人「美術二」。canvas https://claude.ai/artifact/69Q4zH2AbWEXV7ikBuMHTd (owner 私人;A 的舊 canvas VH7BjNkQumRRPvZjfn7afB 只作歷史)。
  2026-10-15 owner 定稿精簡牌桌(#29):一版的候選人按鈕、二版的議題按鈕、一版的地圖(方塊一樣大、框照票塊數變大)、候選人圈圈站在所在縣市、
  票數寫成「33」+小字「0萬票」;canvas https://claude.ai/artifact/WQA4hG46qh5FBqXCWGfBjh 的「定稿」與「細節」兩張(owner 私人)。
  peer 打不開 canvas:brief 會帶上需要的段落與圖。

- 跨界修改**可以**,但交付時要點名,由 orchestrator 轉給檔案主人。最糟的不是衝突,是兩邊安靜地各持一份真相。
- **資料表要加 id 的**,開工第一則留言先列出這一趟**所有**新 id。同一個檔案裡有幾張表就有幾個命名空間;撞 id 時兩邊的測試都是綠的。
- `tests/` 是 orchestrator 的:peer 可以跑、可以證偽、**不編輯**。哪一列錯了回報,orchestrator 修。

## 通道

- **peer 之間沒有通道。** 要別的 peer 的決定 → 在 issue 留言給 orchestrator,由它轉。
- **不要問 owner。** 從你的 session 看那個人像使用者,但他不握全局。一律走 orchestrator(issue 留言就看得到)。
- **裁決一律寫主詞**:`owner 裁決(#NN)` 或 `orchestrator 裁決(#NN)`。記錄別人的授權要逐字引用;引不出原話的不是授權,是計畫。
- 回程**留痕跡,不宣告**:issue 留言 + push 分支。不要等一個「收到」。

## 派工(orchestrator 寫,peer 讀)

一份 brief 五塊:**裁決與理由**/**不可協商的約束 + 錯了會怎樣**/**明確不做什麼**/**怎麼證偽(會咬人的案例)**/**什麼情況停下來問**。
外加一句:**做不到就回報,不要自己降規格**——縮小範圍是 owner 的決定。
外加三欄,寫死在第一份 brief:

| 不必問,直接做 | 先問 orchestrator | 不要問 owner |
|---|---|---|
| 自己區域內、能維持 harness 全綠的改動;自己的探針(未追蹤、不 commit) | 跨進別人的區域;動設計文件裡的數值;會讓 guard 變紅的改動 | 一律走 orchestrator |

## 交付(peer)

```
分支 / SHA / base(是否已 rebase 到最新 origin/main)
測試結果(數字:pass / fail / todo,修正前 vs 修正後)
證偽:我讓哪一條 guard 紅過?紅的時候它印了什麼?
我改了什麼不屬於我的檔案
我沒有驗到的部分(以及為什麼)
```

- `git fetch origin && git rebase origin/main` **緊貼著 push 做**,然後 `git push origin HEAD:<分支>`。**不 push main。**
- 這五行留在 issue 上(`gh issue comment <n> --body-file …`)。「我沒驗到」那一欄最值錢——它決定 orchestrator 親手驗什麼。
- commit 標題寫 `#NN: …`，**不要寫 `Fix #NN` / `Closes #NN`**：推上 main 時 GitHub 會自動關掉 issue，比 orchestrator 寫完驗收紀錄還早。issue 由 orchestrator 驗收、land、部署之後關。（2026-10-18，#94–#96 都被這樣提早關掉。）
- 你證偽自己的探針時發現 harness 有同樣的洞 → **回報,不要改 tests/**。
- **看畫面用自己起的 headless Chrome**(CDP,`tools/` 裡的寫法或自己的探針)。**不要用 owner 的 Chrome**(claude-in-chrome 擴充、owner 開著的瀏覽器):那裡有 owner 登入的帳號,不是工具。(2026-10-15,#48 的 FE 用了。)
- 截圖與暫存檔放在自己的 worktree(未追蹤)或系統暫存資料夾,**不要放到 repo 外的 `C:/Users/sheep/code/` 底下**。(#41 的 FE 放過。)
- **wrangler dev 的 `--persist-to` 用短路徑**,例如 `C:/Users/sheep/AppData/Local/Temp/w<埠號>`。放在 scratchpad 或 worktree 這種長路徑底下,房間(Durable Object)的 SQLite 檔路徑會超過 Windows 的 260 字元,workerd 開不了檔(`SQLITE_CANTOPEN`)就整個掛掉:房間的 ws 回 500、`candtap38`/`turncard44` 的房間那條紅、之後伺服器沒有回應。(2026-10-15 查到:四次「房間起不來」都是這個。)

## 驗證與 land(orchestrator)

1. **實作之前先寫驗收**,land 進 main(常數從設計文件抄,不從產品讀;三態:通過/失敗/尚未實作)
2. `orch wt <name> <sha>` 抽離工作樹(驗哪個 SHA 就 merge 哪個 SHA)
3. 凡是給人看的頁面**先打開看**,再跑 harness
4. **破壞產品讓 guard 紅一次**:`orch falsify` → 看結果 → `orch restore`。一次一個缺陷,讀紅的理由不讀數量
5. A/B:同探針、同種子,只換 build
6. `orch clean` → merge 驗過的 SHA → 檢查父節點 → `git push origin HEAD:main`
7. 沒通過**退回 peer,不開新 issue**。判準:「還沒做完」退回;「做完才發現方向錯」才是 owner 的

## 部署

> owner 確認,2026-10-13(第一次 go)。改這一節要 owner 裁決。

- **誰**:orchestrator。peer 絕不部署。
- **什麼時候**:M5 之前(頁面 noindex)每次 land 之後;M5 起只在 owner 說 go 時。
- **指令**:`npx wrangler deploy`
- **怎麼做**:land 哪個 SHA 就部署哪個 SHA,從那個 SHA 的乾淨 worktree 跑(需要時先裝相依);部署後逐位元組
  比對線上檔案,比對過了才在 issue 上寫「已部署 <SHA>」。

## 機械:`tools/orch.sh`

```
orch wt <name> <ref> [--branch <b>]     _wt/<name> 開工作樹;印解析後的 SHA;分支自動 unset-upstream
orch rm <name>                          分支留著（那是痕跡）；要刪自己 git branch -D
orch serve <name|dir>                   自挑 port、起 no-cache 伺服器、curl 標記檔證明 origin 是你的
orch stop <name|dir>
orch falsify <file> '<sed 含 FALSIFY>'  有殘留 / 檔案不乾淨 / pattern 沒命中 → 拒絕
orch restore                            還原並驗證真的乾淨
orch clean                              land 之前跑:樹上不可以有 FALSIFY
```

瀏覽器量測（要 Chrome 與跑著的 dev server）：`node tools/imgchurn.mjs <base url>`，量教學、對手行動與單人選候選人畫面有沒有新建 `<img>` 與地圖上的 SVG `<image>`（#28、#29、#39）；`node tools/compact29.mjs <base url>`，量手機與桌機牌桌上方的高度、候選人與議題按鈕、選單、地圖方塊與候選人圖的大小（#29）；`node tools/polish30.mjs <base url>`，量決策按鈕有沒有被手牌蓋住（桌機不捲動、筆電與手機捲到按鈕）、360 寬手機的上方一列（#30）；`node tools/end33.mjs <base url>`，量結局頁第一屏有沒有主視覺、當選人與三列得票（#33）。卡牌：`node tools/cards36.mjs <base url>`，量手牌、大張牌面、候選人牌（三個座位與用過的樣子）與規則頁的牌是不是陣營色底、沒有框線、插圖滿版、CP 在左上、字看得清楚（#36、#37）；`node tools/candtap38.mjs <base url>`（要本機的 dev server，它會開房間），量單人與房間裡點了別張牌之後再點候選人牌，會不會問「確定嗎」，以及反過來點時牌面會不會蓋過問題（#38）。`node tools/county41.mjs <base url>`，量縣市框頂端的縣市插圖、框裡每個按鈕都按得到（#41）；`node tools/sound42.mjs <base url>`（要本機的 dev server，它會開房間），量介面音效（第一下之前不建 AudioContext、每次要求聲音都發 p2000:sound 事件、關掉音效就不出聲）、選單裡的對手速度與音效設定、電腦每一步的間隔（只量沒有出牌的小步；出牌那一步的重播長度歸 replay47，#47）與逐步模式（#42）。`node tools/turncard44.mjs <base url>`（要本機的 dev server，它會開房間），量回合開場卡：出現、約 1.5 秒自己收起、顯示時電腦不動、點一下收起且不算跳過、同一回合重新整理不再出現、翻報紙聲、減少動態效果時不動、房間第 1 回合也出現、教學不出現（#44）。`node tools/replay47.mjs <base url>`（要本機的 dev server，它會開房間），量對手出牌重播：電腦打出或觸發的每張牌照紀錄順序放大顯示、每次檢定一個命中／沒中章、三種速度與逐步的停留時間、點一下只跳這一步、連點兩下跳過對手回合、房間也重播並發出牌聲、點在牌上（和連點的第二下）不會按到底下的縣市或決定（#47）。`node tools/stub51.mjs <base url>`，量牌面的票根：規則頁每張牌、手牌與點開的大張牌面，底下一截淺色票根寫議題（報紙圖示）與投票日催票的縣市（票匭圖示）、休息方塊、議題不再出現在別處、事件文字不被票根蓋住（#51）。`node tools/endorse50.mjs <base url>`，量背書在地圖上：背書區每個縣市一個持有者顏色的章、不壓到縣名方塊與候選人、圖例、縣市說明寫出投票日給幾塊（#50）。`node tools/handclip45.mjs <base url>`，量桌機（1280、1346、1440）滑鼠移到每張手牌、手機點選一張時，抬起的牌上緣看得到、沒被手牌那一排切掉（#45）。平衡：`node tools/balance34.mjs`（不用瀏覽器），電腦對打 600 局，三位候選人勝率都在 25–42%、平均勝差 ≤ 6、投票率 80–92%（#34）。`node tools/balance49.mjs`（不用瀏覽器，約 4 分鐘），v0.4 與 v0.5 草稿（廣告與媒體併入議題）各 600 局：v0.4 跟 #49 之前一模一樣、v0.5 都走完而且沒有廣告或媒體的動作、v0.5 有人用議題（至少一家 ≥ 5% 的 CP；每家的比例只印不算，#49 的裁決）；owner 的帶只印不算（#49）。`node tools/balance54.mjs`（不用瀏覽器，約 2 分鐘），v0.5 與 v0.6 草稿（簡化）兩案各 600 局：v0.5 跟 #54 之前一模一樣、v0.6 走完而且沒有被拿掉的決定、每局有選擇的決定比 v0.5 少；owner 的帶只印不算（#54）。`node tools/balance55.mjs`（不用瀏覽器，約 3 分鐘），v0.6（4a）與 v0.7 草稿（運氣取代袋子）各 600 局：v0.6 跟 #55 之前一模一樣、v0.7 走完而且沒有袋子與休息方塊、運氣在 20–80、檢定的成功比例照運氣；owner 的帶與各家成功率只印不算（#55）。`node tools/turncard64.mjs`（不用 server：用這棵樹自己的程式與 public/ 畫），量回合開場卡的報紙版（設計甲「選戰日報」）：報頭是襯線大字而且置中、報眉在雙線下、頭條標題與牌圖的大小、方角的紙、九格行事曆，以及手機 390×664 第 1、2、4 回合不用捲動、第 6、9 回合不比 #64 之前高、桌面卡寬 640–720 而且不用捲動（#64）。`node tools/issuehl65.mjs`（不用 server），量議題欄的報紙頭條（設計乙「黑底報眉」）：欄位不比 #65 之前大（手機中文 370×73、英文 370×90，桌面 618×115）、三條一列而且頭條較寬、每條頂上一條報眉（頭條的顏色不同）、議題名是襯線字、照片方角、字沒有被切掉（#65）；#65 之後 `tools/compact29.mjs` 的議題圖改量頭條照片是方角（原本量圓形）。`node tools/gamepage66.mjs <base url>`（要本機的 dev server），量重排後的遊戲頁（設計甲「疊層收緊」）：手機 390×664 與桌面 1280×800 整頁不捲動、地圖整張在畫面上（手機 ≥ 290×400、桌面 ≥ 640 寬）、沒有「剛剛」、區域清單、方塊圖例與「第 n/4 次出牌」、上方有紀錄按鈕、手機候選人與頭條各 ≤ 60px、手牌放下時一張牌露出 30–60%、真的點一張牌會升起並把它的打法按鈕放在畫面裡、按返回再放下、點紀錄會在畫面裡打開再點關上、對手放過方塊的縣市上有 chip 而且離該縣市框 40px 內、桌面候選人在地圖左邊（#66）；#66 之後 `compact29` 沒有「剛剛」可量就直接過、`polish30` 的決策按鈕也到 `[data-sheet]` 裡找。#89 之後 `gamepage66` 新手那一輪的預設種子是 12：開局就是一張要處理的表（對手的 CP 觸發了你的牌），量有表時手機英文的浮標不蓋縣市；它的手機地圖只比 290 多 1 px，`P2000_SEED_B=10` 是開在要選牌的那一局。UX 巡檢（2026-10-17）之後的四支都要本機的 dev server，而且在 node 裡用這棵樹自己的規則算出局面、放進頁面的 sessionStorage 再打開（不用隨機玩整局，各約 1–3 分鐘）：`node tools/countystage68.mjs <base url>`，量縣市階段：亮起的縣市框中心在畫面上而且沒被蓋、橫條裡的字沒被切也不捲動、「結束行動」不比縣市 chip 大 1.5 倍以上、真的點 chip 會打開那個縣市框（#68）；`node tools/labels69.mjs <base url>`，量背書圖例與議題總數不蓋縣市、手機候選人條點別處會收、悔一步的按鈕沒被橫條或托盤蓋住（#69）；`node tools/auto70.mjs <base url>`，量只有一個選項時頁面 2.5 秒內自己做掉並留一張「只有一個選項，自動做了」的紙條、之後按悔一步回到自己出手之前而不會再自動做一次，以及地圖下緣的浮標（紙條、對手的那一行、議題總數）中英文都只露整行、彼此不重疊（#70，第三版之後加）；`node tools/headleft71.mjs <base url>`，量桌機（1280×800、1440×900）頭條在候選人那一欄、候選人下面、一條接一條、整條在畫面上沒被蓋、地圖在右邊而且頂端貼齊候選人（#71）；#71 上線之後（e47ce84）`issuehl65` 的桌機 1280×800 只接受左欄直排。`node tools/marks72.mjs <base url>`（同樣放局面進頁面），量地圖上每個動作的記號：每個縣市 chip 裡至少一個記號、在地圖框裡而且離縣市框 40px 內、字沒被切、記號的數目等於紀錄裡對手與自己的縣市動作、沒過的檢定寫「✗」、chip 不壓到別的縣市框、記號不被地圖下緣的浮標（對手那行說明、議題總數）蓋住（#72）。`node tools/feeddock74.mjs <base url>`（同樣放局面進頁面），量桌機（1280×800、1440×900、1100×720、1366×657 中文，1280×800 英文）紀錄沒點就開在地圖右邊、不壓到上方一列／候選人／頭條／地圖／手牌、地圖不比 #74 之前小、至少三行與最新一行在視野裡沒被蓋、對手動時還開著、抬起手牌時不壓到面板而且面板按鈕按得到、開著時按鈕不顯示新行數、紀錄裡不被切（「剛剛」整塊放得下、清單至少兩整行）、收起後保持收起、手機不變（#74）；#82 之後每一下都等交棒卡不在再按，另有一列在對手重播中點兩下：先關、再開；#74 之後 `gamepage66` 的桌機也接受「一開始就開著，第一下關、第二下開」。`node tools/handoff73.mjs <base url>`（同樣放局面進頁面，約 3 分鐘），量輪到誰：每次換人（含頁面打開時輪到對手）那一位動之前交棒卡 `[data-handoff]` 就在畫面上、卡在時對手不動、停 0.5–3 秒自己收、整張在畫面上而且中心在地圖上、不跟回合開場卡或重播同時出現、點一下 0.4 秒內收而且不算跳過、有單一的人時只有他的板亮（標在畫面上、不透明度 ≥ 0.95）另兩張變淡（≤ 0.7）、教學不跳卡（#73）。`node tools/balance75.mjs`（不用瀏覽器，約 6 分鐘），沒有動能的四種設定各 600 局：A 現在的遊戲跟 #75 之前一模一樣、B（none + always）與 C（none + never）整局動能為 0、不問觸發、投票日機率不含動能、B 與 D（always）對手的事件當 CP 打出一定替牌主觸發、C 沒有人觸發；四種的勝率只印不算（#75）。`node tools/balance77.mjs`（不用瀏覽器，約 12 分鐘），沒有動能的草案加四張士氣牌（moraleCards）與起始士氣調整：B 等於 #75 量到的、E–H 走完並帶著 moraleCards、四張牌每次打出或被觸發士氣都加給對的人；勝率只印不算（#77）。`node tools/balance79.mjs`（約 10 分鐘），每張牌上的動能都改成士氣（moraleCards "full"）：B 等於 #75、P–R 走完並帶著 "full"、表上 27 張牌每次打出或被觸發士氣都照表變動；勝率與 owner 的目標 39/35/25 只印不算（#79）；#80 之後儀器的表是 V10（owner 回「Yes」），另加兩列：引擎的 MORALE_FULL 等於 V10 減掉牌上原本的士氣（27 張都在）、600 局時 P 等於 orchestrator 量到的 V10（win 40.3/32.3/27.3, margin 3.96）；「照表變動」那一列另要 20 張以上在士氣不碰 20 與 80 時看到，只在 20 或 80 看到的牌點名（黨員大會打出時連都在 60–80，+20 與 +30 都停在 80，看不出差別）。`node tools/balance83.mjs [每座位局數=300]`（約 15 分鐘），新手難度（level 0）：bots 匯出 BOT_LEVELS 含 0、新手代理（一半照 L1、一半隨機合法動作）對兩位 level 0 在陳、宋、連每一座都 30–50%、L1 對兩位 level 0 合計 ≥ 50%、L1×3／L2×3／L3×3 跟 #83 之前一字不差；level 0 拿到 `{ humans }`（人坐哪）（#83）。`node tools/novice87.mjs <base url>`（要本機、這棵樹的 dev server，約 6 分鐘），新手接到玩家手上：真的單人局裡新手代理對 level 0 每座 25–55%（電腦要拿到 `{ humans }`）、第一次來 ?play 四級有字且新手亮著、選了總幹事重新整理還記得（#87）。`node tools/load88.mjs <base url>`（要本機、這棵樹的 dev server，約 2 分鐘），手機載入與 iOS 15：Slow 4G＋CPU 4× 下字型 ≤ 600 KB、首頁與牌桌 FCP ≤ 2.0 s、牌桌畫好 ≤ 3.0 s、index.html 內嵌非白背景、打開 ?play／?room 不閃首頁、art 與自架字型 max-age ≥ 1 天、第一個牌桌的圖不大於畫出來的 2.5 倍、以 Safari 15.0／15.4 的解析方式手機牌桌不捲動、有手牌在畫面裡、地圖不壓頭條（#88）。`node tools/count93.mjs <base url>`（要本機、這棵樹的伺服器；單人頁用靜態的 `py -3 tools/serve.py <port> <這棵樹>` 就夠，base 是 `http://127.0.0.1:<port>/public/`；約 3 分鐘），開票夜：在頁面上下完的那一局先播「選戰新聞台」的開場、棄保與背書、24 縣照棋盤順序逐一開出（累計票數、地圖領先者顏色、反超）、快訊，再到結局頁；不點也會開始、跳到結果、換速度、手機與桌機版面、英文沒有中文、打開已結束的局直接是結局頁並能重看（#93）。`node tools/endpage94.mjs <base url>`（同樣可用靜態伺服器，約 1 分鐘），結局頁在瀏覽器裡：本機戰績每局只算一次、重新整理不重算、連續落選；「下一個挑戰」直接開新局（換人、升一級、同一位再戰、開軍師）；分享的文字與網址；第一個畫面有報頭、標題、三列得票（#94；頁上寫什麼在 `tests/endpage94.test.js`）。`node tools/tips96.mjs <base url>`（靜態伺服器即可，約 1 分鐘），第一局的「第一次遇到」框：在畫面上、兩顆按鈕按得到、「知道了」收起後決定的按鈕按得到而且重新整理不再出現、「不再提示」之後都不出框（#96；哪一框、寫什麼在 `tests/tips96.test.js`）。`node tools/room99.mjs <base url>`（要本機、這棵樹的 `wrangler dev`，房間是 Durable Object；約 2 分鐘），房間的座位：token 也存在 localStorage（24 小時）、同一個瀏覽器開第二個分頁直接坐回同一席而第一個分頁顯示「在另一個分頁」不再重連（20 秒、喚醒與上線都不連）、按「在這裡繼續」拿回座位而且不來回、超過 24 小時的不用、沒有 sessionStorage 的新分頁坐得回去、離開房間就刪（#99；上線之後少了就是失敗）。`node tools/tap100.mjs <base url>`（要本機、這棵樹的 `wrangler dev`，它開二到四間房間；約 3–10 分鐘），點擊與打開的牌（#100）：「選行動」那一步真的點開一張手牌之後，原本按得到的決定按鈕都還按得到；在放大的牌上同一點快點兩下、牌底下是出牌按鈕，第二下不會做那一步（#47 那一邊，房間 390 寬）；對手的牌還在重播時點手牌、約 220 ms 後點它的出牌按鈕，單人的牌打出去、房間送出一次。不在畫面上的那一半在 `tests/sheet100.test.js`：不是出牌的決定，打開一張手牌時 `Solo.screen` 照樣畫出每一顆決定按鈕（8 局、中英，約 470 個畫面）。`node tools/room101.mjs <base url>`（要本機、這棵樹的 `wrangler dev`；約 2 分鐘），每個位址的限制（#101）：同一個位址猜錯 20 次之後沒帶 token 的加入一律 `rate_limited`（房間存不存在都一樣）、帶著自己座位的 token 照常坐回去、10 分鐘開 30 間房、一條連線 10 秒 30 則、IPv6 以 /64 為一組（同一個 /64 的另一台也被擋）、房間頁被擋就寫出那句話而且不再重連。它的每個情境用自己的 /64 文件用位址（`CF-Connecting-IP: 2001:db8:…`，wrangler dev 會照傳），不會鎖住 127.0.0.1；但 #101 上線之後，其他儀器在 dev 裡都是從 127.0.0.1 開房，一個 wrangler dev 10 分鐘內開超過 30 間會被擋：長時間連跑很多支房間儀器時，換一個新的 `--persist-to` 重開 wrangler dev。名字、聊天與 `src/limits.js` 在 `tests/room101.test.js`。`node tools/head104.mjs <base url>`（要這棵樹的 `wrangler dev`：Worker 送頁面與 sitemap；不用瀏覽器，幾秒），搜尋與分享看到的 head（#104，沒有跑任何 script）：中英首頁與規則頁的 lang、標題、描述、canonical（?play、?tutorial、?room= 指回所屬的頁）、hreflang、OG 與 Twitter 卡、分享圖真的是 1200×630、首頁的 JSON-LD、sitemap 四個網址，以及 noindex 照舊在（owner 說 go 才拿掉）。`node tools/icons102.mjs <base url>`（要這棵樹的 `wrangler dev`：404 是資產處理的；不用瀏覽器，幾秒），分享圖與圖示（#102）：`art/share-zh.png`、`art/share-en.png` 1200×630 而且 ≤ 400 KB、favicon.ico（含 16 與 32）、apple-touch-icon 180、icon-192、icon-512、首頁與規則頁連到它們，以及不存在的路徑回 404 的 HTML 頁（中英遊戲名、回首頁、noindex）；圖好不好看是 orchestrator 用眼睛看。`node tools/credit103.mjs <base url>`（要 Chrome 與這棵樹的 `wrangler dev`，它開一間房間；約 1 分鐘），credit 與揭露（#103）：首頁、規則、結局頁（中英）與單人、教學、房間打開選單之後，畫面上看得到寫明 AI（Qwen-Image、非商業授權）的 credit 和隱私權政策的連結、舊的「自創名稱與美術」不見了、規則頁的 HTML 不跑 script 就有中文 credit、README 照實寫；「看得到」用 innerText（被藏起來的子元素的字不算在看得到的父元素裡）。`node tools/url105.mjs <base url>`（要 Chrome 與這棵樹的 `wrangler dev`；兩個瀏覽器設定檔扮兩個玩家，約 1 分鐘），房間連線的網址（#105）：開房、加入、重新整理坐回去，每一條 WebSocket 的網址都不帶 `name`、`token`，也不帶打進去的名字；照樣能玩（兩邊座位上都看得到兩個名字，重新整理後新開的連線坐回同一席）；連上之後一直不送第一則訊息的連線 15 秒內被關掉。#105 起 `room101` 也用第一則訊息送名字與 token。`node tools/handbg106.mjs <base url>`（靜態伺服器即可，base 是 `http://127.0.0.1:<port>/public/`；約 20 秒），桌機的手牌（#106）：1100×720、1280×800、1440×900 手牌那一條沒有底色、底圖與上緣的線，牌照舊在畫面上，「手牌 N」與「規則」照舊有自己的深色底；手機 390×844 的深色底照舊。`tests/lineends.test.js`：public/、tests/、tools/ 的文字檔只准 LF（#70 第四版把 table.js 變成 CRLF 之後加；畫師的 prompts.json 是已知例外）。peer 可以跑、不編輯。

慣例:驗證用的工作樹在 `../_wt/`;peer(子 agent)的工作樹由 Claude Code 開在 `.claude/worktrees/<name>/`,
cwd 就是它。每個 `_wt/` 工作樹有 `__MARKER_ORCH.txt`(name + SHA);harness 是 `npm test`(`node --test`,
`tests/acceptance.test.js` 三態),平衡用 `node tests/sim.js`(M2 起)。
`.gitignore` 加 `__MARKER_ORCH.txt`、`__orch_*` 與 `.claude/worktrees/`。建議 alias:`alias orch='bash tools/orch.sh'`。
⚠ `orch rm` 之前先離開那個目錄——cwd 在裡面時 Windows 刪不掉。

## 預算

- **一張 issue 一個 session**,land 即結束。子 agent + 自己的 worktree 是預設;常駐 session 是例外(人要中途看才開)。
- **任何 session 的 cwd 都不可以是主 checkout。** 常駐 session 在主 checkout 裡跑 `git checkout <tree> -- .` 之類的動作,會把 owner 的工作樹改成別的樣子,而 owner 不會收到任何通知。每個 session 開在自己的 `_wt/<name>`。
- orchestrator **讀判決不讀全文**:`npm test > log; echo $?`,只取 通過/失敗/尚未實作 的數字;peer 的 transcript 不進 orchestrator 的 context。
- 原始輸出先落檔,再取你要的那一行;`cmd > log; echo $?`,不要 pipe 到 tail。
- 驗收條件:**一個冷 session 能不能只靠 issue 留言 + SHA 接手?** 不能就是交付格式漏了東西。
