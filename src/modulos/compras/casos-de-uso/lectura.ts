import type { ContextoOperativo } from "../../../contexto/contexto";
import { fechaCivilDesdeTexto } from "../../../primitivas/tiempo/fecha-civil";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { crearDirectorioDePartes } from "../../clientes/publico";
import { FICHA_DE_TIPO_DE_COMPROBANTE } from "../dominio/comprobante";
import { totalDeCompra } from "../dominio/importe-vigente";
import { estadoDerivadoDeCompra, type EstadoDeCompra } from "../dominio/niveles";
import { esUuid } from "../dominio/identificadores";
import { netoAPagar } from "../dominio/pago";
import type { LineaDeRecepcion, Recepcion } from "../persistencia/repositorio-de-recepciones";
import type { FiltroDeCompras } from "../persistencia/repositorio-de-lecturas-de-compras";
import {
  armarCompras,
  claveDeLinea,
  importesVigentes,
  type CompraDeLista,
  type FacturaDeLista,
} from "./compras-por-lote";
import type { TxDeConsultasDeCompras } from "./contrato";

export type { CompraDeLista, FacturaDeLista };

/**
 * Lo que leen las consultas de compras (E9 §3.10). Vive acá y no en `consultas/` porque decide con el dominio (el estado derivado de la compra) y las
 * consultas no importan el dominio de su módulo. Todo filtra por la empresa del contexto y por el alcance de sucursales de quien pide; el dato ausente se
 * muestra como `null` («Sin precio»), nunca como cero. La compra no guarda estado (S-12): se deriva de la recepción y su comprobante.
 */

export type EntradaDeListarCompras = Readonly<{
  sucursalId?: string | undefined;
  proveedorId?: string | undefined;
  estado?: EstadoDeCompra | undefined;
  /** Fechas de negocio `YYYY-MM-DD`, inclusive. */
  desde?: string | undefined;
  hasta?: string | undefined;
  /** El `siguiente` de la página anterior. */
  despuesDe?: string | undefined;
}>;

export type PaginaDeCompras = Readonly<{
  compras: readonly CompraDeLista[];
  siguiente: string | null;
}>;

type RLectura<S> = Resultado<
  S,
  "CURSOR_INVALIDO" | "IDENTIFICADOR_INVALIDO" | "SUCURSAL_FUERA_DE_ALCANCE"
>;

/** Cuántas compras trae una página. */
export const TAMANO_DE_PAGINA = 50;

/** El cursor de la lista: `fecha_negocio|numero` (el número de la compra es único por empresa y sigue el orden de carga; el `id` es un UUID al azar). */
export const FORMA_DEL_CURSOR = /^(\d{4}-\d{2}-\d{2})\|([1-9]\d{0,8})$/;

const directorio = crearDirectorioDePartes();

export function fechaOpcional(texto: string | undefined): string | null | undefined {
  if (texto === undefined) return null;
  return fechaCivilDesdeTexto(texto).ok ? texto : undefined;
}

