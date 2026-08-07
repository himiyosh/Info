# Production Notes — 夜藍 × 白妙 リデザイン組み込みガイド

プロトタイプ一式を `himiyosh/Info` 本番へ載せる際の実務メモです。

## 納品ファイル
| ファイル | 用途 |
| --- | --- |
| `himiyosh-portfolio-redesign.html` | デザイン本体(単一ファイルプロトタイプ) |
| `favicon.svg` | 新配色ファビコン(夜藍タイル+山吹の稜線) |
| `portfolio-preview-yoruai.jpg` | 新配色 OGP 画像 960×540(Noto Sans CJK Black で生成) |
| `himiyosh-theme.spec.js` | モード切替・a11y・コピー導線の Playwright 回帰テスト |

## 1. フォント最適化(セルフホスト+サブセット)
現行方針どおり `assets/fonts/` へ OFL ライセンスと共に同梱を推奨します。丸ゴシックのフル収録は
Zen Maru Gothic 約 4MB / M PLUS Rounded 1c 約 2MB(ウェイトごと)級のため、サブセット必須です。

```bash
# fonttools でサブセット(例: 使用グリフをサイト全文から抽出)
pip install fonttools brotli
pyftsubset ZenMaruGothic-Black.ttf \
  --text-file=all-site-text.txt \
  --layout-features='*' --flavor=woff2 \
  --output-file=assets/fonts/zen-maru-gothic-900-subset.woff2
# もしくは glyphhanger でクロール抽出
npx glyphhanger http://localhost:8000/ --subset=*.ttf --formats=woff2
```
- 対象: Zen Maru Gothic(500/700/900)、M PLUS Rounded 1c(400/500/700)、IBM Plex Mono(400/500)
- `@font-face` には `font-display: swap` を指定、本文フォントのみ `<link rel="preload">` 推奨
- 目安: 日本語サブセット後は 1 ウェイトあたり 100–300KB 程度に収まります

## 2. OGP・ファビコン差し替え
1. `favicon.svg` をルートの既存ファイルと置換
2. `portfolio-preview-yoruai.jpg` を `assets/portfolio-preview.jpg` として配置(既存パス互換)
3. 既存 README のパイプラインどおり AVIF を再生成:
   ```bash
   sips -s format avif -s formatOptions 70 -z 540 960 assets/portfolio-preview.jpg \
     --out assets/portfolio-preview-960w.avif
   sips -s format avif -s formatOptions 70 -z 405 720 assets/portfolio-preview.jpg \
     --out assets/portfolio-preview-720w.avif
   ```
4. 各プロジェクトのプレビュー画像も、新配色の UI で撮り直すと統一感が出ます

## 3. tokens.css へのマッピング
プロトタイプの `:root` / `html[data-theme="shirotae"]` / `html[data-theme="akatsuki"]` ブロックが
デザイントークンの正であり、そのまま `tokens.css` へ移植できます。主要スロット:

- 面: `--ink-950/900/800/700`(白妙では明色が入る「面」スロット)
- 文字: `--washi`(本文) / `--mist`(補助)
- 強調: `--accent` / `--accent-glow` / `--hover-tint`
- 状態: `--ok` / `--ok-glow`
- 装飾: `--topo` / `--topo-hl`(等高線)、`--glow` / `--contact-glow`、`--card-shadow`
- 面の透過: `--nav-bg` / `--badge-bg`

`templates/index.html` へ構造を移した後は、必ず `npm run generate:pages` →
`npm run check:generated` の順で生成物ドリフトを検査してください(生成ページ直編集は不可)。

## 4. テスト組み込み
- `himiyosh-theme.spec.js` は Playwright 前提の参考実装です(Info 本体は依存フリー方針のため、
  JoJo 系と同じ実行環境か、`test:ui` として別系統スクリプトに置くのが収まりが良いです)
- カバレッジ: OS 配色追従 / トグルと meta 連動 / 暁 3 秒長押し / reduced-motion 即時表示 / コピー導線

## 5. 実装メモ(フォールバック設計)
- **View Transitions**: 非対応ブラウザーと `prefers-reduced-motion` では即時切替に自動フォールバック
- **クリップボード**: `navigator.clipboard` は https / localhost 限定。`file://` では失敗トーストに分岐
- **画像プレースホルダー**: 読み込み前・失敗時にテーマ連動グラデ+頭文字を表示(CLS ゼロ設計)
- **モード永続化**: 未実装(意図的)。本番では言語設定の正規化と同じ層で `localStorage` 保存を推奨
- **暁**: UI 非公開のイースターエッグ。正式採用時はトグルを三択化するだけで昇格できます
