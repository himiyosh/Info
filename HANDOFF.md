# HANDOFF — 夜藍×白妙リデザイン統合(claude.ai チャットからの引継ぎ書)

作成: 2026-08-07 / 引継ぎ元: claude.ai チャットセッション
最初の指示例: 「この HANDOFF.md を読んで、develop ブランチで作業を開始して」

## ゴール
himiyosh/Info のサイトを「夜藍×白妙」リデザインへ統合する。
**main には触れない。作業はすべて develop ブランチで行う。**

## チャット側で完了済みの成果
- デザインコンセプト「夜藍とデコード」
  - 配色: 夜藍(ダーク/既定)×山吹、白妙(ライト)×瑠璃。OS配色に自動追従+ヘッダートグル
  - フォント: Zen Maru Gothic(見出し900)/ M PLUS Rounded 1c(本文500)/ IBM Plex Mono
  - 演出: 見出しデコード、等高線背景、Network+オマージュのパネル型リスト、View Transitions
- 実装済み機能: 画像プレースホルダー(頭文字フォールバック)/ メールコピー+トースト /
  スクロールスパイ / OGP・JSON-LD・SVGファビコン / 隠しテーマ「暁」(トグル3秒長押し)
- 検証済み: 全テーマ WCAG AA コントラスト / prefers-reduced-motion / インラインJS構文

## 同梱物
- `preview-site/` … 完成プロトタイプ(index.html, favicon.svg, assets/OG画像)
- `integration/production-notes.md` … **統合手順の正。必ず最初に読むこと**
- `integration/himiyosh-theme.spec.js` … Playwright回帰テスト(参考実装)

## 作業手順
1. `integration/production-notes.md` を読む
2. `git switch -c develop` を作成し、本パッケージ一式をコミット
3. 統合順序: tokens.css へトークン移植 → templates/index.html へ構造移植 →
   i18n.js に EN コピー追加(未作成・要翻訳) → フォントのサブセット同梱 →
   artifact whitelist 更新 → `npm run generate:pages` → `npm run check:generated` → `npm test`
4. ローカル確認: `python3 -m http.server 8000`

## リポジトリの掟(遵守)
- 生成ページの直接編集禁止(templates/ が正)
- main へのデプロイは PR + 独立レビュー経由のみ(pages.yml が main push で発火)
- エージェント運用ポリシーは既存 `.github/agents/InfoAgent.agent.md` に従う
  (恒久ルールを Claude Code に常時読ませたい場合はリポジトリ直下 CLAUDE.md へ転記)

## 未決事項
- EN 版コピーの翻訳(必要ならチャット側で作成依頼可)
- 各プロジェクトのプレビュー画像を新配色で撮り直すか
- モード選択の永続化(localStorage、言語設定の正規化と同層に実装推奨)

---

## 統合結果(2026-08-07 / develop ブランチ)

上記手順の統合は完了。プロトタイプの単一ファイル構造は本番の
テンプレート+生成+品質契約アーキテクチャに合わせて再配置した。

- **tokens.css** … 夜藍パレットを契約形式(`--color-*: oklch(L% C H)`)で
  正とした。白妙・暁は品質テストの OKLCH パーサー(tokens.css のみを読む)
  を汚染しないよう **modern.css 末尾のテーマ層**に配置し、`html[data-theme]`
  と `prefers-color-scheme` で同じスロットを上書きする。3テーマ×主要ペアは
  テストと同一の WCAG 数式で検証済み。白妙では `--color-on-dark`=墨、
  `--color-accent-2`=明るい藍鼠の塗りとして役割を再解釈している。
- **構造移植** … トグル(nav 末尾・44px・hidden→JS 表示)、head の
  テーマ復元スクリプト(js-enabled とは別 `<script>`)、viewport-stage 内の
  等高線 SVG、`data-decode` 見出し、`#theme-status` トースト、CSS 疑似要素の
  ワードマークキャレット(textContent 純度を守るため DOM ではない)。
- **script.js** … テーマ選択ライフサイクル(OS追従既定/明示 yoruai・
  shirotae・akatsuki を `info-theme` に永続化/View Transitions は
  reduced-motion 時スキップ/theme-color meta 同期)+デコード演出
  (print メディア下は不実行、rAF 停止時のタイマーバックストップ、
  言語切替で安全に取消、Latin は同ケース Latin プールで行数安定)。
- **i18n.js** … `theme.toLight` / `theme.toDark` / `theme.akatsukiUnlocked`
  を ja/en 追加(EN 翻訳済み)。
- **アセット** … favicon.svg 差し替え、portfolio-preview.jpg(960×540)
  差し替えと AVIF 再生成。README のバイト表と
  `tests/quality/project-catalogue.test.mjs` のレビュー済み JPEG 基準値
  (551,363→524,923)を更新。whitelist は変更不要(新規公開ファイルなし)。