export async function listarComprasDentro(
  tx: TxDeConsultasDeCompras,
  contexto: ContextoOperativo,
  entrada: EntradaDeListarCompras,
): Promise<RLectura<PaginaDeCompras>> {
  const desde = fechaOpcional(entrada.desde);
  const hasta = fechaOpcional(entrada.hasta);
  if (desde === undefined || hasta === undefined) return err("IDENTIFICADOR_INVALIDO");
  for (const id of [entrada.sucursalId, entrada.proveedorId]) {
    if (id !== undefined && !esUuid(id)) return err("IDENTIFICADOR_INVALIDO");
  }
  let despuesDe: FiltroDeCompras["despuesDe"] = null;
  if (entrada.despuesDe !== undefined) {
    const partes = FORMA_DEL_CURSOR.exec(entrada.despuesDe);
    const numero = Number(partes?.[2]);
    if (partes === null || !fechaCivilDesdeTexto(partes[1] as string).ok) {
      return err("CURSOR_INVALIDO");
    }
    despuesDe = { fechaNegocio: partes[1] as string, numero };
  }
  const alcance = await tx.autorizacion.sucursalesDelActor(contexto);
  let sucursales: FiltroDeCompras["sucursales"] = alcance;
  if (entrada.sucursalId !== undefined) {
    if (alcance !== "TODAS" && !alcance.some((s) => s === entrada.sucursalId)) {
      return err("SUCURSAL_FUERA_DE_ALCANCE");
    }
    sucursales = [entrada.sucursalId];
  }
  const pedido = entrada.estado;
  const filas = await tx.lecturasDeCompras.listar(contexto.empresaId, {
    sucursales,
    proveedorId: entrada.proveedorId ?? null,
    estado: pedido === undefined ? null : pedido === "ANULADA" ? "ANULADA" : "CONFIRMADA",
    facturada:
      pedido === "RECIBIDA_Y_FACTURADA" ? true : pedido === "RECIBIDA_SIN_FACTURAR" ? false : null,
    desde,
    hasta,
    despuesDe,
    limite: TAMANO_DE_PAGINA + 1,
  });
  const pagina = filas.slice(0, TAMANO_DE_PAGINA);
  const ultima = pagina.at(-1);
  return ok({
    compras: await armarCompras(tx, contexto, pagina),
    siguiente:
      filas.length > TAMANO_DE_PAGINA && ultima !== undefined
        ? `${ultima.fechaNegocio}|${ultima.numero}`
        : null,
  });
}

export type FichaDeCompra = Readonly<{
  recepcionId: string;
  numero: number;
  sucursalId: string;
  proveedorId: string;
  /** El nombre del proveedor para mostrar (también si está desactivado); `null` si la parte está anonimizada. */
  proveedorNombre: string | null;
  nivel: string;
  remito: Recepcion["remito"];
  hechoEn: string;
  fechaNegocio: string;
  estado: EstadoDeCompra;
  registradoPor: string;
  anuladaPor: string | null;
  anuladaEn: string | null;
  motivoDeAnulacion: string | null;
  /** Cada línea con su producto, lo que entra a tu stock, el costo por unidad de stock y su importe VIGENTE (con la última corrección de precio); `null` = «Sin precio». */
  lineas: readonly (LineaDeRecepcion &
    Readonly<{
      productoNombre: string | null;
      /** La unidad en que entra al stock (la base del producto); `null` si el producto no se pudo leer. */
      unidadDeStockId: string | null;
      /** El nombre de la presentación (la «caja», el «pack»), o `null` si se compró en la unidad. */
      presentacionNombre: string | null;
      importeVigente: string | null;
      /**
       * El costo por unidad de stock que guardó el alta, o `null` si la línea no tiene precio o fue CORREGIDA: el costo de una línea corregida lo recalcula la
       * corrección con el IVA que entra al costo (`alicuotaDelCosto`, que lee fiscal) y no se guarda; acá no se muestra uno viejo.
       */
      costoVigente: string | null;
    }>)[];
  /** La suma de los importes vigentes de las líneas (la misma cuenta de la lista); `null` si alguna línea no tiene precio, nunca cero. */
  total: string | null;
  /** La factura de la compra (la vigente, o la última si se anuló), con los dos totales: el calculado y el que dice el papel. */
  comprobante: Readonly<{
    id: string;
    tipo: string | null;
    /** La letra del tipo (A, B o C); `null` sin tipo. */
    letra: "A" | "B" | "C" | null;
    puntoDeVenta: number | null;
    numero: number | null;
    fecha: string | null;
    vencimientoDePago: string | null;
    netoGravado: string;
    iva: string;
    tributosTotal: string;
    totalCalculado: string;
    totalSegunFactura: string;
    /** Lo que hay que pagar: el total menos lo que acreditan sus notas de crédito vigentes (`0.00` si lo acreditan todo). Lo calcula el servidor: la pantalla no hace cuentas. */
    netoAPagar: string;
    letraNoEsperada: boolean;
    estado: string;
  }> | null;
  /** Las correcciones de precio de las líneas, por línea y número: la línea original no se edita, el precio vigente de cada una es el de su última corrección. */
  correcciones: readonly Readonly<{
    linea: number;
    numero: number;
    precioAnterior: string | null;
    precioNuevo: string | null;
    /** Solo al completar el precio de una línea «Sin precio»: su «precio por». */
    precioPorTipo: "PRESENTACION" | "UNIDAD" | null;
    unidadDePrecioId: string | null;
    cantidadAnterior: string | null;
    cantidadNueva: string | null;
    pesoRealAnterior: string | null;
    pesoRealNuevo: string | null;
    motivo: string;
    registradoPor: string;
    registradoEn: string;
  }>[];
  /** Todos los pagos de la factura, del más viejo al más nuevo (el vigente tiene `estado: "VIGENTE"`). */
  pagos: readonly Readonly<{
    id: string;
    fechaDePago: string;
    /** El medio único, o `COMPUESTO` si el pago tiene varios (sus líneas, en `medios`). */
    medio: string;
    /** Una línea por medio con lo que pagó (la suma es `importe`), en el orden de la lista de medios. */
    medios: readonly Readonly<{ medio: string; importe: string }>[];
    importe: string;
    estado: string;
    registradoPor: string;
    /** Instante ISO UTC en que se declaró. */
    registradoEn: string;
    anuladoPor: string | null;
    /** Instante ISO UTC en que se anuló; `null` si está vigente. */
    anuladoEn: string | null;
    motivoDeAnulacion: string | null;
  }>[];
}>;

