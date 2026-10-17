# captures.md — 記事に載せるキャプチャを用意する

ツール紹介の記事では、出力物・実行結果を**キャプチャで具体的に見せる**と、何ができるかが伝わりやすい。
ここでは、キャプチャの選び方と、Markdownの出力をキャプチャにする手順をまとめる。

---

## 1. 何を撮るか（選び方）

- **リポジトリのサンプルデータの出力を使う。** 実務のデータは載せない。記事中で「サンプルデータから出力したもの」と1文で断る。
- **記事の流れに沿って選ぶ。** 読者が「何が出てくるか」を掴める入口（READMEや一覧）→ 中心の出力（定義書等）→ 読者の疑問に答える機能の出力（DBに無い情報を補った結果等）、の順に1枚ずつ。
- **1枚で1つのことを見せる。** ページ全体ではなく、見せたいセクションの範囲に絞る（見出しで範囲を指定する）。
- **キャプチャにしなくてよいもの。** Mermaidの図（Qiitaが直接描画できるのでコードで載せる）、短いJSON・SQL（コードブロックで載せる）。
- **案を先に本人に見せる。** 「掲載位置・対象ファイル・写す範囲・必須か任意か」の表で提案し、本人の判断を受けてから撮る。

本人が撮った画面（AIとの対話の画面等）がリポジトリのREADMEにあれば、それも候補にする。

---

## 2. Markdownの出力をキャプチャにする手順

GitHub上の表示をそのまま撮りたいが、クラウドの実行環境ではGitHubのCSS等を配信する `github.githubassets.com` と、
Mermaidを描画する `viewscreen.githubusercontent.com` への接続がネットワークポリシーで拒否されることがある（403）。
その場合は、GitHubがMarkdownの表示に使うスタイル（github-markdown-css）とMermaidで手元に描画して撮る。
**記事には「GitHub上の表示」と書かない**（事実と違うため）。

### 準備

スクリプトの依存は、スキルのフォルダではなく作業用のディレクトリに入れる。

```bash
WORK=<作業用のディレクトリ>   # スクラッチパッド等
mkdir -p "$WORK" && cd "$WORK"
npm init -y >/dev/null
npm install --no-audit --no-fund playwright-core@1.56.1 marked@14.1.4 github-markdown-css@5.8.1 mermaid@11.4.1
cp <リポジトリ>/.claude/skills/qiita-voice/scripts/capture-markdown.js .
```

Chromiumがプリインストールされている環境（`/opt/pw-browsers`）では、`CHROMIUM_PATH` にその実行ファイルを指定する。

### 撮影の指定を書く

```json:shots.json（dbxrayの記事で使った指定）
[
  { "out": "01_readme.png", "file": "README.md", "width": 1400 },
  { "out": "02_table_list.png", "file": "tableList_testdb.md" },
  { "out": "03_table_definition.png", "file": "sample/table/employee.md", "to": "インデックス情報", "width": 1400 },
  { "out": "04_foreign_keys.png", "file": "sample/table/employee.md", "from": "外部キー情報", "to": "参照しているビュー", "width": 1400 },
  { "out": "05_sidecar_department.png", "file": "sample/table/department.md", "to": "インデックス情報", "width": 1400 },
  { "out": "06_logical_relation.png", "file": "sample/table/audit_log.md", "from": "論理リレーション情報", "to": "トリガー情報" },
  { "out": "07_viewpoint.png", "file": "viewpoint_testdb_personnel.md", "to": "観点外のテーブルとの関連" }
]
```

### 撮る

```bash
CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
  node capture-markdown.js <Markdownのあるディレクトリ> <出力先ディレクトリ> shots.json
```

撮った画像は必ず目で確認する。よくある崩れと対処：

| 崩れ | 対処 |
| --- | --- |
| 列の多い表の右端が切れる・特定の行が極端に縦長になる | その撮影の `width` を1400等に広げる |
| 見出しのセル（`No.`・`PK`等）が途中で折り返す | スクリプトは見出しのセルを折り返さない設定済み。崩れる場合は `width` を広げる |
| 見出しが見つからないエラー | `from`・`to` はh1・h2の見出しの文字列と完全一致させる |

### 記事への差し込み

1. 記事には `![説明](TODO:01_readme.png)` のように、差し込むファイル名を書いておく。
2. 画像ファイルを本人に送る。本人がQiitaの編集画面でアップロードし、発行されたURLに差し替える。
3. 本人が差し替えてpushした後に記事を直すときは、必ず最新を取り込んでから編集する（画像URLを消さないため）。
