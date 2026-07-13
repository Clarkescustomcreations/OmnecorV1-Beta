declare module "svg-to-pdfkit" {
  /** Render an SVG string into a PDFKit document at (x, y). */
  const SVGtoPDF: (
    doc: PDFKit.PDFDocument,
    svg: string,
    x: number,
    y: number,
    options?: { width?: number; height?: number; preserveAspectRatio?: string; [k: string]: unknown },
  ) => void;
  export default SVGtoPDF;
}
