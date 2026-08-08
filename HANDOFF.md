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

**完了済み(コミット `839c079`)**

- ~~フォントのセルフホスト~~ → 3書体を woff2 サブセットで同梱済み
  (`assets/fonts/`。サブセット6ファイル計 275KB、維持中の Big Shoulders と
  `OFL.txt` を含めディレクトリ計 316KB)。サブセットはデコード演出の
  スクランブル用文字も含むサイト実使用グリフのみ。出所は
  github.com/google/fonts の OFL 版で、fonttools でサブセット化した以外は
  無改変。`OFL.txt` に4著作権者と出所を記載。本文・見出しは preload。
  **再生成する場合**は scratchpad の手順(pyftsubset + `--text-file`)を
  踏襲し、外部フォントホストの禁止と未使用 Big Shoulders の実在要求は
  `site-quality.test.mjs` が固定しているので消さないこと
  (行番号は変動するため、アサーション文言で参照すること)。
- ~~見出し文言~~ → 「好奇心を、実用へ。」「小さな不便を、道具に。」
  「話しましょう。」+ 英訳に差し替え済み。ナビは Latin のまま。

**構造置換(下記)で解消済み**

- ~~本文スケール~~ → プロトタイプの型スケールを移植済み
  (`--text-base: 1rem`)。追跡先だった `print-portfolio.test.mjs` は
  印刷版ごと削除されたため、再確認先も存在しない。
- ~~小ラベルのモノ化~~ → `.project-link` はページごと消滅。
  `.footer-meta a` / hero figcaption は移植済み。
- ~~未移植の部品~~ → STACK/道具箱・About の facts チップ・各節の
  eyebrow・hero の傾き+コーナーティック・SCROLL キュー・JST 時計は
  すべて実装済み(ホバー追従プレビューのみ未実装で、必要性も低い)。

**残タスク(優先度順)**

1. **ハイライン**。装飾罫線が不透明な `--color-rule` のままで、
   プロトタイプの約10%アルファ線より約16段階濃い。`--color-line` /
   `--color-line-soft` をアルファ付き oklch で追加し、装飾罫線のみ
   差し替える(コントラスト検査の正規表現はアルファ付きを読まないため安全)。
2. 各プロジェクトのプレビュー画像を新配色 UI で撮り直し(任意)
3. `preview-site/` と `integration/` は統合完了後に削除可
4. main への反映は PR + 独立レビュー経由(リポジトリの掟どおり)

### 契約上ブロックされていた差分(構造置換で失効。経緯の記録)

**以下は 2026-08-08 の構造置換ですべて解消済み。当時の判断根拠として残す。**

- ~~ディレクトリを全幅1カラム×5メタ列にはできない~~ → 根拠だった
  `project-directory.test.mjs` / `project-directory-browser.test.mjs` は
  削除。現在はパネル行が全幅5カラムで、`prototype-geometry-browser.test.mjs`
  が実測で固定している。
- ~~キッカーを見出しの上に置けない~~ → `.hero-role` を h1 の直前に配置済み。
- ~~プロトタイプのページ構造そのものの移植は `npm test` と両立しない~~ →
  構造を置き換え、契約群を新構成へ書き換えることで両立させた。

### 構造置換の完了(2026-08-08 / prototype-structure ブランチ)

「デザイン言語の移植」から方針を転換し、**ページ構造そのものを
preview-site/index.html に置き換えた**。ユーザーが機能喪失を承認済み。

- 構成はプロトタイプそのもの: 1画面ヒーロー(キッカー→見出し→リード→CTA、
  傾いた写真+コーナーティック、SCROLL キュー)/ マーキー帯 / sticky About
  + facts / **3枚のカード + 6行の Network+ パネル** / 道具箱 / 中央寄せ
  Contact / 時計フッター。ページ全長は旧 15.2 画面 → 8.6 画面。
