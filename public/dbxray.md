---
title: テーブル定義書・ER図を自動生成して、AIにテーブル構造を答えさせるツール「dbxray」を作ってみた
tags:
  - Java
  - PostgreSQL
  - Oracle
  - MCP
  - 個人開発
private: false
updated_at: ''
id: null
organization_url_name: null
slide: false
ignorePublish: false
posting_campaign_uuid: null
agreed_posting_campaign_term: false
---
## はじめに

テーブル定義書・ER図を自動生成し、AIにテーブル構造を答えさせるツール「dbxray」を作成したので紹介します。

業務であまり詳しくないサブシステムのテーブル構造をキャッチアップするため、過去に作成したテーブル定義書の出力ツールを改良しました。

:::note info
以前[【PostgreSQL】Markdown形式のテーブル定義書を自動生成するツールを作ってみた](https://qiita.com/ebichan_88/items/bc1ad07b6a7fd1479290)で紹介した、テーブル定義書のみを出力するツールの改良版です。
ツールの名前は、exportTableDefinitionからdbxrayに変更しました[^1]。
:::

[^1]: 旧名はテーブル定義書に特化した名前だったため、より汎用的な名前にしたいと考えていました。当初はGitLensにならって「dblens」とする予定でしたが、同名のリポジトリが既に存在しているようだったため、重複しない名前にしました。

例えば、MCPサーバーを登録したClaude Codeには、次の質問ができます。

- 従業員まわりのテーブルを探して
- 監査ログから部署名を出したいけど、どうJOINすればいい？
- employeeテーブルを変更したら、どこに影響する？
- employeeと構造が似たテーブルはある？

## 想定読者

- 巨大なシステムで、テーブル定義書などのドキュメントが整備されていない環境で開発している方
- Claude Code等のAIでコードを書く際に、テーブル構造もAIに参照させたい方

## 前提

:::note info
本記事の内容は、執筆時点の最新版であるv0.4.2に基づいています。
対応DBMSはPostgreSQL 13以上とOracle 12c以上で、動作環境はJava 21です。
なお、配布用のzipにJava実行環境を同梱しているため、Javaのインストールは不要です。
:::

dbxrayは、[ebichan88/dbxray](https://github.com/ebichan88/dbxray)のGitHubリポジトリで公開しています。

本記事の出力例・実行例は、すべてリポジトリに同梱しているサンプルDBから出力したものです。
細かい設定や出力の仕様は、[CLIリファレンス](https://github.com/ebichan88/dbxray/blob/main/docs/usage/cli.md)と[MCPサーバーのドキュメント](https://github.com/ebichan88/dbxray/blob/main/docs/usage/mcp-server.md)をご覧ください。

## 目次 <!-- omit in toc -->

- [dbxrayとは](#dbxrayとは)
- [使い方](#使い方)
- [出力されるドキュメント](#出力されるドキュメント)
  - [README](#readme)
  - [テーブル一覧](#テーブル一覧)
  - [テーブル定義書](#テーブル定義書)
  - [ER図](#er図)
  - [多重度の判定](#多重度の判定)
- [整備されていないDBで使うための機能](#整備されていないdbで使うための機能)
  - [外部キー制約やコメントの代わりに情報を書き足す](#外部キー制約やコメントの代わりに情報を書き足す)
  - [大きなスキーマのER図を分割する](#大きなスキーマのer図を分割する)
  - [業務の単位でテーブルをまとめる](#業務の単位でテーブルをまとめる)
  - [ドキュメントの更新漏れを検知する](#ドキュメントの更新漏れを検知する)
- [MCPサーバーでAIにテーブル構造を答えさせる](#mcpサーバーでaiにテーブル構造を答えさせる)
  - [全体像](#全体像)
  - [設定方法](#設定方法)
  - [AIに質問できること](#aiに質問できること)
  - [構造の似たテーブルを探す仕組み](#構造の似たテーブルを探す仕組み)
  - [ツールの一覧](#ツールの一覧)
- [開発で苦労したこと](#開発で苦労したこと)
- [おわりに](#おわりに)
- [参考サイト](#参考サイト)

## dbxrayとは

dbxrayは、DBに接続し、テーブル一覧・テーブル定義書・ER図などをMarkdown形式で出力するツールです。
あわせて、出力したデータをAIから検索できるようにするMCPサーバーも同梱しています。

出力物は次の通りです。

| 出力物 | 内容 |
|:---|:---|
| README | 出力した全ドキュメントへの索引と、スキーマごとのオブジェクト数の集計 |
| テーブル一覧 | 対象テーブルの一覧と、各テーブル定義書へのリンク |
| テーブル定義書 | カラム・インデックス・制約・外部キー・被参照・トリガーの情報など |
| ER図 | 外部キーの関係を表すMermaid記法の図。テーブル単位とスキーマ単位で出力する |
| 観点ごとのページ | 人事管理などの業務の単位でまとめた、テーブルのER図と一覧 |
| 関数・シーケンス・ユーザー定義型の一覧と個別ページ | 関数・プロシージャの定義本体や、ENUMの値など |
| スナップショット | 上記と同じ情報を、機械可読なJSON Lines形式にしたもの。MCPサーバーの入力になる |

## 使い方

[Releases](https://github.com/ebichan88/dbxray/releases/latest)から、OSに合ったzipをダウンロードして展開します。

展開後、`conf/config.yml`に接続先DBの情報を記載します。

```yaml:conf/config.yml（抜粋）
database:
  driver: org.postgresql.Driver
  url: jdbc:postgresql://localhost:5432/testdb
  username: postgres
```

:::note warn
パスワードは`conf/config.yml`ではなく、環境変数`DBXRAY_DB_PASSWORD`で渡します。
AIエージェント等から読まれる可能性のある設定ファイルに、パスワードを残さないためです。
:::

```bash:実行（Linux／macOS）
export DBXRAY_DB_PASSWORD='パスワード'
./run.sh
```

Windowsの場合は、コマンドプロンプトで`set DBXRAY_DB_PASSWORD=パスワード`を実行した後、`run.bat`を起動します。

処理が完了すると、`output`フォルダ配下に次の構成で出力されます。

```text:出力先の構成（抜粋）
output
├─testdb                          ・・・ Markdownのドキュメント（DBごと）
│  ├─README.md
│  ├─tableList_testdb.md
│  ├─erDiagram_testdb_sample.md
│  ├─viewpoint_testdb_personnel.md
│  └─sample
│     ├─table
│     │  └─employee.md
│     └─function
└─snapshot                        ・・・ スナップショット（MCPサーバーの入力）
   └─testdb
      ├─database.json
      └─sample
         ├─tables.jsonl
         └─functions.jsonl
```

## 出力されるドキュメント

本章では、サンプルDBから出力したドキュメントを紹介します。
出力したMarkdownはGitHub等でそのまま閲覧でき、次のキャプチャもGitHub上の表示です。

出力サンプルの全体は、[サンプルDBのREADME](https://github.com/ebichan88/dbxray/blob/main/docs/sample/postgres/output/testdb/README.md)から参照できます。

### README

DBごとに、出力した全ドキュメントへの索引となるREADMEを出力します。
スキーマごとのオブジェクトの数や、論理名が記述されているテーブル・カラムの数などの集計も載せています。

![READMEの出力例](TODO:キャプチャ1)

### テーブル一覧

対象テーブルの一覧と、各テーブル定義書へのリンクを出力します。

![テーブル一覧の出力例](TODO:キャプチャ2)

### テーブル定義書

テーブルごとに、テーブル情報・カラム情報・インデックス・制約・外部キー・被参照・トリガーなどの情報を出力します。
次のキャプチャは、`employee`テーブルの定義書です。

![テーブル定義書の出力例](TODO:キャプチャ3)

被参照情報には、このテーブルを参照しているテーブルを一覧にしています。
外部キーは参照する側のテーブルにしか定義されないため、参照される側から関連を辿れるようにしています。

![テーブル定義書の外部キー情報・被参照情報](TODO:キャプチャ4)

### ER図

ER図は、GitHub等でそのまま図として表示できるMermaid記法で出力します。
次の図は、`employee`テーブルの定義書に出力したER図です。

```mermaid
erDiagram
    sample_employee["employee（従業員）"]
    sample_department["department"]
    sample_parking_spot["parking_spot"]
    sample_attendance["attendance（勤怠（月次パーティション））"]
    sample_employee_history["employee_history（従業員履歴）"]
    sample_employee_profile["employee_profile"]
    sample_project_assignment["project_assignment"]
    sample_audit_log["audit_log"]
    sample_department ||--o{ sample_employee : "employee_department_id_fkey"
    sample_employee |o--o{ sample_employee : "employee_manager_id_fkey"
    sample_parking_spot |o--o| sample_employee : "employee_parking_spot_id_fkey"
    sample_employee ||--o{ sample_attendance : "attendance_employee_id_fkey"
    sample_employee ||--o{ sample_employee_history : "employee_history_employee_id_fkey"
    sample_employee ||--o| sample_employee_profile : "employee_profile_employee_id_fkey"
    sample_employee ||--o{ sample_project_assignment : "project_assignment_employee_id_fkey"
    sample_employee |o..o{ sample_audit_log : "record_id"
    sample_employee {
        integer employee_id PK "従業員ID"
        character_varying employee_code "従業員コード"
        character_varying employee_name "従業員名"
        integer department_id FK "所属部署ID"
        integer manager_id FK "上長の従業員ID"
        integer parking_spot_id FK "駐車場ID"
        sample_employee_status_enum status "在籍状況"
        numeric salary "給与"
        jsonb profile "プロフィール（JSON）"
        date hired_date "入社日"
        timestamp_without_time_zone updated_at "更新日時"
    }
    sample_department {
        integer department_id PK
    }
    sample_parking_spot {
        integer parking_spot_id PK
    }
    sample_attendance {
        integer employee_id FK
    }
    sample_employee_history {
        integer employee_id FK
    }
    sample_employee_profile {
        integer employee_id PK, FK
    }
    sample_project_assignment {
        integer employee_id PK, FK
    }
    sample_audit_log {
        integer record_id FK
    }
```

自テーブルは全カラムを、周辺のテーブルは図中の関連をつなぐカラムのみを表示します。
周辺のテーブルまで全カラムを表示すると、箱が大きくなりすぎるためです。

ER図は、次の粒度で出力します。

| 出力先 | 内容 |
|:---|:---|
| 各テーブル定義書の「ER図」セクション | 自テーブルと、直接の参照先・参照元のテーブル。描画する段数は1〜3で変更できる |
| スキーマ別ER図 | スキーマ全体のER図 |
| グループ別ER図 | スキーマが大きい場合に、つながったテーブルのまとまりごとに分割したER図 |
| 観点ごとのページ | 後述する観点の、所属テーブル同士のER図 |

### 多重度の判定

関連線の多重度は、参照元テーブルの外部キーのカラムに設定された制約から機械的に判定します。
外部キー自体は関連の有無しか示さないため、カラムの一意性とNOT NULL制約をあわせて判定に使います。

| 外部キーのカラムが一意 | すべてNOT NULL | 多重度 | Mermaidの表記 |
|:---|:---|:---|:---|
| × | ○ | 1対多 | `A \|\|--o{ B` |
| × | × | 0..1対多 | `A \|o--o{ B` |
| ○ | ○ | 1対1 | `A \|\|--o\| B` |
| ○ | × | 0..1対1 | `A \|o--o\| B` |

前述のER図では、次のように判定しています。

- `employee.department_id`: NOT NULLで一意ではない → 1対多
- `employee.manager_id`: NULLを許容し一意ではない → 0..1対多
- `employee.parking_spot_id`: UNIQUEでNULLを許容 → 0..1対1
- `employee_profile.employee_id`: 主キーなので一意かつNOT NULL → 1対1

一意性は、カラム名の一致ではなく**包含関係**で判定します。

```sql:一意性を包含関係で判定する例
-- 外部キーは (a, b) の2カラム
ALTER TABLE child ADD FOREIGN KEY (a, b) REFERENCES parent (a, b);
-- a だけで一意なら、(a, b) の組も一意になるため1対1と判定する
ALTER TABLE child ADD UNIQUE (a);
```

逆に、`UNIQUE (a, b)`があっても、外部キーが`(a)`のみであれば1対1にはなりません。

また、一意制約に加えて`CREATE UNIQUE INDEX`で作成した一意索引も判定に使いますが、PostgreSQLの部分インデックスは対象外としています。

```sql:判定から外す部分インデックスの例
-- 削除されていない行の中での一意性しか保証しないため、多重度の判定には使わない
CREATE UNIQUE INDEX ON child (parent_id) WHERE deleted_at IS NULL;
```

## 整備されていないDBで使うための機能

ここまでの出力例では、外部キー制約やコメントが設定されているテーブルを中心に紹介しました。
ですが、実際の現場のDBでは、外部キー制約やコメントが整備されていなかったり、テーブル数が多すぎてER図を一度に出力しても読めなかったりすることも多いと思います。

dbxrayには、このような環境でも使えるようにするための機能を用意しています。

### 外部キー制約やコメントの代わりに情報を書き足す

サンプルDBでも、`department`テーブルにはコメントを、`audit_log`テーブルには外部キー制約を付けていません。

このようなDBに無い情報は、**サイドカーYAML**に記述して出力にマージできます。

```yaml:annotations.sample.yml（サンプルから抜粋）
tables:
  sample.department:
    description: |
      社内の組織単位を管理するマスタテーブル。
      従業員（employee）は必ずいずれか1つの部署に所属する。
    remarks: 組織改編時はdepartment_codeを変更せず、department_nameのみ更新すること
    columns:
      department_code: 部署コード。他システム連携時のキーとして使用
      department_name: 部署名称

relations:
  - table: sample.audit_log            # 参照元（子）
    columns: [record_id]
    parentTable: sample.employee       # 参照先（親）
    parentColumns: [employee_id]
    cardinality: 0..1対多              # DBに制約が無いので、多重度はここで明示する
```

`tables`に記述した説明・備考は、テーブル定義書のテーブル説明や備考の欄に反映されます。

![サイドカーYAMLの内容を反映したdepartmentのテーブル定義書](TODO:キャプチャ5)

`relations`に記述した関連は、論理リレーションとして扱います。
テーブル定義書では外部キー情報とは別のセクションに載せ、ER図では物理的な外部キーと区別するため**破線**で描画します。
前述の`employee`のER図で、`audit_log`との線が破線になっているのが論理リレーションです。

![audit_logのテーブル定義書の論理リレーション情報](TODO:キャプチャ6)

どこまで情報を補えたかは、READMEの集計で確認できます。

### 大きなスキーマのER図を分割する

テーブル数が多いスキーマでは、全体を1枚のER図に描くと線が入り乱れて読めなくなります。
そこで、1枚に描くテーブル数に上限を設け、上限を超えた場合は次のように出し分けます。

```mermaid
flowchart TD
    A[スキーマ別ER図] --> B{テーブル数が上限以内？}
    B -->|はい| C[1枚に描画する]
    B -->|いいえ| D[つながったテーブルのまとまり<br>＝連結成分を求める]
    D --> E[上限に収まる範囲で<br>小さなまとまりを同じグループにまとめる]
    E --> F{グループが上限以内？}
    F -->|はい| G[グループ別ER図として描画する]
    F -->|いいえ| H[描画を省略して<br>外部キーの一覧表を掲載する]
```

小さなまとまりを同じグループにまとめるのは、1テーブルだけのグループが大量に生成されるのを避けるためです。
まとめたテーブル同士は線でつながらないため、関連を誤読するおそれはありません。

### 業務の単位でテーブルをまとめる

スキーマ単位やつながり単位のER図は機械的な区切りのため、業務の単位でテーブルを把握したい場合には向きません。

そこで、人事管理・受注管理のような業務の単位でテーブルをまとめる**観点**を、サイドカーYAMLで宣言できるようにしています。

```yaml:annotations.sample.yml（サンプルから抜粋）
viewpoints:
  - id: personnel
    name: 人事管理
    description: |
      従業員と、その所属・付帯情報を扱うテーブル群。
      プロジェクトへのアサインは「プロジェクト管理」の観点を参照。
    tables:
      - sample.employee*
      - "!sample.employee_directory_view"
      - sample.department
      - sample.parking_spot
```

観点を宣言すると、観点ごとにER図と所属テーブルの一覧をまとめたページを出力します。

![観点「人事管理」のページ](TODO:キャプチャ7)

### ドキュメントの更新漏れを検知する

ドキュメントを出力しても、DBの変更に追従できなければすぐに古くなってしまいます。

`--check`を付けて実行すると、コミット済みのスナップショットと、現在のDBから生成したスナップショットを比較します。
マイグレーション後のドキュメントの再出力漏れを、CIで検知するための機能です。

内容に差分があるオブジェクトは、次のようにunified diff形式で表示します。

```text:--checkの出力例
Content differs:
 - table sample.employee

--- committed/testdb/sample/tables.jsonl (table sample.employee)
+++ generated/testdb/sample/tables.jsonl (table sample.employee)
@@ -8,6 +8,7 @@
   "columns": [
     {"name":"employee_id","type":"integer","primaryKey":true,"notNull":true}
     {"name":"name","type":"character varying(100)","primaryKey":false,"notNull":true}
+    {"name":"nickname","type":"text","primaryKey":false,"notNull":false}
   ]
   "indexes": [
```

差分がある場合はCIのジョブを失敗させられるため、ドキュメントの更新漏れに気づけます。

## MCPサーバーでAIにテーブル構造を答えさせる

本章では、MCPサーバーについて紹介します。

当初はMCPサーバーを作る予定はありませんでしたが、開発の途中でふと**テーブルの構造をAIが回答できたら面白いのでは**と思い、AIに提案したところ思いのほか話が進みました。
現在は、19個のツールを提供するMCPサーバーになっています。

### 全体像

全体の構成は次の通りです。

```mermaid
flowchart LR
    DB[(DB)] -->|dbxray（CLI）で出力| MD
    DB -->|dbxray（CLI）で出力| SNAP
    subgraph GIT[出力先（Gitで管理）]
        MD[テーブル定義書・ER図<br>（Markdown）]
        SNAP[スナップショット<br>（JSON Lines）]
    end
    MD --> HUMAN[人が読む]
    SNAP -->|起動時に読み込む| MCP[dbxray-mcp<br>（MCPサーバー）]
    AI[Claude Code等] -->|stdioで起動・呼び出し| MCP
```

ポイントは、**MCPサーバーがDBに接続しない**点です。
dbxrayが出力したスナップショットを読み込むだけなので、AIの実行環境にDBの接続情報を置く必要がなく、テーブルの実データがAIに渡ることもありません。

また、人が読むテーブル定義書とAIが参照する情報は、同じ取得結果から出力しているため、両者に食い違いは生じません。

一方で、DBを変更しても、dbxrayを再実行してスナップショットを更新するまで、変更内容はAIから参照できません[^2]。

[^2]: この鮮度の問題には、前述の`--check`をCIで実行し、スナップショットとDBの乖離を検知することで対応する想定です。

### 設定方法

MCPサーバーの本体は、配布用zipに含まれる`mcp/dbxray-mcp.jar`です。
同梱のJava実行環境で動作するため、Claude Codeの場合は次のコマンドで登録できます。

```bash:Claude Codeへの登録（Linux／macOSの例）
claude mcp add dbxray -- /opt/dbxray-linux/runtime/bin/java -jar /opt/dbxray-linux/mcp/dbxray-mcp.jar --snapshot=/work/schema-docs/output/snapshot
```

チームで共有する場合は、アプリのリポジトリに`.mcp.json`をコミットし、環境ごとに異なるパスは環境変数で指定します。

```json:.mcp.json
{
  "mcpServers": {
    "dbxray": {
      "command": "${DBXRAY_HOME}/runtime/bin/java",
      "args": ["-jar", "${DBXRAY_HOME}/mcp/dbxray-mcp.jar", "--snapshot=${SCHEMA_SNAPSHOT_DIR}"]
    }
  }
}
```

### AIに質問できること

ここでは、サンプルDBに対してツールを実行した結果を交えながら、AIに質問できる内容を紹介します。

#### 業務の言葉でテーブルを探す

テーブル名が英語でも、論理名・説明・カラム名を対象に日本語で検索できます。
次は、`search_tables`で「従業員」を検索した結果です。

```json:search_tables（query: 従業員）の結果（一部抜粋）
{
  "total": 3,
  "tables": [
    {
      "name": "employee",
      "logicalName": "従業員",
      "matchedIn": ["logicalName", "column:employee_id", "column:employee_code", "column:employee_name", "column:manager_id"]
    },
    {
      "name": "employee_history",
      "logicalName": "従業員履歴",
      "matchedIn": ["logicalName"]
    },
    {
      "name": "department",
      "description": "社内の組織単位を管理するマスタテーブル。\n従業員（employee）は必ずいずれか1つの部署に所属する。\n",
      "matchedIn": ["description"]
    }
  ]
}
```

`department`テーブルにはDBのコメントがありませんが、サイドカーYAMLで記述した説明に「従業員」が含まれているため、検索結果に含まれています。
人が補った情報も検索対象になるため、情報を補うほどAIがテーブルを探しやすくなります。

カラム名からテーブルを逆引きすることもできます。

![「物理名にidが存在するカラムがどれだけあるか調べてほしい」と聞いた結果](https://github.com/user-attachments/assets/4cb1a424-ec1b-4a2f-9965-1863b39e0a21)

#### JOINの経路を調べる

監査ログの`audit_log`から、変更された従業員の部署名を取得したいケースを考えます。

`audit_log`には外部キー制約がありませんが、サイドカーYAMLで`employee`への論理リレーションを宣言しているため、`find_join_path`でJOINの経路を辿れます。

```json:find_join_path（from: audit_log、to: department）の結果（一部抜粋）
{
  "paths": [
    {
      "tables": ["sample.audit_log", "sample.employee", "sample.department"],
      "joins": [
        {
          "from": "sample.audit_log",
          "fromColumns": ["record_id"],
          "to": "sample.employee",
          "toColumns": ["employee_id"],
          "kind": "logicalRelation",
          "cardinality": "OPTIONAL_ONE_TO_MANY"
        },
        {
          "from": "sample.employee",
          "fromColumns": ["department_id"],
          "to": "sample.department",
          "toColumns": ["department_id"],
          "kind": "foreignKey",
          "cardinality": "ONE_TO_MANY"
        }
      ]
    }
  ]
}
```

結果には、JOINするカラムの組に加えて、外部キーと論理リレーションのどちらによる関連かと、多重度も含まれます。
この結果をもとにSQLを組み立てると、次のようになります。

```sql:返ってきた経路から組み立てたSQLの例
SELECT a.changed_at, a.action, e.employee_name, d.department_name
FROM sample.audit_log a
-- record_idはNULLを許容する0..1対多の関連なので、外部結合にしておく
LEFT JOIN sample.employee e ON e.employee_id = a.record_id
LEFT JOIN sample.department d ON d.department_id = e.department_id;
```

外部キー制約の無いDBでは、AIはカラム名から関連を推測してJOINを書くことになりますが、dbxrayを使えば人が宣言した関連をもとに回答できます。

#### 変更の影響範囲を調べる

`get_impact`を使うと、テーブルを変更・削除した場合の影響範囲を1回の呼び出しで調べられます。
`employee`テーブルの調査結果をまとめると、次の通りです。

| 種類 | 影響を受けるもの |
|:---|:---|
| 外部キーで参照しているテーブル | `attendance`、`employee`の自己参照、`employee_history`、`employee_profile`、`project_assignment` |
| 論理リレーションで参照しているテーブル | `audit_log` |
| 間接的に参照しているテーブル | `attendance_note`。`attendance`を経由する |
| 参照しているビュー | `employee_directory_view`と、それを参照する`attendance_monthly_view` |
| トリガー | `trg_employee_audit`、`trg_employee_set_updated_at` |
| 使っている関数・プロシージャ | `raise_salary`、`close_project`、`department_headcount`など5つ |

関数・プロシージャについては、対象テーブルを登録・参照・更新・削除のどの操作で使っているかを、`operations`にC・R・U・Dで返します。
また、ビューのトリガーから呼び出されて`employee`に登録する関数のように、トリガー経由の利用も`calledByTriggers`で確認できます。

```json:get_impact（table: employee）の結果のうち関数の部分（一部抜粋）
"usages": [
  {
    "function": "sample.raise_salary",
    "kind": "PROCEDURE",
    "overloads": ["IN p_employee_id integer, IN p_amount numeric"],
    "operations": "U"
  },
  {
    "function": "sample.employee_directory_insert",
    "kind": "FUNCTION",
    "overloads": ["()"],
    "operations": "C",
    "calledByTriggers": ["sample.employee_directory_view.trg_employee_directory_insert"]
  }
]
```

関数の利用テーブルは、関数の定義本体から機械的に抽出したもので、`--preview`を付けて実行した場合のみ有効になるプレビュー機能です[^3]。

[^3]: 動的SQLや、呼び出し先の関数内での参照は含みません。こうした取りこぼしの可能性がある関数は、結果の中で別途示します。

#### 構造の似たテーブルを探す

中でも個人的に気に入っているのが、構造の似たテーブルを探す`find_similar_tables`です。
スナップショットのデータをそのまま返すのではなく、類似度の算出などの工夫を加えています。

![「employeeと構造が似たテーブルはある？」と聞いた結果](https://github.com/user-attachments/assets/6847833e-de27-488e-82d5-c9ed226f8eae)

このとき、MCPサーバーはAIに次のJSONを返しています。

```json:find_similar_tables（table: employee）の結果
{
  "base": "sample.employee",
  "total": 1,
  "tables": [
    {
      "database": "testdb",
      "name": "sample.employee_history",
      "logicalName": "従業員履歴",
      "similarity": 77,
      "kind": "superset",
      "sharedColumns": 11,
      "onlyInOther": ["history_id", "valid_from", "valid_to"],
      "typeMismatches": [
        {
          "column": "employee_name",
          "base": "character varying(50)",
          "other": "character varying(100)",
          "difference": "size"
        }
      ],
      "relatedToBase": true
    }
  ]
}
```

`employee`の11カラムをすべて持ち、`history_id`・`valid_from`・`valid_to`が追加されたテーブルとして、履歴テーブルの`employee_history`を検出しています。
さらに、`employee_name`の桁数のみが本体と異なることも分かります。

新しいテーブルを作る前に同じ目的のテーブルが既に存在しないかを確認したり、履歴・バックアップ用のテーブルを見つけたりする用途を想定しています。

#### ER図を取得する

テーブルの周辺や観点単位のER図を、テーブル定義書と同じ表記のMermaid記法で返します。

![「従業員テーブルの周辺のER図を描いて画像で見せて」と聞いた結果](https://github.com/user-attachments/assets/37c34c7e-bb26-49be-841e-96008b282298)

### 構造の似たテーブルを探す仕組み

`find_similar_tables`は、カラム名の集合同士を**重み付きJaccard係数**で比較します。
比較の前に、カラム名の大文字小文字・全角半角を統一します。

```math
\text{類似度} = \frac{\sum_{c \in \text{共通のカラム}} w(c)}{\sum_{c \in \text{両者のカラムの和集合}} w(c)}
,\qquad
w(c) = \ln \frac{N + 1}{\text{そのカラム名を持つテーブルの数}}
```

ここで、$N$ はDBのテーブル数です。

重み $w(c)$ は、そのカラム名を持つテーブルが多いほど小さくなります。
これは、`id`や`created_at`のような多くのテーブルに共通する汎用的なカラムを共有しているだけで、類似と判定しないためです。

```java:SimilarTableFinder.java（一部抜粋）
    double weightOf(String name) {
      return Math.log((tables + 1.0) / Math.max(counts.getOrDefault(name, 0), 1));
    }
```

結果には、類似度に加えて次の情報も含めています。

- `kind`: 相手との関係の種類
  - `identical`はカラムが同じ、`superset`は相手が基準の全カラムを持つ、`subset`は相手が基準の一部だけを持つ、`overlap`はそれ以外
- `typeMismatches`: 同名で型が違うカラム
  - 型そのものが違うのか、桁数だけが違うのかも区別する
- `relatedToBase`: 基準と外部キーで直接つながるテーブルかどうか

外部キーでつながるテーブルを除外せず印を付けるのは、履歴テーブルや拡張テーブルが基準のテーブルを参照していることが多いためです。

なお、類似度はカラム名の構造の近さを示すもので、同じ意味のテーブルとは限りません。
同じ目的のテーブルかどうかは、呼び出したAIが`get_table`で説明や定義を確認して判断する役割分担にしています[^4]。

[^4]: DBのテーブル数が少ない場合、汎用的なカラムの重みが十分に下がらないという制約もあります。

### ツールの一覧

v0.4.2時点で、次の19個のツールを提供しています。

| 目的 | ツール | 内容 |
|:---|:---|:---|
| 全体像をつかむ | `list_schemas` | DB・スキーマと、種類ごとのオブジェクトの数 |
| | `list_viewpoints` | 観点の一覧 |
| | `list_table_clusters` | 関連のつながりから推測した、テーブルのまとまり |
| 探す | `search_tables` | キーワードでテーブルを検索する。論理名・説明・カラム名も対象 |
| | `list_tables` | テーブルの一覧と、それぞれの関連の数 |
| | `find_columns` | カラム名から、そのカラムを持つテーブルを逆引きする |
| | `find_similar_tables` | カラム名の構造が似たテーブルを探す |
| 定義を見る | `get_table` | テーブルとビューの定義 |
| 関連をたどる | `get_related_tables` | 外部キー・論理リレーションでつながるテーブル |
| | `find_join_path` | 2つのテーブルをつなぐ最短のJOIN経路 |
| | `get_er_diagram` | Mermaid記法のER図 |
| 影響を調べる | `get_impact` | テーブルを変更・削除したときの影響範囲 |
| その他 | `list_functions`・`get_function`ほか | 関数・シーケンス・ユーザー定義型・トリガーの一覧と定義 |

ツールのほかに、利用者が`@`でテーブルの定義を会話に添付できるリソースも提供しています。
ターミナル版のClaude Codeでは、入力欄に`@受注明細`のように論理名・物理名を入力すると候補が表示されます。

## 開発で苦労したこと

今回の改修の大部分はClaude Codeで実装しましたが、最も苦労したのは**AIが作成したソースコードの理解**です。

元々は自分が1から作ったツールのため、ソースコードは熟知していたはずですが、いつの間にか乗っ取られた気分でした。

そこで、可読性・責務分割・命名・例外設計・DDDとしての構成など、様々な観点でリファクタリングを依頼しました。
最終的には、ソースコードの読解ガイドをHTMLで作成させたことで、多少は理解しやすくなりました。

読解ガイドは、事前知識・処理の流れ・ソースごとの役割と関係を図でまとめたもので、GitHub Pagesで公開しています。

- [テーブル定義書等を出力するcliの読解ガイド](https://ebichan88.github.io/dbxray/cli-guide.html)
- [MCPサーバーの読解ガイド](https://ebichan88.github.io/dbxray/mcp-server-guide.html)

## おわりに

今回の改修で特にうれしかったのは、ER図とMCPサーバーの機能を追加できたことです。
どちらも、自分が実際に使いたいと思っていた機能でした。

また、機能強化を進める中で、このツールのコンセプトが**現行システムの読み解き**であると明確に言語化できたと感じています。

巨大なシステムで、テーブル定義書などのドキュメントが整備されていない環境で開発している方には、ぜひお勧めします。
少しでも参考になれば幸いです。

## 参考サイト

- [dbxray](https://github.com/ebichan88/dbxray)
- [Model Context Protocol](https://modelcontextprotocol.io/)