- **フォント** … Zen Maru Gothic / M PLUS Rounded 1c / IBM Plex Mono を
  先頭に置いたシステム丸ゴシックフォールバックで実装。**woff2 サブセットの
  同梱は未実施**(フォントバイナリの取得に承認が必要なため)。取得後は
  `assets/fonts/` へ配置し `@font-face` を tokens.css に足すだけでよい。
  Big Shoulders Display の @font-face と同梱ファイルは既存契約のため維持
  (未参照なので配信されない)。プリロードは index/404 から削除済み。

### 忠実度監査の結果(2026-08-08)

`preview-site/index.html` を正として6観点(トークン / 構造 / 文字組 /
実行時挙動 / 部品 / レスポンシブ・a11y・印刷)で実装を突き合わせ、
104件の差分を確認した。うち移植時に生じた不具合と最重要の文字組は修正済み。

修正済み(コミット `b16926b`):
- モバイルメニュー内でトグルが全幅バーになる(グリッド子要素に幅指定が無かった)
- パネルの窓枠ヘッダーが角丸の下に浮く
- ディレクトリの区切り線が二重(行の上罫線 + 前行の下罫線)
- **印刷の退行**。テーマ層が `@media print` より後方にあるため、画面用の
  `clamp()` 見出し・行間1.85・山吹アクセント・`color-scheme: dark` が
  紙面へ流れ込んでいた
- **日本語ルート(既定)だけ CTA がモノ書体を失い、見出しの字間が旧値**。
  `html:lang(ja)` 側の規則が素のクラスセレクタに勝つため
- テーマ通知の live region が `hidden` を出し入れしており、読み上げ前に
  アクセシビリティツリーから外れうる → 既存の contact/share と同じ
  「消してから遅延で入れる」方式へ統一

### 残タスク(次セッション向け、優先度順)

1. **フォントのセルフホスト**(最重要)。Zen Maru Gothic / M PLUS Rounded 1c /
   IBM Plex Mono はトークンで指名しているだけで**一度も配信していない**。
   現状すべてシステム代替。woff2 サブセットを `assets/fonts/` へ置き
   `tokens.css` に `@font-face` を追加し、`templates/index.html` に
   `rel=preload as=font crossorigin` を足す。制約2つ:
   - 外部ホスト禁止(`site-quality.test.mjs:303-306` が
     fonts.googleapis/gstatic を明示的に禁止)
   - 未使用の Big Shoulders `@font-face` と woff2 は**消さない**
     (`site-quality.test.mjs:308-312, 333-336` が実在を要求)
2. **本文スケール**。本文が 1.25rem/400/1.7 に対しプロトタイプは
   0.95–1.05rem/500/1.85。反映後は `print-portfolio.test.mjs:736`
   (`scrollHeight < 7500`)を再確認すること。
3. **見出し文言**。本番は "About / Projects / Contact"、プロトタイプは
   「好奇心を、実用へ。」「小さな不便を、道具に。」「話しましょう。」。
   声色の差として最大。`i18n.js` の ja/en 両方を編集し再生成する
   (静的フォールバックがバイト一致で固定されているため)。
4. **未移植の部品**: STACK/道具箱セクション、About の facts チップ、
   各節の eyebrow、hero 写真の傾き+コーナーティック、SCROLL キュー、
   JST 時計、ホバー追従プレビュー、スタックのモノチップ化。
   いずれも契約上は追加可能。個別の制約は監査ログを参照。
5. 各プロジェクトのプレビュー画像を新配色 UI で撮り直し(任意)
6. `preview-site/` と `integration/` は統合完了後に削除可
7. main への反映は PR + 独立レビュー経由(リポジトリの掟どおり)

### 契約上ブロックされている差分(意図的に未対応)

- **ディレクトリを全幅1カラム×5メタ列にはできない**。67rem 以上で
  3カラムであることが `project-directory.test.mjs` とブラウザ実測
  (`project-directory-browser.test.mjs`)で固定。リンクの子要素も
  ちょうど2つに固定のため、状態ドットと矢印は疑似要素で実装している。
- **キッカーを見出しの上に置けない**。`hero-stage → hero-support` の
  DOM 順が `hero-action-order.test.mjs` で固定(移動は可能だが要検討)。
- **プロトタイプのページ構造そのものの移植は `npm test` と両立しない**。
  本番はプロジェクト9件を `projects.json` から生成し、共有ページ・
  固定リンク・根拠引用・JS 無効フォールバック・印刷版を308件の契約で
  固定している。プロトタイプはこれらを持たない静的3カード+6行構成。

### テスト実行に関する注意

`npm test` の**単発実行はこの環境で完走しない**。「live in one focused
module」系のガードが `tests/quality` 全体を子プロセスで再実行する設計で、
以前は本物の失敗により早期終了していたため速かった。それを修正した結果
入れ子スポーンが本格化し、153件付近で事実上停止する。検証は
ファイル単位のループで行うこと(全51ファイル・308件が通過することを確認済み):

```bash
for f in tests/quality/*.test.mjs; do
  echo "$(basename $f): $(node --test "$f" 2>&1 | grep -E '^# (pass|fail)' | tr '\n' ' ')"
done
```
