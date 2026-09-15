"use client";

import { useState, type ReactNode } from "react";
import { isExternalHttpHost, parseMarkdownBlocks, type MdNode } from "@/lib/markdown/render";
import { ModalSheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

function renderNodes(nodes: MdNode[], onConfirmLink: (href: string) => void): ReactNode {
  return nodes.map((node, index) => {
    const key = `${node.type}:${index}`;
    if (node.type === "text") return <span key={key}>{node.value}</span>;
    if (node.type === "code") {
      return (
        <code key={key} className="rounded bg-muted px-1 font-mono text-sm">
          {node.value}
        </code>
      );
    }
    if (node.type === "bold") return <strong key={key}>{renderNodes(node.children, onConfirmLink)}</strong>;
    if (node.type === "italic") return <em key={key}>{renderNodes(node.children, onConfirmLink)}</em>;
    const href = node.href;
    return (
      <a
        key={key}
        href={href}
        className="underline"
        rel="noopener noreferrer"
        target="_blank"
        onClick={(event) => {
          const host = typeof window !== "undefined" ? window.location.host : "";
          if (isExternalHttpHost(href, host)) {
            event.preventDefault();
            onConfirmLink(href);
          }
        }}
      >
        {renderNodes(node.children, onConfirmLink)}
      </a>
    );
  });
}

export function MessageBody({ text, testId }: { text: string; testId?: string }) {
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const lines = parseMarkdownBlocks(text);
  return (
    <div className="whitespace-pre-wrap break-words" data-testid={testId} data-surface="message-body">
      {lines.map((nodes, line) => (
        <p key={line} className={line > 0 ? "mt-1" : undefined}>
          {renderNodes(nodes, setPendingHref)}
        </p>
      ))}
      <ModalSheet
        open={pendingHref !== null}
        onClose={() => setPendingHref(null)}
        labelledBy="externalLinkConfirmLabel"
        testId="externalLinkConfirm"
        surface="external-link-confirm"
      >
        <p id="externalLinkConfirmLabel" className="text-sm font-medium">
          Open this link?
        </p>
        <p className="mt-2 break-all text-sm text-muted-foreground">{pendingHref}</p>
        <div className="mt-4 flex gap-2">
          <Button
            type="button"
            variant="brand"
            onClick={() => {
              if (pendingHref) window.open(pendingHref, "_blank", "noopener,noreferrer");
              setPendingHref(null);
            }}
          >
            Open
          </Button>
          <Button type="button" variant="outline" onClick={() => setPendingHref(null)}>
            Cancel
          </Button>
        </div>
      </ModalSheet>
    </div>
  );
}
