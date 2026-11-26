import { ARS } from "../primitivas/dinero/moneda";
import { importeCero, importeDesdeTexto, restar } from "../primitivas/dinero/importe";
import { fechaCivilDesdeTexto } from "../primitivas/tiempo/fecha-civil";
import {
  CLASE_DEL_CARGO_DE_FACTURA,
  CLASE_DEL_PAGO,
  DETALLE_DE_LA_ANULACION_DEL_CARGO,
  DETALLE_DE_LA_ANULACION_DEL_PAGO,
  ORIGEN_DEL_CARGO_DE_FACTURA,
  ORIGEN_DEL_PAGO,
  claveDeLaAnulacionDelCargo,
  claveDeLaAnulacionDelPago,
  claveDeLaImputacionDelPago,
  claveDelCargo,
  claveDelPago,
  type CodigoDelLibroDeProveedores,
  type LibroDeProveedores,
  type TxDeCompras,
} from "../modulos/compras/publico";
import {
  anularAsientoEnTx,
  conSigno,
  imputarEnTx,
  registrarAsientoEnTx,
  type ErrorDelLibro,
  type TxDeSaldos,
} from "../modulos/saldos_de_partes/publico";

/**
 * El puerto del libro de saldos para compras (L1): compras declara `LibroDeProveedores` y esta composición lo implementa con `saldos_de_partes`, que compras no puede importar. La transacción de compras es,
 * en la aplicación, la compuesta (`TxDeApp`), que además trae los repositorios del libro sobre la MISMA conexión: por eso la factura y su asiento son una sola transacción. Si por un defecto de armado no los
 * trae, se aborta antes de escribir. El libro no autoriza (el guard es el de la acción de compras). Los errores del libro salen como `LIBRO_DE_SALDOS_RECHAZADO`, salvo la clave reutilizada.
 */
const PIEZAS_DEL_LIBRO = ["asientos", "imputaciones", "saldos", "auditoria"] as const;

function comoTxDeSaldos(tx: TxDeCompras): TxDeSaldos {
  for (const pieza of PIEZAS_DEL_LIBRO) {
    if (!Object.hasOwn(tx, pieza)) {
      throw new Error(`la transacción de compras no trae la pieza del libro «${pieza}»`);
    }
  }
  return tx as unknown as TxDeSaldos;
}

const codigoDelLibro = (error: ErrorDelLibro): CodigoDelLibroDeProveedores =>
  error === "CLAVE_REUTILIZADA" ? "CLAVE_REUTILIZADA" : "LIBRO_DE_SALDOS_RECHAZADO";

export function crearLibroDeProveedores(): LibroDeProveedores {
  return {
    async registrarCargo(tx, contexto, entrada) {
      const vence = entrada.venceEl === null ? null : fechaCivilDesdeTexto(entrada.venceEl);
      if (vence !== null && !vence.ok) return { ok: false, error: "LIBRO_DE_SALDOS_RECHAZADO" };
      const r = await registrarAsientoEnTx(comoTxDeSaldos(tx), contexto, {
        parteId: entrada.proveedorId,
        sentido: "A_PAGAR",
        clase: CLASE_DEL_CARGO_DE_FACTURA,
        importe: importeDesdeTexto(ARS, entrada.total),
        origen: { tipo: ORIGEN_DEL_CARGO_DE_FACTURA, id: entrada.comprobanteId, orden: 1 },
        venceEl: vence === null ? null : vence.valor,
        clave: claveDelCargo(entrada.comprobanteId),
        hechoEn: entrada.hechoEn,
        distribucion: entrada.reparto.map((r) => ({
          centroDeCosto: r.sucursalId,
          importe: importeDesdeTexto(ARS, r.importe),
        })),
      });
      return r.ok ? { ok: true, valor: r.valor } : { ok: false, error: codigoDelLibro(r.error) };
    },
    async anularCargo(tx, contexto, entrada) {
      const tx2 = comoTxDeSaldos(tx);
      const original = await tx2.asientos.porOrigen(
        contexto.empresaId,
        ORIGEN_DEL_CARGO_DE_FACTURA,
        entrada.comprobanteId,
        1,
      );
      if (original === null) return { ok: false, error: "ASIENTO_DE_LA_FACTURA_NO_ENCONTRADO" };
      const r = await anularAsientoEnTx(tx2, contexto, {
        asientoId: original.id,
        detalle: DETALLE_DE_LA_ANULACION_DEL_CARGO,
        clave: claveDeLaAnulacionDelCargo(entrada.comprobanteId),
      });
      return r.ok
        ? { ok: true, valor: { asientoId: r.valor.asientoId, yaExistia: r.valor.yaExistia } }
        : { ok: false, error: codigoDelLibro(r.error) };
    },
    async registrarPago(tx, contexto, entrada) {
      const tx2 = comoTxDeSaldos(tx);
      const cargo = await tx2.asientos.porOrigen(
        contexto.empresaId,
        ORIGEN_DEL_CARGO_DE_FACTURA,
        entrada.comprobanteId,
        1,
      );
      if (cargo === null) return { ok: false, error: "ASIENTO_DE_LA_FACTURA_NO_ENCONTRADO" };
      const importe = importeDesdeTexto(ARS, entrada.importe);
      // L2 paga el cargo entero: un pago por otro importe (el neto con notas de crédito) llega con L3, que también reparte el pago entre los centros de costo del cargo.
      if (importe.unidades !== cargo.importe.unidades) {
        return { ok: false, error: "LIBRO_DE_SALDOS_RECHAZADO" };
      }
      const asiento = await registrarAsientoEnTx(tx2, contexto, {
        parteId: cargo.parteId,
        sentido: "A_PAGAR",
        clase: CLASE_DEL_PAGO,
        // El pago resta: el libro lo pide con el signo de su clase, y su distribución con el mismo signo.
        importe: restar(importeCero(ARS), importe),
        origen: { tipo: ORIGEN_DEL_PAGO, id: entrada.pagoId, orden: 1 },
        venceEl: null,
        clave: claveDelPago(entrada.pagoId),
        hechoEn: entrada.hechoEn,
        distribucion: conSigno(
          await tx2.asientos.distribucionDe(contexto.empresaId, cargo.id),
          "-",
        ),
      });
      if (!asiento.ok) return { ok: false, error: codigoDelLibro(asiento.error) };
      const imputacion = await imputarEnTx(tx2, contexto, {
        saldanteId: asiento.valor.asientoId,
        repartos: [{ saldadoId: cargo.id, importe }],
        clave: claveDeLaImputacionDelPago(entrada.pagoId),
      });
      return imputacion.ok
        ? { ok: true, valor: asiento.valor }
        : { ok: false, error: codigoDelLibro(imputacion.error) };
    },
    async anularPago(tx, contexto, entrada) {
      const tx2 = comoTxDeSaldos(tx);
      const original = await tx2.asientos.porOrigen(
        contexto.empresaId,
        ORIGEN_DEL_PAGO,
        entrada.pagoId,
        1,
      );
      if (original === null) return { ok: false, error: "ASIENTO_DEL_PAGO_NO_ENCONTRADO" };
      const r = await anularAsientoEnTx(tx2, contexto, {
        asientoId: original.id,
        detalle: DETALLE_DE_LA_ANULACION_DEL_PAGO,
        clave: claveDeLaAnulacionDelPago(entrada.pagoId),
      });
      return r.ok
        ? { ok: true, valor: { asientoId: r.valor.asientoId, yaExistia: r.valor.yaExistia } }
        : { ok: false, error: codigoDelLibro(r.error) };
    },
  };
}
