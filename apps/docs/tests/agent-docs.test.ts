import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { AgentLoop, type AgentStreamCallbacks, type AgentTransport } from '@genoffice/agent-core'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { createDocsSkill } from '../src/renderer/ai/docs-skill'
import { buildDocContext, countWords } from '../src/renderer/ai/protocol'
import { executeTool } from '../src/renderer/ai/tools'

/**
 * End-to-end through the local stack: AgentLoop -> docs skill -> tools ->
 * real tiptap editor. The "model" is scripted, so these tests verify that
 * the capabilities behind typical requests (word count, heading colors,
 * rewrite, insert) actually work when the model picks the right tool.
 */

interface JsonNode {
  type: string
  attrs?: Record<string, unknown>
  content?: JsonNode[]
  text?: string
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
}

const text = (t: string): JsonNode => ({ type: 'text', text: t })
const heading = (t: string, level = 1): JsonNode => ({
  type: 'docHeading',
  attrs: { docxIndex: null, level },
  content: [text(t)],
})
const para = (t: string): JsonNode => ({
  type: 'docParagraph',
  attrs: { docxIndex: null },
  content: [text(t)],
})

/** Editors created during the current test; destroyed in afterEach so ProseMirror's
 * DOMObserver timers can't fire after the JSDOM environment is torn down. */
const liveEditors: Editor[] = []

function createEditor(content: JsonNode[]): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: { type: 'doc', content },
  })
  liveEditors.push(editor)
  return editor
}

afterEach(() => {
  for (const editor of liveEditors.splice(0)) editor.destroy()
})

/** 0 h1 | 1 p | 2 h2 | 3 p */
const fixture = () => [
  heading('Chapter 1 Overview', 1),
  para('GenSpark is an AI office suite.'),
  heading('Risk Notes', 2),
  para('This document is for reference only.'),
]

function scriptedTransport(script: Array<(cb: AgentStreamCallbacks) => void>): AgentTransport {
  let turn = 0
  return {
    stream(_request, cb) {
      const step = script[turn++]
      if (step) queueMicrotask(() => step(cb))
      return { cancel: () => queueMicrotask(() => cb.onDone()) }
    },
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))
const NUM_IDS = { bullet: null, ordered: null }

function makeLoop(editor: Editor, transport: AgentTransport, onDone: (text: string) => void) {
  return new AgentLoop({
    transport,
    skill: createDocsSkill(
      () => editor,
      () => NUM_IDS,
    ),
    events: { onDone: (r) => onDone(r.text) },
  })
}

describe('word-count stats (answer-style requests)', () => {
  it('each turn context carries full-text stats matching the status bar so the model can quote them directly', async () => {
    const editor = createEditor(fixture())
    const context = buildDocContext(editor)
    const expected = countWords(editor.state.doc.textContent)
    expect(context).toContain(`Full-text stats: words ${expected}`)
    expect(context).toContain('0|h1|Chapter 1 Overview')
    expect(context).toContain('3|p|This document is for reference only.')
  })

  it('get_document_context tool returns the same stats and does not modify the document', async () => {
    const editor = createEditor(fixture())
    const before = JSON.stringify(editor.getJSON())
    const exec = await executeTool(
      editor,
      { id: 't1', name: 'get_document_context', input: {} },
      NUM_IDS,
    )
    expect(exec.mutated).toBe(false)
    expect(exec.output).toContain(`words ${countWords(editor.state.doc.textContent)}`)
    expect(JSON.stringify(editor.getJSON())).toBe(before)
  })

  it('answer-only turn: the model replies with plain text and the document is unchanged', async () => {
    const editor = createEditor(fixture())
    const before = JSON.stringify(editor.getJSON())
    let final = ''
    const loop = makeLoop(
      editor,
      scriptedTransport([
        (cb) => {
          cb.onDelta('The document has 17 words.')
          cb.onDone()
        },
      ]),
      (t) => (final = t),
    )
    loop.run('How many words are there now')
    await flush()
    expect(final).toBe('The document has 17 words.')
    expect(JSON.stringify(editor.getJSON())).toBe(before)
    // The context made it into the user message sent to the model
    expect((loop.messages[0] as { text: string }).text).toContain('Full-text stats')
  })
})

