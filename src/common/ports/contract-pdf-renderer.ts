export const CONTRACT_PDF_RENDERER = Symbol('CONTRACT_PDF_RENDERER');

/** Xử lý file PDF hợp đồng (pdf-lib). Phần ký sẽ thêm hàm sinh trang chứng nhận ký. */
export interface ContractPdfRenderer {
  /** PDF đọc được, không mã hóa, có ít nhất một trang. */
  isReadablePdf(pdf: Buffer): Promise<boolean>;
}
