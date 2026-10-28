import { z } from "zod";
import {
  AMBIENTES,
  CODIGOS_DE_ALICUOTA,
  CONCEPTOS,
  ESTADOS_DE_COMPROBANTE_ARCA,
  MODOS_DE_PRECIO,
  TIPOS_DE_COMPROBANTE,
  TIPOS_DE_DOCUMENTO,
  TIPOS_DE_ORIGEN,
  comprobanteId,
  puntoDeVentaId,
  type EntradaDeCambiarAmbiente,
  type EntradaDeComprobanteManual,
  type EntradaDeDescartarComprobante,
  type EntradaDeNotaManual,
  type EntradaDeReintentarComprobante,
  type EntradaDeResincronizarSerie,
  type PedidoDeListado,
} from "../modulos/fiscal/publico";
import { cantidadDesdeTexto } from "../primitivas/cantidad/cantidad";
import { ErrorDeValor } from "../primitivas/cantidad/errores";
import { porcentajeDesdeTexto } from "../primitivas/cantidad/porcentaje";
import { precioUnitarioDesdeTexto } from "../primitivas/dinero/precio-unitario";
import { CONDICIONES_DE_IVA } from "../primitivas/identificacion-fiscal/condicion-iva";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";
import { fechaCivilDesdeTexto, type FechaCivil } from "../primitivas/tiempo/fecha-civil";

/**
 * La frontera de las acciones de facturación: de lo que manda el navegador (JSON sin tipo) a la entrada de cada caso
 * de uso. Es lo ÚNICO que se toma del navegador: la empresa, el emisor, el ambiente de una emisión y quién actúa salen
 * del contexto que resolvió el servidor, y cualquier otro dato que el pedido traiga se descarta (el esquema no lo
 * declara). Previene: que una acción confíe en un `empresaId` o un `emisorId` del cliente (aislamiento entre empresas).
 *
 * Dinero y cantidades llegan como TEXTO decimal (ADR-006) y se convierten con las primitivas, nunca con `Number`; las
 * fechas son `AAAA-MM-DD` (el día civil de Argentina); un número de comprobante es texto de dígitos. Esta capa solo
 * dice si el dato tiene la FORMA pedida: si es válido para el negocio (un CUIT, un total, una alícuota para esa letra)
 * lo decide el caso de uso, dentro de la transacción.
 *
 * Un dato que no tiene la forma sale como `FISCAL_DATOS_INVALIDOS` con el campo (`renglon2.cantidad`,
 * `receptor.documento.numero`...), nunca con el texto del esquema ni el valor recibido.
 */

