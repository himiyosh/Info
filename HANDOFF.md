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

### 残タスク(次セッション向け)
1. フォント subsetting(fonttools/glyphhanger)と `assets/fonts/` 同梱
2. 各プロジェクトのプレビュー画像を新配色 UI で撮り直し(任意)
3. share/404 ページのテーマ追従(現状は夜藍固定。テーマ層が modern.css に
   あるため、対応するなら読み込み構成の再検討が必要)
4. プレビュー用 `preview-site/` と `integration/` は統合完了後に削除可
5. main への反映は PR + 独立レビュー経由(リポジトリの掟どおり)
