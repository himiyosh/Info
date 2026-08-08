# 独立レビュー依頼 — PR #88

このファイルは、実装セッションとは**別の** Claude Code セッションでレビューを
行うための依頼文です。新しいセッションを開き、次をそのまま貼り付けてください。

---

REVIEW-REQUEST.md を読み、PR #88(himiyosh/Info、prototype-structure → main)の
独立レビューを実施してください。あなたは実装者ではなく独立レビュアーです。

手順:

1. `git fetch origin && git switch prototype-structure` で対象ブランチへ。
2. 差分の全体像: `git diff origin/main...HEAD --stat`
3. 重点的に検証すること(コミットメッセージは著者の主張であり証拠ではない):
   - **テスト改変の妥当性**。この変更は品質契約を大規模に書き換えている
     (8ファイル削除、多数の本体書き換え、バイト/SHA ピン再導出)。
     削除・緩和が「対象機能の削除に対応する正当なもの」か、
     「不都合な検査を黙らせるもの」かを、削除された機能
     (share/ ページ、固定リンク、根拠引用、no-JS 一覧、印刷)と
     突き合わせて判定する。
   - **ジェネレーターの検証強度**。旧 script.js のランタイム検証
     (重複リンク、proof の不変 blob 文法、資産一意性)が
     scripts/generate-static-pages.mjs に移植されたという主張を、
     破壊フィクスチャを自分で流して確認する。
   - **テスト実行**はファイル単位で:
     `for f in tests/quality/*.test.mjs; do node --test "$f"; done`
     (単発 `npm test` はこのマシンでは完走しない)
   - **実機確認**: `python3 -m http.server 8010` で
     / と /en/ と /preview-site/ を見比べ、構成一致・テーマ3種・
     長押しの暁・JS無効時の全件表示を確認する。
4. 判定できたら、PR #88 に次の形式のコメントを投稿する
   (head SHA は `gh pr view 88 --json headRefOid` で取得、
   by= には**このレビューセッション自身の UUID**(小文字フル)を入れる):

   合格の場合、コメント本文に次の1行(前後に説明文可、同一行への付加は不可):

   independent-review head=<40桁のhead SHA> verdict=pass by=<セッションUUID>

   問題を見つけた場合は verdict=fail で同形式。理由は別の行に書く。

5. 投稿直前に headRefOid を再取得し、ピン留めした SHA と一致することを
   確認してから投稿する(変わっていたら再レビュー)。
