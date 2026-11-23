import type { ContextoOperativo } from "../../../contexto/contexto";
import { fechaCivilDesdeTexto } from "../../../primitivas/tiempo/fecha-civil";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { CodigoDeUnidad } from "../../../primitivas/unidades/unidades";
import { crearDirectorioDePartes } from "../../clientes/publico";
import {
  FICHA_DE_TIPO_DE_COMPROBANTE,
  type TipoDeComprobanteDeProveedor,
} from "../dominio/comprobante";
import { importeVigenteDeLinea, totalDeCompra } from "../dominio/importe-vigente";
import { estadoDerivadoDeCompra, type EstadoDeCompra } from "../dominio/niveles";
import { esUuid } from "../dominio/identificadores";
import type { CorreccionGuardada } from "../persistencia/repositorio-de-correcciones";
import type { LineaDeRecepcion, Recepcion } from "../persistencia/repositorio-de-recepciones";
import type {
  FilaDeListaDeCompras,
  FiltroDeCompras,
} from "../persistencia/repositorio-de-lecturas-de-compras";
import type { TxDeConsultasDeCompras } from "./contrato";

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

/** La factura vigente de una compra, tal como la nombra la fila de la lista. */
export type FacturaDeLista = Readonly<{
  tipo: TipoDeComprobanteDeProveedor;
  /** La letra del tipo: A, B o C. */
  letra: "A" | "B" | "C";
  puntoDeVenta: number;
  numero: number;
}>;

