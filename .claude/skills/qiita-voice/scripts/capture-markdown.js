// Markdownのファイル（ツールの出力サンプル等）をGitHubのMarkdownと同じスタイルで描画し、記事用のキャプチャを撮る。
// Mermaidのコードブロックも図として描画する。手順は references/captures.md を参照。
//
// 使い方: node capture-markdown.js <Markdownのあるディレクトリ> <出力先ディレクトリ> <撮影の指定（JSON）>
//
// 撮影の指定は、次の形の配列:
//   [{ "out": "01_readme.png", "file": "README.md", "width": 1400,
//      "from": "見出し", "to": "見出し", "toInclusive": false }]
//   - file: 撮るMarkdownのファイル（第1引数からの相対パス）
//   - from / to: 撮る範囲をh1・h2の見出しの文字列で指定する。fromの見出しから、toの見出しの手前まで。
//     省略すると先頭から／末尾まで。toInclusive が true なら、toの見出しのセクションまで含める
//   - width: 本文の横幅（px。既定980）。列の多い表がはみ出す場合は1400等に広げる
// Chromiumの場所は環境変数 CHROMIUM_PATH で指定する（既定はplaywright-coreが探す場所）。
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const { chromium } = require('playwright-core');

const [srcDir, outDir, shotsJson] = process.argv.slice(2);
if (!srcDir || !outDir || !shotsJson) {
  console.error('使い方: node capture-markdown.js <Markdownのあるディレクトリ> <出力先ディレクトリ> <撮影の指定（JSON）>');
  process.exit(2);
}
const shots = JSON.parse(fs.readFileSync(shotsJson, 'utf8'));
const css = fs.readFileSync(require.resolve('github-markdown-css/github-markdown-light.css'), 'utf8');
const mermaidJs = fs.readFileSync(require.resolve('mermaid/dist/mermaid.min.js'), 'utf8');

function toHtml(markdown, width) {
  const renderer = new marked.Renderer();
  const defaultCode = renderer.code.bind(renderer);
  renderer.code = (token) =>
    token.lang === 'mermaid'
      ? `<pre class="mermaid">${token.text.replace(/</g, '&lt;')}</pre>`
      : defaultCode(token);
  const body = marked.parse(markdown, { gfm: true, breaks: false, renderer });
  // GitHubでは列の多い表は横スクロールになるが、画像に全体が収まるよう、表を本文の幅に収めてセル内で折り返す
  return `<!doctype html><html><head><meta charset="utf-8">
<style>${css}
body { margin: 0; background: #fff; }
.markdown-body table { display: table; width: auto; max-width: 100%; }
.markdown-body td { overflow-wrap: anywhere; }
.markdown-body th { white-space: nowrap; }
.markdown-body { box-sizing: border-box; width: ${width}px; padding: 32px; font-family: -apple-system, "Segoe UI", "Noto Sans CJK JP", "IPAPGothic", "IPAGothic", sans-serif; }
.markdown-body pre.mermaid { background: #fff; text-align: center; }
</style></head>
<body><article class="markdown-body">${body}</article>
<script>${mermaidJs}</script>
<script>mermaid.initialize({ startOnLoad: false, theme: 'default' });
mermaid.run().then(() => { document.body.dataset.ready = '1'; });</script>
</body></html>`;
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const maxWidth = Math.max(980, ...shots.map((shot) => shot.width || 980));
  const page = await browser.newPage({ viewport: { width: maxWidth, height: 800 }, deviceScaleFactor: 2 });
  for (const shot of shots) {
    const markdown = fs.readFileSync(path.join(srcDir, shot.file), 'utf8');
    await page.setContent(toHtml(markdown, shot.width || 980), { waitUntil: 'load' });
    await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 30000 });
    const clip = await page.evaluate(({ from, to, toInclusive }) => {
      const article = document.querySelector('article');
      const box = article.getBoundingClientRect();
      const headings = [...article.querySelectorAll('h1, h2')];
      const find = (text) => {
        const found = headings.find((h) => h.textContent.trim() === text);
        if (!found) throw new Error(`見出しが見つかりません: ${text}`);
        return found;
      };
      const top = from ? find(from).getBoundingClientRect().top - 16 : box.top;
      let bottom = box.bottom;
      if (to) {
        const h = find(to);
        if (toInclusive) {
          const next = headings[headings.indexOf(h) + 1];
          bottom = next ? next.getBoundingClientRect().top - 8 : box.bottom;
        } else {
          bottom = h.getBoundingClientRect().top - 8;
        }
      }
      return { x: box.left, y: top + window.scrollY, width: box.width, height: bottom - top };
    }, shot);
    await page.screenshot({ path: path.join(outDir, shot.out), clip, fullPage: true });
    console.log(shot.out, Math.round(clip.width), 'x', Math.round(clip.height));
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
