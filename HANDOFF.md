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
