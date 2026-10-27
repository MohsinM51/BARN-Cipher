import type { Mode } from "../lib/timeline.ts";

// The drawing's title block, bottom right of the sheet: what it is, whose
// method it draws, and who drew it.
export function TitleBlock({ mode }: { mode: Mode }) {
  return (
    <footer className="title-block" aria-label="About">
      <div className="tb-title">
        <span className="tb-key">Title</span>
        BARN · Bury Among Random Numbers
      </div>
      <div className="tb-sheet">
        <span className="tb-key">Sheet</span>1 of 1
      </div>
      <div className="tb-method">
        <span className="tb-key">Method</span>
        J. J. Tatarkiewicz &amp; W. B. Kuźmicz,{" "}
        <a href="https://arxiv.org/abs/2404.09288" target="_blank" rel="noreferrer">
          arXiv:2404.09288
        </a>
      </div>
      <div className="tb-drawn">
        <span className="tb-key">Drawn by</span>Mohsin Mohamed
      </div>
      <div className="tb-mode">
        <span className="tb-key">Mode</span>
        {mode === "encrypt" ? "Encrypt" : "Decrypt"}
      </div>
    </footer>
  );
}
