import { ARS } from "../primitivas/dinero/moneda";
import {
  importeCero,
  importeDesdeTexto,
  restar,
  sumar,
  type Importe,
} from "../primitivas/dinero/importe";
import { fechaCivilDesdeTexto } from "../primitivas/tiempo/fecha-civil";
import {
  CLASE_DE_LA_NOTA_DE_CREDITO,
  CLASE_DE_LA_NOTA_DE_DEBITO,
  CLASE_DEL_CARGO_DE_FACTURA,
  CLASE_DEL_PAGO,
  DETALLE_DE_LA_ANULACION_DE_LA_NOTA,
  DETALLE_DE_LA_ANULACION_DEL_CARGO,
  DETALLE_DE_LA_ANULACION_DEL_PAGO,
  ORIGEN_DE_LA_NOTA,
  ORIGEN_DEL_CARGO_DE_FACTURA,
  ORIGEN_DEL_PAGO,
  claveDeLaAnulacionDeLaNota,
  claveDeLaAnulacionDelCargo,
  claveDeLaAnulacionDelPago,
  claveDeLaImputacionDeLaNota,
  claveDeLaImputacionDelPago,
  claveDeLaNota,
  claveDelCargo,
  claveDelPago,
  type CodigoDelLibroDeProveedores,
  type LibroDeProveedores,
  type TxDeCompras,
} from "../modulos/compras/publico";
import {
  anularAsientoEnTx,
  conSigno,
  distribuirPorCentroDeCosto,
  imputarEnTx,
  registrarAsientoEnTx,
  type AsientoGuardado,
  type CentroDeCosto,
  type ErrorDelLibro,
  type Reparto,
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

const unidadesDe = (importe: Importe): bigint => importe.unidades;
type ResultadoDelLibro = Awaited<ReturnType<LibroDeProveedores["registrarPago"]>>;

/**
 * Cómo se reparte entre sucursales (centros de costo) lo que se aplica contra un cargo, y cuánto de eso se puede IMPUTAR. Lo pendiente de cada centro es el reparto del cargo menos el de lo ya aplicado contra él (notas
 * y pagos vigentes). Si lo que se aplica es EXACTAMENTE todo lo pendiente, el reparto es el pendiente (a un centavo: el último pago salda cada centro); si es otra cantidad, se prorratea sobre lo pendiente (el mayor
 * resto al primero). Lo imputable es el importe hasta lo pendiente del cargo: lo que sobra NO se imputa y queda como saldo a favor de la empresa (L3a: un pago después de una nota de crédito, o una nota después del pago).
 */
async function repartoContraElCargo(
  tx: TxDeSaldos,
  empresaId: string,
  cargo: AsientoGuardado,
  importe: Importe,
): Promise<Readonly<{ reparto: Reparto[]; imputable: Importe }>> {
  const moneda = importe.moneda;
  const cero = importeCero(moneda);
  const pendientes = new Map<CentroDeCosto, Importe>();
  for (const r of await tx.asientos.distribucionDe(empresaId as never, cargo.id)) {
    pendientes.set(r.centroDeCosto, sumar(pendientes.get(r.centroDeCosto) ?? cero, r.importe));
  }
  const pares = await tx.imputaciones.paresVigentesDe(empresaId as never, cargo.id);
  for (const saldanteId of new Set(pares.map((p) => p.saldanteId))) {
    // La distribución de lo ya aplicado está con su signo (resta): se suma tal cual.
    for (const r of await tx.asientos.distribucionDe(empresaId as never, saldanteId)) {
      pendientes.set(r.centroDeCosto, sumar(pendientes.get(r.centroDeCosto) ?? cero, r.importe));
    }
  }
  const estado = await tx.saldos.estadoDeAsiento(empresaId as never, cargo.id);
  const pendienteDelCargo = estado === null ? cero : restar(estado.tope, estado.imputado);
  const imputable =
    unidadesDe(importe) < unidadesDe(pendienteDelCargo) ? importe : pendienteDelCargo;
  const positivos = [...pendientes.entries()].filter(([, v]) => unidadesDe(v) > 0n);
  const totalPendiente = positivos.reduce((a, [, v]) => sumar(a, v), cero);
  if (unidadesDe(importe) === unidadesDe(totalPendiente) && positivos.length > 0) {
    return {
      reparto: positivos.map(([centroDeCosto, v]) => ({ centroDeCosto, importe: v })),
      imputable,
    };
  }
  const prorrateo = distribuirPorCentroDeCosto({
    importe,
    imputaciones: [],
    pendientePorCentro: positivos.map(([centroDeCosto, v]) => ({ centroDeCosto, pendiente: v })),
  });
  if (!prorrateo.ok) throw new Error(`el reparto contra el cargo no es válido: ${prorrateo.error}`);
  return { reparto: prorrateo.valor, imputable };
}

/** El asiento de una nota o de un pago que RESTA contra un cargo, con su reparto y su imputación (hasta lo pendiente). Un error del libro corta y deshace todo. */
async function aplicarContraElCargo(
  tx: TxDeSaldos,
  contexto: Parameters<LibroDeProveedores["registrarPago"]>[1],
  cargo: AsientoGuardado,
  datos: Readonly<{
    clase: string;
    origenTipo: string;
    origenId: string;
    importe: Importe;
    claveDelAsiento: string;
    claveDeLaImputacion: string;
    hechoEn: Date;
  }>,
): Promise<ResultadoDelLibro> {
  const { reparto, imputable } = await repartoContraElCargo(
    tx,
    contexto.empresaId,
    cargo,
    datos.importe,
  );
  const asiento = await registrarAsientoEnTx(tx, contexto, {
    parteId: cargo.parteId,
    sentido: "A_PAGAR",
    clase: datos.clase,
    // Lo que resta: el libro lo pide con el signo de su clase, y su distribución con el mismo signo.
    importe: restar(importeCero(ARS), datos.importe),
    origen: { tipo: datos.origenTipo, id: datos.origenId, orden: 1 },
    venceEl: null,
    clave: datos.claveDelAsiento,
    hechoEn: datos.hechoEn,
    distribucion: conSigno(reparto, "-"),
  });
  if (!asiento.ok) return { ok: false, error: codigoDelLibro(asiento.error) };
  if (unidadesDe(imputable) > 0n) {
    const imputacion = await imputarEnTx(tx, contexto, {
      saldanteId: asiento.valor.asientoId,
      repartos: [{ saldadoId: cargo.id, importe: imputable }],
      clave: datos.claveDeLaImputacion,
    });
    if (!imputacion.ok) return { ok: false, error: codigoDelLibro(imputacion.error) };
  }
  return { ok: true, valor: asiento.valor };
}

/** El espejo de un asiento por su origen: sin asiento falla cerrado con el código que dice cuál faltaba. */
async function espejoDelOrigen(
  tx: TxDeSaldos,
  contexto: Parameters<LibroDeProveedores["registrarPago"]>[1],
  datos: Readonly<{ origenTipo: string; origenId: string; detalle: string; clave: string }>,
  faltante: "ASIENTO_DEL_PAGO_NO_ENCONTRADO" | "ASIENTO_DE_LA_NOTA_NO_ENCONTRADO",
): Promise<ResultadoDelLibro> {
  const original = await tx.asientos.porOrigen(
    contexto.empresaId,
    datos.origenTipo,
    datos.origenId,
    1,
  );
  if (original === null) return { ok: false, error: faltante };
  const r = await anularAsientoEnTx(tx, contexto, {
    asientoId: original.id,
    detalle: datos.detalle,
    clave: datos.clave,
  });
  return r.ok
    ? { ok: true, valor: { asientoId: r.valor.asientoId, yaExistia: r.valor.yaExistia } }
    : { ok: false, error: codigoDelLibro(r.error) };
}

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
      return aplicarContraElCargo(tx2, contexto, cargo, {
        clase: CLASE_DEL_PAGO,
        origenTipo: ORIGEN_DEL_PAGO,
        origenId: entrada.pagoId,
        importe: importeDesdeTexto(ARS, entrada.importe),
        claveDelAsiento: claveDelPago(entrada.pagoId),
        claveDeLaImputacion: claveDeLaImputacionDelPago(entrada.pagoId),
        hechoEn: entrada.hechoEn,
      });
    },
    anularPago: (tx, contexto, entrada) =>
      espejoDelOrigen(
        comoTxDeSaldos(tx),
        contexto,
        {
          origenTipo: ORIGEN_DEL_PAGO,
          origenId: entrada.pagoId,
          detalle: DETALLE_DE_LA_ANULACION_DEL_PAGO,
          clave: claveDeLaAnulacionDelPago(entrada.pagoId),
        },
        "ASIENTO_DEL_PAGO_NO_ENCONTRADO",
      ),
    async registrarNotaDeCredito(tx, contexto, entrada) {
      const tx2 = comoTxDeSaldos(tx);
      const cargo = await tx2.asientos.porOrigen(
        contexto.empresaId,
        ORIGEN_DEL_CARGO_DE_FACTURA,
        entrada.facturaId,
        1,
      );
      if (cargo === null) return { ok: false, error: "ASIENTO_DE_LA_FACTURA_NO_ENCONTRADO" };
      return aplicarContraElCargo(tx2, contexto, cargo, {
        clase: CLASE_DE_LA_NOTA_DE_CREDITO,
        origenTipo: ORIGEN_DE_LA_NOTA,
        origenId: entrada.notaId,
        importe: importeDesdeTexto(ARS, entrada.importe),
        claveDelAsiento: claveDeLaNota(entrada.notaId),
        claveDeLaImputacion: claveDeLaImputacionDeLaNota(entrada.notaId),
        hechoEn: entrada.hechoEn,
      });
    },
    anularNotaDeCredito: (tx, contexto, entrada) =>
      espejoDelOrigen(
        comoTxDeSaldos(tx),
        contexto,
        {
          origenTipo: ORIGEN_DE_LA_NOTA,
          origenId: entrada.notaId,
          detalle: DETALLE_DE_LA_ANULACION_DE_LA_NOTA,
          clave: claveDeLaAnulacionDeLaNota(entrada.notaId),
        },
        "ASIENTO_DE_LA_NOTA_NO_ENCONTRADO",
      ),
    async registrarNotaDeDebito(tx, contexto, entrada) {
      const tx2 = comoTxDeSaldos(tx);
      const importe = importeDesdeTexto(ARS, entrada.importe);
      // Un cargo suelto: la distribución es la de la factura vinculada si tiene cargo, y «sin centro de costo» si no hay factura o es anterior al libro (se registra y se etiqueta, no se inventa).
      const cargo =
        entrada.facturaId === null
          ? null
          : await tx2.asientos.porOrigen(
              contexto.empresaId,
              ORIGEN_DEL_CARGO_DE_FACTURA,
              entrada.facturaId,
              1,
            );
      const original =
        cargo === null ? [] : await tx2.asientos.distribucionDe(contexto.empresaId, cargo.id);
      const prorrateo = distribuirPorCentroDeCosto({
        importe,
        imputaciones: [],
        pendientePorCentro: original.map((r) => ({
          centroDeCosto: r.centroDeCosto,
          pendiente: r.importe,
        })),
      });
      if (!prorrateo.ok) return { ok: false, error: "LIBRO_DE_SALDOS_RECHAZADO" };
      const r = await registrarAsientoEnTx(tx2, contexto, {
        parteId: entrada.proveedorId,
        sentido: "A_PAGAR",
        clase: CLASE_DE_LA_NOTA_DE_DEBITO,
        importe,
        origen: { tipo: ORIGEN_DE_LA_NOTA, id: entrada.notaId, orden: 1 },
        venceEl: null,
        clave: claveDeLaNota(entrada.notaId),
        hechoEn: entrada.hechoEn,
        distribucion: prorrateo.valor,
      });
      return r.ok ? { ok: true, valor: r.valor } : { ok: false, error: codigoDelLibro(r.error) };
    },
    anularNotaDeDebito: (tx, contexto, entrada) =>
      espejoDelOrigen(
        comoTxDeSaldos(tx),
        contexto,
        {
          origenTipo: ORIGEN_DE_LA_NOTA,
          origenId: entrada.notaId,
          detalle: DETALLE_DE_LA_ANULACION_DE_LA_NOTA,
          clave: claveDeLaAnulacionDeLaNota(entrada.notaId),
        },
        "ASIENTO_DE_LA_NOTA_NO_ENCONTRADO",
      ),
  };
}
