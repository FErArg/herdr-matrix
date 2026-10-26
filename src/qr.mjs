// Dibuja un código QR como texto para la consola.
// Los bytes se pasan en modo byte sin conversión de codificación: el QR de verificación es binario.

import qrcode from "qrcode-generator";

export function renderQr(bytes) {
  let data = "";
  for (const byte of bytes) data += String.fromCharCode(byte);
  const qr = qrcode(0, "L");
  qr.addData(data, "Byte");
  qr.make();
  return qr.createASCII();
}