- 残した機構は2つだけ: **両言語ルート**(テンプレート+i18n.js から生成)と
  **projects.json 単一ソース**(先頭3件=カード、残り6件=行。並び順が
  編集インターフェース。status は link のホストが github.com かで導出)。
- プロジェクトは実行時 fetch をやめ**ビルド時焼き込み**。JS 無効でも全件
  表示され、fetch は0本(契約で固定)。旧ランタイムの豊富なデータ検証
  (重複リンク・proof の不変 blob 文法・資産一意性など)はジェネレーターへ
  移植済みで、ビルドが不正データを拒否する。
- 削除: 共有ページ18枚(+share.css, templates/share.html)、固定リンク、
  根拠引用の表示(データ契約としては維持)、no-JS フォールバック一覧、
  印刷ポートフォリオ、viewport-stage シーン機構。script.js は 2049→766 行。
- テスト: 8ファイル30テストを削除、名称一意性2テストを救出、残る全契約を
  新構成に書き換え。**44ファイル・271テスト全通過**。バイト/SHA ピンは
  依存順に再導出済み(境界ヘルパー 29,088 バイト)。
- 既知の注意: `.project-link` に等幅書体を当てると Chrome の printToPDF が
  落ちるため screen 限定(印刷契約は削除済みだが記録として残す)。

### 独立レビュー(PR #88, verdict=fail)への対応(2026-08-08)

レビューの不合格理由「旧レイアウト CSS が新構造を破壊」(A 表8宣言)と
付随指摘 C-1/C-2 に対応した。

- **旧構造専用 CSS の全面削除**。A 表の8宣言に加え、残存していた全ブレーク
  ポイントの旧シーン規則(no-JS 用 868 行帯、reduce 用 896 行帯、大画面用
  1120/1152/1322 行帯)と、ページに存在しないセレクターのルール一式
  (`.project-row` 系 / `.project-directory` 系 / `.projects-fallback` 系 /
  viewport-stage / footer-marquee / share 系ほか)を機械的棚卸しで削除。
  styles.css + modern.css から**計 1,400 行超**を除去し、孤児化した
  @keyframes(footer-marquee / project-parallax)も削除した。
- **セレクター分割の副作用を修正**: `:where(...)` 内カンマの分割で括弧が
  壊れ modern.css のパースが 52 ルールで停止していた6箇所を原本準拠で修復
  (styles.css の focus 系 3 箇所 + 見出し `:where` 2 箇所、modern.css 2箇所)。
- **シェルのガター撤去**: プロトタイプの `.container` は
  `width:min(1160px,92vw)` のみでガターは 92vw が担う。`.section-shell` に
  残っていた `--page-gutter` の左右パディングを 0 にし、カラム実測が
  プロトタイプと一致(About 2×548px、コンタクト中央 1160px)。
- **死んだ CSS を要求していた契約を新構成へ移植**(削除ではなく書き換え):
  focus-contrast の3assertion → `.row .type/.stack` の muted、
  `.contact-copy-status` の ink-2、contact の focus 上書きへ。
  site-quality の行契約 → パネル行5カラム+nth-child 並べ替え禁止+
  旧セレクター復活禁止へ。reduced-motion → hero-sticky/CTA/hero-marquee/
  カード・行トランジションの無効化へ。
- **ブラウザ実測契約を新設** `prototype-geometry-browser.test.mjs`(3件):
  実生成ページ+実 CSS を headless Chrome で描画し、ja/en の
  About 2等分カラム・sticky・見出しと本文の非重複・シェル幅≥1100px・
  Projects 見出し帯 ≤400px・行5カラム・コンタクト中央1カラムを実測で固定。
  当初は WCAG 1.4.12(C-2 指摘)もここへ入れたが、後述のとおり
  原理的に落ちないことが判明したため削除し、契約は
  `text-spacing-resilience.test.mjs` が単独で持つ。