export type CompraDeLista = Readonly<{
  recepcionId: string;
  numero: number;
  sucursalId: string;
  proveedorId: string;
  /** El nombre del proveedor para mostrar (también si está desactivado); `null` si la parte está anonimizada. */
  proveedorNombre: string | null;
  fechaNegocio: string;
  remito: Recepcion["remito"];
  estado: EstadoDeCompra;
  /** Texto decimal de 2 decimales en pesos (ARS): la suma de los importes VIGENTES de las líneas; `null` («Sin precio») si alguna línea no tiene precio, nunca cero. */
  total: string | null;
  /** La factura vigente (registrada), o `null` si no tiene. */
  factura: FacturaDeLista | null;
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
export const FORMA_DEL_CURSOR = /^(\d{4}-\d{2}-\d{2})\|([1-9]\d{0,9})$/;
const NUMERO_MAXIMO_DE_COMPRA = 2_147_483_647;

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
    if (
      partes === null ||
      numero > NUMERO_MAXIMO_DE_COMPRA ||
      !fechaCivilDesdeTexto(partes[1] as string).ok
    ) {
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

const claveDeLinea = (recepcionId: string, numero: number): string => `${recepcionId}|${numero}`;

/**
 * El importe vigente de cada línea (clave `recepcionId|número`) de esas recepciones: lecturas por lote, constantes por página (las líneas, la última corrección
 * de cada línea corregida y, solo para las corregidas, los productos y las presentaciones). Es la ÚNICA cuenta: la lista suma estos importes y la ficha los muestra.
 * Un dato que no se puede leer para recalcular una línea corregida es un error de integridad: se lanza, no se esconde detrás de «Sin precio».
 */
async function importesVigentes(
  tx: TxDeConsultasDeCompras,
  contexto: ContextoOperativo,
  recepcionIds: readonly string[],
): Promise<
  Readonly<{
    lineas: readonly (LineaDeRecepcion & Readonly<{ recepcionId: string }>)[];
    importes: ReadonlyMap<string, string | null>;
    /** Las líneas (clave `recepcionId|número`) que tienen alguna corrección de precio. */
    corregidas: ReadonlySet<string>;
  }>
> {
  const empresa = contexto.empresaId;
  const lineas = await tx.recepciones.lineasDeVarias(empresa, recepcionIds);
  const ultimas = new Map<string, CorreccionGuardada>(
    (await tx.correccionesDeCompra.ultimasDeVarias(empresa, recepcionIds)).map((c) => [
      claveDeLinea(c.recepcionId, c.linea),
      c,
    ]),
  );
  const corregidas = lineas.filter((l) => ultimas.has(claveDeLinea(l.recepcionId, l.numero)));
  const productos = new Map(
    (
      await tx.productosParaCompras.deVarios(
        empresa,
        corregidas.map((l) => l.productoId),
      )
    ).map((p) => [p.id, p]),
  );
  const presentaciones = new Map(
    (
      await tx.presentacionesDeProducto.obtenerVarias(
        empresa,
        corregidas.flatMap((l) => (l.presentacionId === null ? [] : [l.presentacionId])),
      )
    ).map((p) => [p.id, p]),
  );
  const importes = new Map<string, string | null>();
  for (const l of lineas) {
    const clave = claveDeLinea(l.recepcionId, l.numero);
    const correccion = ultimas.get(clave) ?? null;
    const producto = productos.get(l.productoId);
    const presentacion =
      l.presentacionId === null ? undefined : presentaciones.get(l.presentacionId);
    const contextoDeLinea =
      correccion === null ||
      producto === undefined ||
      (l.presentacionId !== null && presentacion === undefined)
        ? null
        : {
            unidadBase: producto.unidadBaseId as CodigoDeUnidad,
            presentacion:
              presentacion === undefined
                ? null
                : {
                    cantidadEnBase: presentacion.cantidad,
                    dePesoVariable: presentacion.dePesoVariable,
                  },
          };
    const r = importeVigenteDeLinea(l, correccion, contextoDeLinea);
    if (!r.ok) {
      throw new Error(
        `No se pudo recalcular la línea ${l.numero} de la compra ${l.recepcionId}: ${r.error}`,
      );
    }
    importes.set(clave, r.valor);
  }
  return { lineas, importes, corregidas: new Set(ultimas.keys()) };
}

/** Las filas de una página como compras de la lista, con proveedor, total y factura leídos por lote en la MISMA transacción. */
async function armarCompras(
  tx: TxDeConsultasDeCompras,
  contexto: ContextoOperativo,
  filas: readonly FilaDeListaDeCompras[],
): Promise<readonly CompraDeLista[]> {
  if (filas.length === 0) return [];
  const empresa = contexto.empresaId;
  const ids = filas.map((f) => f.id);
  const { lineas, importes } = await importesVigentes(tx, contexto, ids);
  const nombres = await directorio.nombresParaMostrar(
    tx,
    empresa,
    filas.map((f) => f.proveedorId),
  );
  const facturas = new Map(
    (await tx.comprobantesDeProveedor.deVariasRecepciones(empresa, ids)).map((c) => [
      c.recepcionId,
      c,
    ]),
  );
  return filas.map((f) => {
    const comprobante = facturas.get(f.id);
    const factura: FacturaDeLista | null =
      comprobante !== undefined &&
      comprobante.estado === "REGISTRADO" &&
      comprobante.tipo !== null &&
      FICHA_DE_TIPO_DE_COMPROBANTE[comprobante.tipo].clase === "FACTURA" &&
      comprobante.puntoDeVenta !== null &&
      comprobante.numero !== null
        ? {
            tipo: comprobante.tipo,
            letra: FICHA_DE_TIPO_DE_COMPROBANTE[comprobante.tipo].letra,
            puntoDeVenta: comprobante.puntoDeVenta,
            numero: comprobante.numero,
          }
        : null;
    return {
      recepcionId: f.id,
      numero: f.numero,
      sucursalId: f.sucursalId,
      proveedorId: f.proveedorId,
      proveedorNombre: nombres.get(f.proveedorId) ?? null,
      fechaNegocio: f.fechaNegocio,
      remito: f.remito,
      estado: estadoDerivadoDeCompra(f.estado, f.comprobanteEstado),
      total: totalDeCompra(
        lineas
          .filter((l) => l.recepcionId === f.id)
          .map((l) => importes.get(claveDeLinea(f.id, l.numero)) ?? null),
      ),
      factura,
    };
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
    letraNoEsperada: boolean;
    estado: string;
  }> | null;
  /** Las correcciones de precio de las líneas, por línea y número: la línea original no se edita, el precio vigente de cada una es el de su última corrección. */
  correcciones: readonly Readonly<{
    linea: number;
    numero: number;
    precioAnterior: string | null;
    precioNuevo: string | null;
    motivo: string;
    registradoPor: string;
    registradoEn: string;
  }>[];
  /** Todos los pagos de la factura, del más viejo al más nuevo (el vigente tiene `estado: "VIGENTE"`). */
  pagos: readonly Readonly<{
    id: string;
    fechaDePago: string;
    medio: string;
    importe: string;
    estado: string;
    registradoPor: string;
    anuladoPor: string | null;
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
      motivo: k.motivo,
      registradoPor: k.registradoPor,
      registradoEn: k.registradoEn.toISOString(),
    })),
    pagos: pagos.map((p) => ({
      id: p.id,
      fechaDePago: p.fechaDePago,
      medio: p.medio,
      importe: p.importe,
      estado: p.estado,
      registradoPor: p.registradoPor,
      anuladoPor: p.anuladoPor,
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
