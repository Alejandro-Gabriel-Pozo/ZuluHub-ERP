import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import { personaId } from "../primitivas/identificadores/marca";
import { err, ok } from "../primitivas/resultado/resultado";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import { entradaDeFichaDeCompra, entradaDeListarCompras } from "./entradas-de-compras";
import { accionDeCompras } from "./errores-de-compras";
import type { Web } from "./web";

/**
 * Las dos lecturas de «Compras» (lista) y «Compra» (ficha) para la pantalla (Compras PR 3). Son LECTURAS: no escriben ni auditan, y repetirlas da lo mismo. La sucursal de la lista la pone
 * el servidor (nunca el pedido); la de la ficha es la de la propia compra y se valida contra el alcance de quien pide (una compra de otra sucursal u otra empresa es indistinguible de una
 * que no existe). Todo sale campo por campo (lista de permitidos): los importes como texto decimal con moneda ARS (ADR-006, nunca `number`), los instantes en ISO UTC (la pantalla los muestra
 * en hora de Argentina) y las fechas de negocio como `AAAA-MM-DD`. Los ids de persona NO salen: en su lugar va el correo (`personasParaMostrar`, una sola vez por ficha); si identidad no deja
 * ver a las personas (permiso), la ficha sale igual con el correo en `null` y no se inventa un nombre. Los errores de negocio salen como el genérico (`errores-de-compras.ts`).
 */

export type DependenciasDeComprasListaWeb = Readonly<{
  consultas: () => Pick<ReturnType<Web["consultasDeCompras"]>, "listarCompras" | "fichaDeCompra">;
  consultasDeIdentidad: () => Pick<ReturnType<Web["consultasDeIdentidad"]>, "personasParaMostrar">;
  respuesta: DependenciasDeRespuesta;
}>;

const MONEDA = "ARS";
type Importe = Readonly<{ moneda: string; monto: string }>;
const enPesos = (monto: string | null): Importe | null =>
  monto === null ? null : { moneda: MONEDA, monto };

type EstadoDeCompra = "ANULADA" | "RECIBIDA_SIN_FACTURAR" | "RECIBIDA_Y_FACTURADA";
type LetraDeFactura = "A" | "B" | "C";

export type ListaDeComprasParaLaPantalla = Readonly<{
  compras: readonly Readonly<{
    recepcionId: string;
    numero: number;
    /** El nombre del proveedor; `null` si no se puede mostrar (parte anonimizada). */
    proveedor: string | null;
    fechaNegocio: string;
    estado: EstadoDeCompra;
    /** `null` = «Sin precio» (alguna línea no tiene precio): nunca cero. */
    total: Importe | null;
    factura: Readonly<{ letra: LetraDeFactura; puntoDeVenta: number; numero: number }> | null;
  }>[];
  /** El cursor de la página que sigue; `null` en la última. */
  siguiente: string | null;
  /** El filtro que se aplicó (lo permitido de la dirección): la pantalla muestra ESTE, nunca reinterpreta la dirección. */
  filtros: Readonly<{
    estado: "TODAS" | "SIN_FACTURAR";
    desde: string | null;
    hasta: string | null;
  }>;
}>;