- レビューセッション自身の最小修正 `5bb37cd`(8宣言除去+
  composition-layout-ownership.test.mjs による静的所有権契約)を取り込み、
  その上に本対応を積んだ。両者は互換で、所有権契約も通過する。
- テスト: **47ファイル・279テスト全通過**(ピンは repin 収束で再導出、
  site-quality 境界 28,655 バイト)。生成ページに差分なし(CSS のみの修正)。

### 320px の欠落を追加で塞いだ(2026-08-09)

上のガター撤去は、狭い幅で**実際に文字が切れる**退行を持ち込んでいた。
`overflow-x: clip` があるため文書の overflow は常に 0 で、`scrollWidth <=
clientWidth` を見る判定では原理的に検出できない(負のコントロールとして
`.row .name` を 520px に広げても 0 のまま通過することを実測で確認した)。

- **症状**: ja ルート 320px + WCAG 1.4.12 スペーシングで、カード説明文の
  テキスト実体が 3 箇所で 327px / 323px まで描かれ、320px の外側が
  切り落とされていた(Range で文字の描画範囲を測って確認。箱ではなく文字)。
  en は元から健全(最右 304px)。
- **原因**: グリッド項目の既定 `min-width: auto` により `.card` が
  トラック 294px に対して 341px まで広がっていた。加えて 1 件だけ
  `Prompt→Chain→…` の分割不能トークンが単独で溢れていた。
- **対応**: `.card { min-width: 0 }` と `.card .body > p` の
  `overflow-wrap: break-word`。ja の溢れは 3 → 0、最右 327 → 304px。
  デスクトップのカラム実測(About 2×548px 等)は不変。
- **契約**: `text-spacing-resilience.test.mjs` を追加した。
  判定を「テキストを持つ箱がビューポート外に出たか」で行うため、
  `overflow-x: clip` に無効化されない。`prototype-geometry-browser` 側の
  1.4.12 テストはこの clip のため常に通過するので、**両方を残すこと**
  (前者が検出器、後者はデスクトップのジオメトリ固定として有効)。
- 上書き自体が効いていることを computed 値で先に確認してから本判定に入る。
  効いていない状態で緑になるのを防ぐため。

### 事前監査で判明した「落ちないテスト」(2026-08-09)

再レビュー前の自己監査で、**`prototype-geometry-browser.test.mjs` に入れた
WCAG 1.4.12 の 320/768px 契約が原理的に落ちない**ことが判明したため削除した。

- 根拠: `styles.css` の `html { overflow-x: clip }` により
  `documentElement.scrollWidth` は常に `clientWidth` と等しくなる。
  負のコントロール(`.row .name` を 520px、`.card` を 480px に拡張して
  320px ビューポートで描画)を当てても 5 件すべてが通過した。
- 同じ負のコントロールを、並行セッションが追加した
  `text-spacing-resilience.test.mjs`(テキスト Range を測る)に当てると
  正しく fail する。1.4.12 契約はそちらが正本。
- 併せて、デスクトップ実測側に残っていた同種の `scrollWidth <= clientWidth`
  アサーションも削除した(通る/落ちるを区別できないため)。

**教訓**: `overflow: clip` / `hidden` があるページで
`scrollWidth <= clientWidth` を書くと、常に真になる。はみ出しは
要素側の実測(Range / getBoundingClientRect)で測ること。

### テスト実行に関する注意

`npm test` の**単発実行はこの環境で完走しない**。「live in one focused
module」系のガードが `tests/quality` 全体を子プロセスで再実行する設計で、
以前は本物の失敗により早期終了していたため速かった。それを修正した結果
入れ子スポーンが本格化し、153件付近で事実上停止する。検証は
ファイル単位のループで行うこと(全47ファイル・279件が通過することを確認済み):

```bash
for f in tests/quality/*.test.mjs; do
  echo "$(basename $f): $(node --test "$f" 2>&1 | grep -E '^# (pass|fail)' | tr '\n' ' ')"
done
```