export async function fichaDeCompraDentro(
  tx: TxDeConsultasDeCompras,
  contexto: ContextoOperativo,
  entrada: Readonly<{ recepcionId: string }>,
): Promise<Resultado<FichaDeCompra | null, "IDENTIFICADOR_INVALIDO">> {
  if (!esUuid(entrada.recepcionId)) return err("IDENTIFICADOR_INVALIDO");
  const recepcion = await tx.recepciones.obtener(contexto.empresaId, entrada.recepcionId);
  if (recepcion === null) return ok(null);
  // Fuera del alcance de sucursales: es indistinguible de una que no existe.
  const alcance = await tx.autorizacion.sucursalesDelActor(contexto);
  if (alcance !== "TODAS" && !alcance.some((s) => s === recepcion.sucursalId)) return ok(null);
  const comprobante = await tx.lecturasDeCompras.estadoDelComprobante(
    contexto.empresaId,
    recepcion.id,
  );
  const factura = await tx.comprobantesDeProveedor.delaRecepcion(contexto.empresaId, recepcion.id);
  const pagos =
    factura === null ? [] : await tx.pagosDeProveedor.deComprobante(contexto.empresaId, factura.id);
  const mediosDeLosPagos = new Map<
    string,
    Awaited<ReturnType<typeof tx.pagosDeProveedor.mediosDe>>
  >();
  for (const p of pagos) {
    mediosDeLosPagos.set(p.id, await tx.pagosDeProveedor.mediosDe(contexto.empresaId, p.id));
  }
  const { lineas, importes, corregidas } = await importesVigentes(tx, contexto, [recepcion.id]);
  const productos = new Map(
    (
      await tx.productosParaCompras.deVarios(
        contexto.empresaId,
        lineas.map((l) => l.productoId),
      )
    ).map((p) => [p.id, p]),
  );
  const presentaciones = new Map(
    (
      await tx.presentacionesDeProducto.obtenerVarias(
        contexto.empresaId,
        lineas.flatMap((l) => (l.presentacionId === null ? [] : [l.presentacionId])),
      )
    ).map((p) => [p.id, p.nombre]),
  );
  const nombres = await directorio.nombresParaMostrar(tx, contexto.empresaId, [
    recepcion.proveedorId,
  ]);
  const importesDeLaFicha = lineas.map(
    (l) => importes.get(claveDeLinea(l.recepcionId, l.numero)) ?? null,
  );
  return ok({
    recepcionId: recepcion.id,
    numero: recepcion.numero,
    sucursalId: recepcion.sucursalId,
    proveedorId: recepcion.proveedorId,
    proveedorNombre: nombres.get(recepcion.proveedorId) ?? null,
    nivel: recepcion.nivel,
    remito: recepcion.remito,
    hechoEn: recepcion.hechoEn.toISOString(),
    fechaNegocio: recepcion.fechaNegocio,
    estado: estadoDerivadoDeCompra(recepcion.estado, comprobante),
    registradoPor: recepcion.registradoPor,
    anuladaPor: recepcion.anuladaPor,
    anuladaEn: recepcion.anuladaEn?.toISOString() ?? null,
    motivoDeAnulacion: recepcion.motivoDeAnulacion,
    lineas: lineas.map((l, i) => {
      return {
        ...l,
        productoNombre: productos.get(l.productoId)?.nombre ?? null,
        unidadDeStockId: productos.get(l.productoId)?.unidadBaseId ?? null,
        presentacionNombre:
          l.presentacionId === null ? null : (presentaciones.get(l.presentacionId) ?? null),
        importeVigente: importesDeLaFicha[i] ?? null,
        costoVigente: corregidas.has(claveDeLinea(l.recepcionId, l.numero))
          ? null
          : l.costoPorUnidadDeStock,
      };
    }),
    total: totalDeCompra(importesDeLaFicha),
    comprobante:
      factura === null
        ? null
        : {
            id: factura.id,
            tipo: factura.tipo,
            letra: factura.tipo === null ? null : FICHA_DE_TIPO_DE_COMPROBANTE[factura.tipo].letra,
            puntoDeVenta: factura.puntoDeVenta,
            numero: factura.numero,
            fecha: factura.fechaDelComprobante,
            vencimientoDePago: factura.fechaDeVencimientoDePago,
            netoGravado: factura.netoGravado,
            iva: factura.iva,
            tributosTotal: factura.tributosTotal,
            totalCalculado: factura.totalCalculado,
            totalSegunFactura: factura.totalSegunFactura,
            netoAPagar:
              netoAPagar(
                factura.totalSegunFactura,
                await tx.notasDeCredito.acreditadoDe(contexto.empresaId, factura.id),
              ) ?? "0.00",
            letraNoEsperada: factura.letraNoEsperada,
            estado: factura.estado,
          },
    correcciones: (
      await tx.correccionesDeCompra.deLaRecepcion(contexto.empresaId, recepcion.id)
    ).map((k) => ({
      linea: k.linea,
      numero: k.numero,
      precioAnterior: k.precioAnterior,
      precioNuevo: k.precioNuevo,
      precioPorTipo: k.precioPorTipo,
      unidadDePrecioId: k.unidadDePrecioId,
      cantidadAnterior: k.cantidadAnterior,
      cantidadNueva: k.cantidadNueva,
      pesoRealAnterior: k.pesoRealAnterior,
      pesoRealNuevo: k.pesoRealNuevo,
      motivo: k.motivo,
      registradoPor: k.registradoPor,
      registradoEn: k.registradoEn.toISOString(),
    })),
    pagos: pagos.map((p) => ({
      id: p.id,
      fechaDePago: p.fechaDePago,
      medio: p.medio,
      medios: mediosDeLosPagos.get(p.id) ?? [],
      importe: p.importe,
      estado: p.estado,
      registradoPor: p.registradoPor,
      registradoEn: p.registradoEn.toISOString(),
      anuladoPor: p.anuladoPor,
      anuladoEn: p.anuladoEn === null ? null : p.anuladoEn.toISOString(),
      motivoDeAnulacion: p.motivoDeAnulacion,
    })),
  });
}

/** Las compras confirmadas con alguna línea «Sin precio», de las sucursales del alcance de quien pide (hasta 200, las más nuevas primero). */
export async function comprasSinPrecioDentro(
  tx: TxDeConsultasDeCompras,
  contexto: ContextoOperativo,
): Promise<readonly CompraDeLista[]> {
  const alcance = await tx.autorizacion.sucursalesDelActor(contexto);
  const filas = await tx.lecturasDeCompras.sinPrecio(contexto.empresaId, alcance, 200);
  return armarCompras(tx, contexto, filas);
}