describe('changing heading colors (formatting-command requests)', () => {
  it('after the model calls apply_commands, all headings turn red with the aiChanged highlight', async () => {
    const editor = createEditor(fixture())
    let final = ''
    const loop = makeLoop(
      editor,
      scriptedTransport([
        (cb) => {
          cb.onToolCall({
            id: 't1',
            name: 'apply_commands',
            input: {
              commands: [
                {
                  updateTextStyle: {
                    target: { nodeType: 'docHeading' },
                    style: { color: 'FF0000' },
                    fields: ['color'],
                  },
                },
              ],
            },
          })
          cb.onDone()
        },
        (cb) => {
          cb.onDelta('All headings are now red.')
          cb.onDone()
        },
      ]),
      (t) => (final = t),
    )
    loop.run('Turn all headings red')
    await flush()
    await flush()

    expect(final).toBe('All headings are now red.')
    for (const blockIndex of [0, 2]) {
      const block = editor.state.doc.child(blockIndex)
      expect(block.attrs.aiChanged).toBe(true)
      const mark = block.child(0).marks.find((m) => m.type.name === 'docTextStyle')
      expect(mark?.attrs.color).toBe('FF0000')
    }
    // Body text is unaffected
    expect(
      editor.state.doc
        .child(1)
        .child(0)
        .marks.some((m) => m.type.name === 'docTextStyle'),
    ).toBe(false)
    // The tool result was passed back to the model
    const toolMsg = loop.messages[2] as { role: 'tool'; results: Array<{ output: string }> }
    expect(toolMsg.results[0].output).toContain('已更新 2 个块的文字样式')
  })

  it('invalid commands return an error result, the document is unchanged, and the loop continues', async () => {
    const editor = createEditor(fixture())
    const before = JSON.stringify(editor.getJSON())
    const loop = makeLoop(
      editor,
      scriptedTransport([
        (cb) => {
          cb.onToolCall({
            id: 't1',
            name: 'apply_commands',
            input: { commands: [{ updateTextStyle: { style: {}, fields: [] } }] },
          })
          cb.onDone()
        },
        (cb) => {
          cb.onDelta('Invalid command.')
          cb.onDone()
        },
      ]),
      () => {},
    )
    loop.run('Make random edits')
    await flush()
    await flush()
    const toolMsg = loop.messages[2] as { role: 'tool'; results: Array<{ isError?: boolean }> }
    expect(toolMsg.results[0].isError).toBe(true)
    expect(JSON.stringify(editor.getJSON())).toBe(before)
  })
})

describe('content read/write tools', () => {
  it('read_blocks returns the full restricted HTML', async () => {
    const editor = createEditor(fixture())
    const exec = await executeTool(
      editor,
      { id: 't', name: 'read_blocks', input: { startBlockIndex: 0, endBlockIndex: 1 } },
      NUM_IDS,
    )
    expect(exec.output).toContain('<h1>Chapter 1 Overview</h1>')
    expect(exec.output).toContain('<p>GenSpark is an AI office suite.</p>')
  })

  it('replace_blocks rewrites the specified blocks', async () => {
    const editor = createEditor(fixture())
    const exec = await executeTool(
      editor,
      {
        id: 't',
        name: 'replace_blocks',
        input: { startBlockIndex: 1, endBlockIndex: 1, html: '<p>Intro rewritten.</p>' },
      },
      NUM_IDS,
    )
    expect(exec.mutated).toBe(true)
    const block = editor.state.doc.child(1)
    expect(block.textContent).toBe('Intro rewritten.')
    expect(block.attrs.aiChanged).toBe(true)
    expect(editor.state.doc.childCount).toBe(4)
  })

  it('insert_content inserts after the specified block', async () => {
    const editor = createEditor(fixture())
    const exec = await executeTool(
      editor,
      {
        id: 't',
        name: 'insert_content',
        input: { html: '<h2>New Section</h2><p>New content.</p>', afterBlockIndex: 3 },
      },
      NUM_IDS,
    )
    expect(exec.mutated).toBe(true)
    expect(editor.state.doc.childCount).toBe(6)
    expect(editor.state.doc.child(4).textContent).toBe('New Section')
    expect(editor.state.doc.child(5).textContent).toBe('New content.')
  })
})
