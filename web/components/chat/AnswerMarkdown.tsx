"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** remark plugin: turns [1], [2] markers in plain text into `#cite-N`
 * links (outside existing links/code), so the renderer below can make
 * them jump buttons. Model output is prose, so markers only appear
 * where the model cited evidence.
 */
function remarkCiteRefs() {
  const splitText = (value: string) => {
    const parts = value.split(/(\[\d+\])/g);
    if (parts.length < 2) return null;
    return parts.map((p) => {
      const m = p.match(/^\[(\d+)\]$/);
      return m
        ? {
            type: "link",
            url: `#cite-${m[1]}`,
            title: "Jump to cited section",
            children: [{ type: "text", value: p }],
          }
        : { type: "text", value: p };
    });
  };
  const visit = (node: Record<string, unknown>, inSpecial: boolean) => {
    const children = node.children as Record<string, unknown>[] | undefined;
    if (!Array.isArray(children)) return;
    const special =
      inSpecial || node.type === "link" || node.type === "code" || node.type === "inlineCode";
    const out: Record<string, unknown>[] = [];
    for (const child of children) {
      if (!special && child.type === "text" && typeof child.value === "string") {
        const split = splitText(child.value);
        if (split) {
          out.push(...split);
          continue;
        }
      }
      out.push(child);
    }
    node.children = out;
    for (const child of out) visit(child, special);
  };
  return (tree: unknown) => visit(tree as Record<string, unknown>, false);
}

export default function AnswerMarkdown({
  text,
  onCite,
}: {
  text: string;
  onCite: (ref: number) => void;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkCiteRefs]}
      components={{
        p: ({ children }) => <p className="mb-2 leading-relaxed last:mb-0">{children}</p>,
        strong: ({ children }) => (
          <strong className="font-semibold text-stone-100">{children}</strong>
        ),
        ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
        ol: ({ children }) => (
          <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
        ),
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        h1: ({ children }) => <p className="mb-2 font-display text-lg text-stone-100">{children}</p>,
        h2: ({ children }) => <p className="mb-1 font-semibold text-stone-100">{children}</p>,
        h3: ({ children }) => <p className="mb-1 font-semibold text-stone-100">{children}</p>,
        blockquote: ({ children }) => (
          <blockquote className="mb-2 border-l-2 border-gold/60 pl-2.5 text-stone-300 last:mb-0">
            {children}
          </blockquote>
        ),
        code: ({ children }) => (
          <code className="rounded bg-stone-800 px-1 py-0.5 text-[13px] text-stone-200">
            {children}
          </code>
        ),
        a: ({ href, title, children }) => {
          const m = typeof href === "string" && href.match(/^#cite-(\d+)$/);
          if (m) {
            const ref = Number(m[1]);
            return (
              <button
                onClick={() => onCite(ref)}
                title={title ?? undefined}
                className="font-semibold text-gold-light underline-offset-2 hover:text-gold hover:underline"
              >
                {children}
              </button>
            );
          }
          return (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-gold-light underline underline-offset-2 hover:text-gold"
            >
              {children}
            </a>
          );
        },
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
