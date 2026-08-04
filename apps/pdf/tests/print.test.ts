import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { printPdf } from '../src/renderer/print'

function fakeDoc(numPages: number, render = vi.fn(() => ({ promise: Promise.resolve() }))) {
  const getPage = vi.fn(async () => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }),
    render,
  }))
  return { doc: { numPages, getPage } as unknown as PDFDocumentProxy, getPage, render }
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,FAKE')
  // jsdom does not implement img.decode or window.print
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true,
    writable: true,
    value: vi.fn(() => Promise.resolve()),
  })
  window.print = vi.fn(() => {
    window.dispatchEvent(new Event('afterprint'))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('printPdf', () => {
  it('renders one image per page into a print root and opens the print dialog', async () => {
    const { doc, getPage, render } = fakeDoc(3)
    let imgsAtPrintTime = 0
    ;(window.print as ReturnType<typeof vi.fn>).mockImplementation(() => {
      imgsAtPrintTime = document.querySelectorAll('.pdf-print-root img').length
      window.dispatchEvent(new Event('afterprint'))
    })

    await printPdf(doc)

    expect(getPage).toHaveBeenCalledTimes(3)
    expect(getPage).toHaveBeenNthCalledWith(1, 1)
    expect(render).toHaveBeenCalledTimes(3)
    expect(imgsAtPrintTime).toBe(3)
    expect(window.print).toHaveBeenCalledTimes(1)
  })

  it('removes the print root after the dialog closes', async () => {
    const { doc } = fakeDoc(2)
    await printPdf(doc)
    expect(document.querySelector('.pdf-print-root')).toBeNull()
  })

  it('waits for afterprint before resolving', async () => {
    const { doc } = fakeDoc(1)
    let fireAfterPrint: () => void = () => {}
    ;(window.print as ReturnType<typeof vi.fn>).mockImplementation(() => {
      fireAfterPrint = () => window.dispatchEvent(new Event('afterprint'))
    })

    let resolved = false
    const done = printPdf(doc).then(() => {
      resolved = true
    })
    // Let rendering and the print call complete
    await vi.waitFor(() => expect(window.print).toHaveBeenCalled())
    expect(resolved).toBe(false)
    expect(document.querySelector('.pdf-print-root')).not.toBeNull()

    fireAfterPrint()
    await done
    expect(resolved).toBe(true)
    expect(document.querySelector('.pdf-print-root')).toBeNull()
  })

  it('cleans up the print root even when image decoding fails', async () => {
    const { doc } = fakeDoc(1)
    ;(HTMLImageElement.prototype.decode as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('decode failed'),
    )
    await expect(printPdf(doc)).rejects.toThrow('decode failed')
    expect(document.querySelector('.pdf-print-root')).toBeNull()
    expect(window.print).not.toHaveBeenCalled()
  })
})
