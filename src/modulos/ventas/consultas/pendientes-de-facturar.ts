import type { ContextoOperativo } from "../../../contexto/contexto";
import type { SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { CursorDePendientes } from "../persistencia/repositorio-de-lecturas";
import type { DependenciasDeConsultasDeVentas, TxDeConsultasDeVentas } from "./contrato";

/**
 * La lectura paginada de «Pendientes de facturar» (E1 §3.3), aparte de `consultas.ts` por el tope de tamaño de archivo.
 */

/** Cuántas páginas de tickets se miran como mucho en una consulta de pendientes (cada una pregunta a fiscal por lote). */
const MAXIMO_DE_VUELTAS_DE_PENDIENTES = 10;

export type PendienteVista = Readonly<{
  fila: Awaited<
    ReturnType<TxDeConsultasDeVentas["lecturasDeVentas"]["pendientesDeFacturar"]>
  >[number];
  motivo: "SIN_COMPROBANTE" | "COMPROBANTE_ANULADO";
}>;

export async function reunirPendientes(
  tx: TxDeConsultasDeVentas,
  contexto: ContextoOperativo,
  dependencias: DependenciasDeConsultasDeVentas,
  base: Readonly<{
    sucursales: readonly SucursalId[] | null;
    fechaDesde: string | null;
    fechaHasta: string | null;
  }>,
  entrada: Readonly<{
    despuesDe?: CursorDePendientes | undefined;
    motivo?: "SIN_COMPROBANTE" | "COMPROBANTE_ANULADO" | undefined;
  }>,
  limite: number,
): Promise<
  Resultado<
    Readonly<{ tickets: readonly PendienteVista[]; siguiente: CursorDePendientes | null }>,
    "FACTURACION_NO_DISPONIBLE"
  >
> {
  // «Facturado» lo decide fiscal (E1 §3.3): un ticket sin documento es SIN_COMPROBANTE; uno con documento entra solo si fiscal dice que ese
  // comprobante dejó de valer (COMPROBANTE_ANULADO); uno con comprobante vigente (también «Confirmando») no entra. Fiscal se consulta por
  // lote (hasta MAXIMO_DE_PENDIENTES_POR_PEDIDO + 1 ids). Como el filtro se aplica DESPUÉS de leer una página, se leen páginas hasta juntar
  // `limite + 1` o agotar los tickets, con un tope de vueltas: si el tope corta, `siguiente` apunta al último ticket mirado y se sigue desde ahí.
  const juntados: PendienteVista[] = [];
  let cursor = entrada.despuesDe ?? null;
  let hayMas = false;
  for (let vuelta = 0; vuelta < MAXIMO_DE_VUELTAS_DE_PENDIENTES; vuelta++) {
    const filas = await tx.lecturasDeVentas.pendientesDeFacturar(contexto.empresaId, {
      ...base,
      despuesDe: cursor,
      limite: limite + 1,
    });
    const documentos = await tx.documentos.vigentesDe(
      contexto.empresaId,
      filas.map((f) => f.ticketId),
    );
    const documentoDe = new Map(documentos.map((d) => [d.ticketId as string, d]));
    let vigencia: ReadonlyMap<string, boolean> = new Map();
    if (documentos.length > 0) {
      if (dependencias.facturador === undefined) return err("FACTURACION_NO_DISPONIBLE");
      const respuesta = await dependencias.facturador.vigenciaEnTx(
        tx,
        contexto,
        documentos.map((d) => d.comprobanteId),
      );
      if (!respuesta.ok) return err("FACTURACION_NO_DISPONIBLE");
      vigencia = new Map(respuesta.valor.map((v) => [v.comprobanteId, v.vigente]));
    }
    for (const f of filas) {
      const documento = documentoDe.get(f.ticketId);
      let motivo: "SIN_COMPROBANTE" | "COMPROBANTE_ANULADO";
      if (documento === undefined) {
        motivo = "SIN_COMPROBANTE";
      } else {
        const vale = vigencia.get(documento.comprobanteId);
        // El puntero apunta a fiscal por clave foránea: que fiscal no lo conozca es una inconsistencia grave, no «sin comprobante».
        if (vale === undefined) {
          throw new Error(
            `el comprobante ${documento.comprobanteId} del ticket ${f.ticketId} no figura en fiscal`,
          );
        }
        if (vale) continue;
        motivo = "COMPROBANTE_ANULADO";
      }
      if (entrada.motivo === undefined || entrada.motivo === motivo) {
        juntados.push({ fila: f, motivo });
      }
    }
    const ultimaMirada = filas[filas.length - 1];
    const quedan = filas.length > limite;
    if (ultimaMirada !== undefined) {
      cursor = {
        fechaNegocio: ultimaMirada.fechaNegocio,
        numero: ultimaMirada.numero,
        sucursalId: ultimaMirada.sucursalId,
      };
    }
    if (!quedan || juntados.length > limite) {
      hayMas = quedan;
      break;
    }
    hayMas = true;
  }
  const pagina = juntados.slice(0, limite);
  const ultimo = pagina[pagina.length - 1];
  const cortadoPorElTope = juntados.length <= limite && hayMas;
  const siguiente =
    juntados.length > limite && ultimo !== undefined
      ? {
          fechaNegocio: ultimo.fila.fechaNegocio,
          numero: ultimo.fila.numero,
          sucursalId: ultimo.fila.sucursalId,
        }
      : cortadoPorElTope
        ? cursor
        : null;
  return ok({ tickets: pagina, siguiente });
}
