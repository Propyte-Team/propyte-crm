// ============================================================
// EmailRichText — editor rich text compacto (Tiptap) en estética B/N.
// Toolbar mínima: negrita, itálica, listas, enlace. Emite HTML.
// ============================================================
"use client"

import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Link from "@tiptap/extension-link"
import { Bold, Italic, List, ListOrdered, Link2 } from "lucide-react"

interface EmailRichTextProps {
  value: string
  onChange: (html: string) => void
  placeholder?: string
}

export function EmailRichText({ value, onChange, placeholder }: EmailRichTextProps) {
  const editor = useEditor({
    immediatelyRender: false, // SSR de Next: evita mismatch de hidratación
    extensions: [
      StarterKit.configure({ heading: false }),
      Link.configure({ openOnClick: false, autolink: true }),
    ],
    content: value,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class:
          "min-h-[180px] w-full px-3 py-2 text-[13px] leading-relaxed text-[color:var(--text-primary)] focus:outline-none [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_a]:underline",
      },
    },
  })

  if (!editor) return null

  const btn = (active: boolean) =>
    `flex h-7 w-7 items-center justify-center rounded transition-colors ${
      active
        ? "bg-[color:var(--text-primary)] text-[color:var(--bg-card)]"
        : "text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-subtle,rgba(0,0,0,0.05))]"
    }`

  function addLink() {
    const prev = editor!.getAttributes("link").href as string | undefined
    const url = window.prompt("URL del enlace", prev ?? "https://")
    if (url === null) return
    if (url === "") {
      editor!.chain().focus().extendMarkRange("link").unsetLink().run()
      return
    }
    editor!.chain().focus().extendMarkRange("link").setLink({ href: url }).run()
  }

  return (
    <div className="rounded-md border" style={{ borderColor: "var(--border-default)" }}>
      <div
        className="flex items-center gap-0.5 border-b px-1.5 py-1"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <button type="button" className={btn(editor.isActive("bold"))} onClick={() => editor.chain().focus().toggleBold().run()} title="Negrita">
          <Bold className="h-3.5 w-3.5" />
        </button>
        <button type="button" className={btn(editor.isActive("italic"))} onClick={() => editor.chain().focus().toggleItalic().run()} title="Itálica">
          <Italic className="h-3.5 w-3.5" />
        </button>
        <button type="button" className={btn(editor.isActive("bulletList"))} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Lista">
          <List className="h-3.5 w-3.5" />
        </button>
        <button type="button" className={btn(editor.isActive("orderedList"))} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Lista numerada">
          <ListOrdered className="h-3.5 w-3.5" />
        </button>
        <button type="button" className={btn(editor.isActive("link"))} onClick={addLink} title="Enlace">
          <Link2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <EditorContent editor={editor} data-placeholder={placeholder} />
    </div>
  )
}