/** La lista de compras de la sucursal que fija el servidor, con el filtro de la dirección (lo no permitido vuelve al valor por defecto). */
export function listarLasCompras(
  d: DependenciasDeComprasListaWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<ListaDeComprasParaLaPantalla>> {
  return accionDeCompras(
    d.respuesta,
    crudo,
    entradaDeListarCompras,
    async (entrada) => {
      const r = await d.consultas().listarCompras(contexto, {
        sucursalId,
        ...(entrada.estado === "SIN_FACTURAR" ? { estado: "RECIBIDA_SIN_FACTURAR" as const } : {}),
        ...(entrada.desde === null ? {} : { desde: entrada.desde }),
        ...(entrada.hasta === null ? {} : { hasta: entrada.hasta }),
        ...(entrada.despuesDe === null ? {} : { despuesDe: entrada.despuesDe }),
      });
      return r.ok ? ok({ pagina: r.valor, entrada }) : r;
    },
    ({ pagina, entrada }) => ({
      filtros: { estado: entrada.estado, desde: entrada.desde, hasta: entrada.hasta },
      compras: pagina.compras.map((c) => ({
        recepcionId: c.recepcionId,
        numero: c.numero,
        proveedor: c.proveedorNombre,
        fechaNegocio: c.fechaNegocio,
        estado: c.estado,
        total: enPesos(c.total),
        factura:
          c.factura === null
            ? null
            : {
                letra: c.factura.letra,
                puntoDeVenta: c.factura.puntoDeVenta,
                numero: c.factura.numero,
              },
      })),
      siguiente: pagina.siguiente,
    }),
  );
}

export type FichaDeCompraParaLaPantalla = Readonly<{
  recepcionId: string;
  numero: number;
  proveedor: string | null;
  fechaNegocio: string;
  estado: EstadoDeCompra;
  remito: Readonly<{ puntoDeVenta: number; numero: number; fecha: string }> | null;
  /** El correo de quien cargó la compra; `null` si no se puede mostrar. */
  registradaPor: string | null;
  registradaEn: string;
  anulacion: Readonly<{ motivo: string; hechaPor: string | null; hechaEn: string }> | null;
  lineas: readonly Readonly<{
    numero: number;
    producto: string | null;
    /** Cantidad comprada, en la presentación (la «caja») o en la unidad de compra. */
    cantidadDeCompra: string;
    presentacion: string | null;
    unidadDeCompraId: string;
    /** Lo que entra al stock, en la unidad base del producto. */
    cantidadEnStock: string;
    unidadDeStockId: string | null;
    /** El importe vigente (con la última corrección de precio); `null` = «Sin precio». */
    importe: Importe | null;
    costoPorUnidadDeStock: Importe | null;
    /** El «precio por» de la línea: la presentación o la unidad (`unidadId`); `null` sin precio. */
    precioPor: Readonly<{ tipo: "PRESENTACION" | "UNIDAD"; unidadId: string | null }> | null;
    /** Cuántas correcciones tenía la línea cuando se miró (0 si ninguna): la versión que lleva «Corregir» para detectar que otra persona corrigió antes. */
    correccionesVistas: number;
    /** Las correcciones de PRECIO de la línea, de la más vieja a la más nueva: el precio de antes y el de ahora, el motivo, y quién y cuándo (el correo; `null` si no se puede mostrar). */
    correcciones: readonly Readonly<{
      numero: number;
      precioAnterior: Importe | null;
      precioNuevo: Importe;
      motivo: string;
      hechaPor: string | null;
      hechaEn: string;
    }>[];
  }>[];
  total: Importe | null;
  factura: Readonly<{
    /** Qué factura es: la página de «Declarar pago» la liga a su acción (no viaja en un campo del formulario). */
    comprobanteId: string;
    letra: LetraDeFactura;
    puntoDeVenta: number;
    numero: number;
    fecha: string | null;
    vencimientoDePago: string | null;
    totalSegunLaFactura: Importe;
  }> | null;
  /** Los pagos de la factura, del más viejo al más nuevo (a lo sumo uno vigente). Vacía sin factura o sin pagos. */
  pagos: readonly Readonly<{
    id: string;
    fechaDePago: string;
    medio: string;
    importe: Importe;
    estado: "VIGENTE" | "ANULADO";
    /** El correo de quien lo declaró; `null` si no se puede mostrar. */
    declaradoPor: string | null;
    declaradoEn: string;
    anuladoPor: string | null;
    anuladoEn: string | null;
    motivoDeAnulacion: string | null;
  }>[];
}>;

const MOTIVOS_DE_RECHAZO: ReadonlySet<string> = new Set([
  "MODULO_EN_DESARROLLO",
  "MODULO_NO_ACTIVO",
  "MODULO_EN_SOLO_LECTURA",
  "SIN_CAPACIDAD",
  "SIN_PERMISO",
]);

/** La ficha de una compra de la sucursal de quien pide: líneas, remito, factura si la tiene, y quién y cuándo. */
export function fichaDeLaCompra(
  d: DependenciasDeComprasListaWeb,
  contexto: ContextoOperativo,
  recepcionId: string,
): Promise<Respuesta<FichaDeCompraParaLaPantalla>> {
  return accionDeCompras(
    d.respuesta,
    { recepcionId },
    entradaDeFichaDeCompra,
    async (entrada) => {
      const ficha = await d.consultas().fichaDeCompra(contexto, entrada);
      if (!ficha.ok) return ficha;
      // Una compra que no existe, de otra empresa o de otra sucursal: el mismo error, indistinguible (el genérico).
      if (ficha.valor === null) return err("RECEPCION_NO_ENCONTRADA");
      const ids = [
        ...new Set([
          ficha.valor.registradoPor,
          ...(ficha.valor.anuladaPor === null ? [] : [ficha.valor.anuladaPor]),
          ...ficha.valor.correcciones.map((c) => c.registradoPor),
          ...ficha.valor.pagos.flatMap((p) =>
            p.anuladoPor === null ? [p.registradoPor] : [p.registradoPor, p.anuladoPor],
          ),
        ]),
      ];
      const personas = await d.consultasDeIdentidad().personasParaMostrar(contexto, { ids });
      // Sin permiso para ver personas, la ficha sale con el correo en `null`; cualquier otro fallo (base, entrada) no se esconde.
      if (
        !personas.ok &&
        !(typeof personas.error === "string" && MOTIVOS_DE_RECHAZO.has(personas.error))
      )
        return err(personas.error);
      const correos = personas.ok ? personas.valor : new Map<string, string>();
      return ok({
        ficha: ficha.valor,
        correoDe: (id: string) => correos.get(personaId(id)) ?? null,
      });
    },
    ({ ficha: f, correoDe }) => ({
      recepcionId: f.recepcionId,
      numero: f.numero,
      proveedor: f.proveedorNombre,
      fechaNegocio: f.fechaNegocio,
      estado: f.estado,
      remito:
        f.remito === null
          ? null
          : { puntoDeVenta: f.remito.puntoDeVenta, numero: f.remito.numero, fecha: f.remito.fecha },
      registradaPor: correoDe(f.registradoPor),
      registradaEn: f.hechoEn,
      anulacion:
        f.estado === "ANULADA" && f.anuladaEn !== null && f.motivoDeAnulacion !== null
          ? {
              motivo: f.motivoDeAnulacion,
              hechaPor: f.anuladaPor === null ? null : correoDe(f.anuladaPor),
              hechaEn: f.anuladaEn,
            }
          : null,
      lineas: f.lineas.map((l) => ({
        numero: l.numero,
        producto: l.productoNombre,
        cantidadDeCompra: l.cantidadDeCompra,
        presentacion: l.presentacionNombre,
        unidadDeCompraId: l.unidadDeCompraId,
        cantidadEnStock: l.cantidadEnStock,
        unidadDeStockId: l.unidadDeStockId,
        importe: enPesos(l.importeVigente),
        costoPorUnidadDeStock: enPesos(l.costoVigente),
        precioPor:
          l.precioPorTipo === null ? null : { tipo: l.precioPorTipo, unidadId: l.unidadDePrecioId },
        correccionesVistas: Math.max(
          0,
          ...f.correcciones.filter((c) => c.linea === l.numero).map((c) => c.numero),
        ),
        correcciones: f.correcciones
          .filter((c) => c.linea === l.numero && c.precioNuevo !== null)
          .map((c) => ({
            numero: c.numero,
            precioAnterior: enPesos(c.precioAnterior),
            precioNuevo: { moneda: MONEDA, monto: c.precioNuevo as string },
            motivo: c.motivo,
            hechaPor: correoDe(c.registradoPor),
            hechaEn: c.registradoEn,
          })),
      })),
      total: enPesos(f.total),
      factura:
        f.comprobante !== null &&
        f.comprobante.estado === "REGISTRADO" &&
        f.comprobante.letra !== null &&
        f.comprobante.puntoDeVenta !== null &&
        f.comprobante.numero !== null
          ? {
              comprobanteId: f.comprobante.id,
              letra: f.comprobante.letra,
              puntoDeVenta: f.comprobante.puntoDeVenta,
              numero: f.comprobante.numero,
              fecha: f.comprobante.fecha,
              vencimientoDePago: f.comprobante.vencimientoDePago,
              totalSegunLaFactura: { moneda: MONEDA, monto: f.comprobante.totalSegunFactura },
            }
          : null,
      pagos: f.pagos.map((p) => ({
        id: p.id,
        fechaDePago: p.fechaDePago,
        medio: p.medio,
        importe: { moneda: MONEDA, monto: p.importe },
        estado: p.estado === "ANULADO" ? "ANULADO" : "VIGENTE",
        declaradoPor: correoDe(p.registradoPor),
        declaradoEn: p.registradoEn,
        anuladoPor: p.anuladoPor === null ? null : correoDe(p.anuladoPor),
        anuladoEn: p.anuladoEn,
        motivoDeAnulacion: p.motivoDeAnulacion,
      })),
    }),
  );
}
