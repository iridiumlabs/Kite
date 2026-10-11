"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import { useEffect } from "react";

export function useComposeEditor(opts: {
  initialHtml?: string;
  placeholder?: string;
  onUpdate?: (html: string, text: string) => void;
  autofocus?: boolean;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        horizontalRule: false,
      }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: opts.placeholder ?? "" }),
    ],
    content: opts.initialHtml ?? "",
    autofocus: opts.autofocus ?? false,
    onUpdate: ({ editor }) => {
      opts.onUpdate?.(editor.getHTML(), editor.getText());
    },
  });
  return editor;
}

export function ComposeEditorArea({ editor }: { editor: Editor | null }) {
  useEffect(() => {
    if (editor) editor.commands.focus("end");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <EditorContent editor={editor} className="min-h-0" />;
}