export type ErrorDeEntrada = Readonly<{ codigo: "FISCAL_DATOS_INVALIDOS"; campo?: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const identificador = z.string().regex(UUID);
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** La forma canónica la comprueba la primitiva; acá solo se acota el largo de lo que se lee. */
const decimal = z.string().max(40);
const texto = z.string().max(1000);
/** Un entero que un formulario manda como número o como texto de dígitos (nunca `"3.5"`, `"1e3"` ni `"-1"`). */
const entero = z
  .union([
    z.number(),
    z
      .string()
      .regex(/^\d{1,10}$/)
      .transform(Number),
  ])
  .pipe(z.number().int().min(0).max(2_147_483_647));

const servicio = z.object({ desde: fecha, hasta: fecha, vencimientoDePago: fecha }).nullable();

const renglon = z.object({
  descripcion: texto,
  cantidad: decimal,
  precioUnitario: decimal,
  descuento: decimal.nullable(),
  alicuota: z.enum(CODIGOS_DE_ALICUOTA).nullable(),
});

const receptor = z.object({
  nombre: texto.nullable(),
  documento: z.union([
    z.object({ tipo: z.literal("SIN_IDENTIFICAR") }),
    z.object({ tipo: z.enum(TIPOS_DE_DOCUMENTO), numero: z.string().max(40) }),
  ]),
  condicionIva: z.enum(CONDICIONES_DE_IVA),
  domicilio: texto.nullable(),
});

const comunDeEmision = {
  clave: identificador,
  concepto: z.enum(CONCEPTOS),
  servicio,
  modoDePrecio: z.enum(MODOS_DE_PRECIO),
  renglones: z.array(renglon).max(500),
};

const formaDeFactura = z.object({
  ...comunDeEmision,
  puntoDeVentaId: identificador,
  receptor,
});

const formaDeNota = z.object({
  ...comunDeEmision,
  comprobanteAsociadoId: identificador,
  /** `null`: el punto de venta del comprobante que se corrige. */
  puntoDeVentaId: identificador.nullable(),
  motivo: texto.nullable(),
});

const formaDeDescartar = z.object({
  comprobanteId: identificador,
  motivo: texto,
  versionEsperada: entero,
});

const formaDeReintentar = z.object({ comprobanteId: identificador });

const formaDeResincronizar = z.object({
  puntoDeVentaId: identificador,
  tipo: z.enum(TIPOS_DE_COMPROBANTE),
  ambiente: z.enum(AMBIENTES),
  /** El último número que la persona vio en la pantalla (lo que informaba ARCA): texto de dígitos. */
  ultimoVistoEnArca: z.string().regex(/^(0|[1-9]\d{0,7})$/),
  motivo: texto,
});

const formaDeCambiarAmbiente = z.object({
  puntoDeVentaId: identificador,
  ambiente: z.enum(AMBIENTES),
  versionEsperada: entero,
});

const formaDeVerComprobante = z.object({ comprobanteId: identificador });

const formaDeListar = z.object({
  estado: z.enum(ESTADOS_DE_COMPROBANTE_ARCA).optional(),
  tipo: z.enum(TIPOS_DE_COMPROBANTE).optional(),
  ambiente: z.enum(AMBIENTES).optional(),
  desde: fecha.optional(),
  hasta: fecha.optional(),
  texto: texto.optional(),
  letra: z.enum(["A", "B", "C"]).optional(),
  puntoDeVenta: entero.optional(),
  origenTipo: z.enum(TIPOS_DE_ORIGEN).optional(),
  origenId: texto.optional(),
  limite: entero.optional(),
  despuesDe: texto.optional(),
});

// ---------------------------------------------------------------------------------------------------------------

/** El nombre de campo de la ruta del primer problema del esquema: `renglones.1.cantidad` → `renglon2.cantidad`. */
function campoDe(ruta: readonly PropertyKey[]): string | undefined {
  const partes: string[] = [];
  for (const [indice, parte] of ruta.entries()) {
    if (typeof parte === "number") {
      if (ruta[indice - 1] === "renglones") partes[partes.length - 1] = `renglon${parte + 1}`;
      continue;
    }
    if (typeof parte === "string") partes.push(parte);
  }
  return partes.length === 0 ? undefined : partes.join(".");
}

const invalida = (campo?: string): ErrorDeEntrada =>
  campo === undefined
    ? { codigo: "FISCAL_DATOS_INVALIDOS" }
    : { codigo: "FISCAL_DATOS_INVALIDOS", campo };

function leer<S extends z.ZodType>(
  forma: S,
  crudo: unknown,
): Resultado<z.output<S>, ErrorDeEntrada> {
  const analizado = forma.safeParse(crudo);
  if (analizado.success) return ok(analizado.data);
  return err(invalida(campoDe(analizado.error.issues[0]?.path ?? [])));
}

/** Convierte un texto con una primitiva; un valor que ella rechaza es un dato inválido de ESE campo. */
function convertir<T>(campo: string, conversion: () => T): Resultado<T, ErrorDeEntrada> {
  try {
    return ok(conversion());
  } catch (error) {
    if (error instanceof ErrorDeValor) return err(invalida(campo));
    throw error;
  }
}

function aFecha(campo: string, texto: string): Resultado<FechaCivil, ErrorDeEntrada> {
  const f = fechaCivilDesdeTexto(texto);
  return f.ok ? ok(f.valor) : err(invalida(campo));
}

type FormaDeRenglon = z.output<typeof renglon>;
type FormaDeServicio = z.output<typeof servicio>;

function aRenglones(renglones: readonly FormaDeRenglon[]) {
  const salida: EntradaDeComprobanteManual["renglones"][number][] = [];
  for (const [i, r] of renglones.entries()) {
    const campo = (nombre: string) => `renglon${i + 1}.${nombre}`;
    const cantidad = convertir(campo("cantidad"), () => cantidadDesdeTexto(r.cantidad));
    if (!cantidad.ok) return cantidad;
    const precio = convertir(campo("precioUnitario"), () =>
      precioUnitarioDesdeTexto(r.precioUnitario),
    );
    if (!precio.ok) return precio;
    const descuento =
      r.descuento === null
        ? ok(null)
        : convertir(campo("descuento"), () => porcentajeDesdeTexto(r.descuento ?? ""));
    if (!descuento.ok) return descuento;
    salida.push({
      descripcion: r.descripcion,
      cantidad: cantidad.valor,
      precioUnitario: precio.valor,
      descuento: descuento.valor,
      alicuota: r.alicuota,
    });
  }
  return ok(salida);
}

function aServicio(
  s: FormaDeServicio,
): Resultado<EntradaDeComprobanteManual["servicio"], ErrorDeEntrada> {
  if (s === null) return ok(null);
  const desde = aFecha("servicio.desde", s.desde);
  if (!desde.ok) return desde;
  const hasta = aFecha("servicio.hasta", s.hasta);
  if (!hasta.ok) return hasta;
  const vencimientoDePago = aFecha("servicio.vencimientoDePago", s.vencimientoDePago);
  if (!vencimientoDePago.ok) return vencimientoDePago;
  return ok({ desde: desde.valor, hasta: hasta.valor, vencimientoDePago: vencimientoDePago.valor });
}

// ---------------------------------------------------------------------------------------------------------------

export function entradaDeFactura(
  crudo: unknown,
): Resultado<EntradaDeComprobanteManual, ErrorDeEntrada> {
  const forma = leer(formaDeFactura, crudo);
  if (!forma.ok) return forma;
  const f = forma.valor;
  const renglones = aRenglones(f.renglones);
  if (!renglones.ok) return renglones;
  const periodo = aServicio(f.servicio);
  if (!periodo.ok) return periodo;
  return ok({
    clave: f.clave,
    puntoDeVentaId: puntoDeVentaId(f.puntoDeVentaId),
    concepto: f.concepto,
    servicio: periodo.valor,
    modoDePrecio: f.modoDePrecio,
    receptor: f.receptor,
    renglones: renglones.valor,
  });
}

export function entradaDeNota(crudo: unknown): Resultado<EntradaDeNotaManual, ErrorDeEntrada> {
  const forma = leer(formaDeNota, crudo);
  if (!forma.ok) return forma;
  const n = forma.valor;
  const renglones = aRenglones(n.renglones);
  if (!renglones.ok) return renglones;
  const periodo = aServicio(n.servicio);
  if (!periodo.ok) return periodo;
  return ok({
    clave: n.clave,
    comprobanteAsociadoId: comprobanteId(n.comprobanteAsociadoId),
    puntoDeVentaId: n.puntoDeVentaId === null ? null : puntoDeVentaId(n.puntoDeVentaId),
    concepto: n.concepto,
    servicio: periodo.valor,
    modoDePrecio: n.modoDePrecio,
    renglones: renglones.valor,
    motivo: n.motivo,
  });
}

export function entradaDeDescartar(
  crudo: unknown,
): Resultado<EntradaDeDescartarComprobante, ErrorDeEntrada> {
  const forma = leer(formaDeDescartar, crudo);
  if (!forma.ok) return forma;
  const d = forma.valor;
  return ok({
    comprobanteId: comprobanteId(d.comprobanteId),
    motivo: d.motivo,
    versionEsperada: d.versionEsperada,
  });
}

export function entradaDeReintentar(
  crudo: unknown,
): Resultado<EntradaDeReintentarComprobante, ErrorDeEntrada> {
  const forma = leer(formaDeReintentar, crudo);
  return forma.ok ? ok({ comprobanteId: comprobanteId(forma.valor.comprobanteId) }) : forma;
}

export function entradaDeResincronizar(
  crudo: unknown,
): Resultado<EntradaDeResincronizarSerie, ErrorDeEntrada> {
  const forma = leer(formaDeResincronizar, crudo);
  if (!forma.ok) return forma;
  const r = forma.valor;
  return ok({
    puntoDeVentaId: puntoDeVentaId(r.puntoDeVentaId),
    tipo: r.tipo,
    ambiente: r.ambiente,
    ultimoVistoEnArca: BigInt(r.ultimoVistoEnArca),
    motivo: r.motivo,
  });
}

export function entradaDeCambiarAmbiente(
  crudo: unknown,
): Resultado<EntradaDeCambiarAmbiente, ErrorDeEntrada> {
  const forma = leer(formaDeCambiarAmbiente, crudo);
  if (!forma.ok) return forma;
  const c = forma.valor;
  return ok({
    puntoDeVentaId: puntoDeVentaId(c.puntoDeVentaId),
    ambiente: c.ambiente,
    versionEsperada: c.versionEsperada,
  });
}

export function entradaDeVerComprobante(
  crudo: unknown,
): Resultado<Readonly<{ comprobanteId: ReturnType<typeof comprobanteId> }>, ErrorDeEntrada> {
  const forma = leer(formaDeVerComprobante, crudo);
  return forma.ok ? ok({ comprobanteId: comprobanteId(forma.valor.comprobanteId) }) : forma;
}

export function entradaDeListar(crudo: unknown): Resultado<PedidoDeListado, ErrorDeEntrada> {
  // Sin pedido (la primera vez que se abre el listado): los valores por defecto.
  const forma = leer(formaDeListar, crudo ?? {});
  if (!forma.ok) return forma;
  const l = forma.valor;
  const desde = l.desde === undefined ? ok(undefined) : aFecha("desde", l.desde);
  if (!desde.ok) return desde;
  const hasta = l.hasta === undefined ? ok(undefined) : aFecha("hasta", l.hasta);
  if (!hasta.ok) return hasta;
  // Solo se pasan las claves con valor: las opcionales del pedido no admiten `undefined` explícito.
  return ok({
    ...(l.estado === undefined ? {} : { estado: l.estado }),
    ...(l.tipo === undefined ? {} : { tipo: l.tipo }),
    ...(l.ambiente === undefined ? {} : { ambiente: l.ambiente }),
    ...(desde.valor === undefined ? {} : { desde: desde.valor }),
    ...(hasta.valor === undefined ? {} : { hasta: hasta.valor }),
    ...(l.texto === undefined ? {} : { texto: l.texto }),
    ...(l.letra === undefined ? {} : { letra: l.letra }),
    ...(l.puntoDeVenta === undefined ? {} : { puntoDeVenta: l.puntoDeVenta }),
    ...(l.origenTipo === undefined ? {} : { origenTipo: l.origenTipo }),
    ...(l.origenId === undefined ? {} : { origenId: l.origenId }),
    ...(l.limite === undefined ? {} : { limite: l.limite }),
    ...(l.despuesDe === undefined ? {} : { despuesDe: l.despuesDe }),
  });
}
