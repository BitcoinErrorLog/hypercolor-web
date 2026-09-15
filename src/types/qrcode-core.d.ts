declare module "qrcode/lib/core/qrcode" {
  interface QrModules {
    size: number;
    get(x: number, y: number): boolean;
  }

  interface QrCode {
    modules: QrModules | null;
  }

  function create(
    value: string,
    options?: { errorCorrectionLevel?: "L" | "M" | "Q" | "H" },
  ): QrCode;

  export default { create };
}
