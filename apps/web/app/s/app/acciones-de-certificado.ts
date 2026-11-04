"use server";

import {
  cargarElCertificado,
  generarElPedidoDeCertificado,
} from "../../../servidor/certificado-de-arca";

// Las dos acciones de servidor del certificado de ARCA, expuestas a Next. Finas a propósito (ADR-015, punto 2): la directiva `"use server"`
// tiene que ser lo primero de este archivo, así que lo que hacen vive en `servidor/certificado-de-arca.ts` (que empieza con
// `server-only`). Reciben el pedido tal como lo arma la pantalla (sin tipo: se lee y se valida en el servidor) y devuelven la
// respuesta ya traducida (ADR-016). La empresa y quién actúa no viajan: los decide el servidor. Ambas exigen `certificados.gestionar`.

export async function generarPedidoDeCertificadoAccion(entrada: unknown) {
  return generarElPedidoDeCertificado(entrada);
}

export async function cargarCertificadoAccion(entrada: unknown) {
  return cargarElCertificado(entrada);
}
