import { PDFDocument } from 'pdf-lib';
import type { ContractPdfRenderer } from '../../common/ports/contract-pdf-renderer.js';

export class PdfLibContractRenderer implements ContractPdfRenderer {
  async isReadablePdf(pdf: Buffer): Promise<boolean> {
    try {
      // Mặc định pdf-lib ném EncryptedPDFError với file mã hóa (không ghép trang chứng nhận được).
      const doc = await PDFDocument.load(pdf, { updateMetadata: false });
      return doc.getPageCount() > 0;
    } catch {
      return false;
    }
  }
}
