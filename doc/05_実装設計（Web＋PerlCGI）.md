# 探索ゲーム（探索アルゴリズム体験教材）— 実装設計（Web＋PerlCGI）（ラウンド1〜4）

## ディレクトリ構成（案）
/algorithm/
  index.html
  styles.css
  main.js
  roster.js
  log_result.pl
  get_ranking.pl
  search_game_results.tsv  （ログ：CGIと同一フォルダ）
  student.csv           （全ユーザ名簿：クライアント側の抽出に利用）
  /proto/               （旧プロトタイプ、必要なら残す）

※本番配置では /cgi-bin/ や /logs/ に分離する想定（学校サーバの配置ルールに合わせて調整）

---

## Web側の実装方針（送信方式、エラー表示、再送）
### 名簿データの読み込み
- roster.js が student.csv を読み込み、RosterStore として提供する
- main.js は RosterStore から user_id を照合し、タイトル画面・ラウンド開始演出・結果画面を制御しながらラウンド別の名簿を生成する
- student.csv を編集すれば全ラウンドの名簿が更新される

### 送信方式
- クリア時に fetch(POST) でPerl CGIに送信
- Content-Type：application/x-www-form-urlencoded（CGI側で扱いやすい）
- 文字コード：UTF-8

送信項目（最小）：
- user_id
- round_no
- search_count
- clear_time_ms

### エラー表示
- 送信失敗：画面に「送信失敗（ランキングは表示されない可能性）」を表示
- ランキング失敗：領域に「取得失敗（再試行中）」を表示し、一定間隔で再試行

### 冪等性（将来）
- クリア送信は二重送信を避けたい  
  → client側で「送信済みフラグ」を立て、二度送らない（推奨）

---

## Perl CGIの受信仕様（エンドポイント定義、params、戻り、エラー）
## 1) 結果ログ受信：log_result.pl
- Endpoint：/log_result.pl
- Method：POST
- Params（必須）：
  - user_id（文字列）
  - round_no（整数）
  - search_count（整数）
  - clear_time_ms（整数）
- Params（任意）：なし

- Response（JSON推奨）：
  - 成功：{"ok":1}
  - 失敗：{"ok":0,"error":"..."}  ※errorは短文

## 2) ランキング取得：get_ranking.pl
- Endpoint：/get_ranking.pl
- Method：GET
- Params（必須）：
  - user_id
  - round_no
- Response（JSON）：
  - {"ok":1,"ranking":[{...},{...},...],"count":n}
  - rankingは全員分を返す（上位10に限定しない）
  - countは総件数
  ranking要素例：
  - rank（1..）
  - display_name（例：17 小林 裕司 など）
  - display_nameは「番＋氏名（フルネーム）」
  - search_count
  - clear_time_ms
  - user_id（ハイライト用に返す場合）
  - ランキング算出：同一クラス内で user_id ごとの最良記録（タイム→探索回数）を昇順に並べる

---

## ログ受信→検証→保存の流れ（UTF-8/JST/入力検証/冪等性）
1. 受信（POST/GET）
2. 入力検証
   - user_id：空欄不可、長さ上限
   - round_no：1〜4の範囲
   - search_count：1以上
   - clear_time_ms：0以上
3. user_idから名簿対応表（同階層 `student.csv` を優先し、必要なら `../student.csv`）を引き、年組番氏名を取得
   - 見つからない場合：display_nameをuser_idにする等（運用で決める、未確定）
4. JSTの受信日時を生成
5. TSV行として追記保存
6. JSONで応答

---

## 例外処理・障害時方針（取りこぼし/再送）
- ログファイルが書けない：{"ok":0,"error":"server_write_failed"} を返す
- 入力不正：{"ok":0,"error":"invalid_params"} を返す
- クライアントは失敗時に画面表示し、可能なら再送（推奨）

---

## 未確定事項リスト（初版）
- 名簿対応表の形式（CSV列、キー、配置場所）
- 同一人物の複数記録（やり直し）をどう扱うか（最新のみ？全件？）
- ランキング計算時の対象（同一ラウンド・同一クラス・同一期間）
- CGIの返却JSONに含めるdisplay_nameの匿名化レベル（本番運用時に検討）
