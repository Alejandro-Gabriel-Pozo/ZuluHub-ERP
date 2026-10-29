import { z } from "zod";
import {
  domicilioId,
  emisorId,
  puntoDeVentaId,
  type CasosDeUsoDeConfiguracionFiscal,
  type DomicilioDeEntrada,
  type EmisorId,
  type EntradaDeCrearPuntoDeVenta,
  type EntradaDeEditarPuntoDeVenta,
  type EntradaDeGuardarBorradorDeDatosFiscales,
  type EntradaDeCambiarElEstadoDelPuntoDeVenta,
  type EntradaDeConfirmarDatosFiscales,
} from "../modulos/fiscal/publico";
import { sucursalId } from "../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";
import {
  entero,
  identificador,
  leer as leerDeFacturacion,
  texto,
  type ErrorDeEntrada,
} from "./entradas-de-facturacion";

/**
 * La frontera de las acciones de configuración fiscal (D-43): de lo que manda el navegador (JSON sin tipo) a la entrada de cada
 * caso de uso, con las mismas reglas que `entradas-de-facturacion.ts`: solo se toma lo que el esquema declara (cualquier otro
 * dato se descarta), la empresa y la persona salen del contexto del servidor, y esta capa dice si el dato tiene la FORMA pedida;
 * si es válido para el negocio (una razón social, un número de punto de venta) lo decide el caso de uso, dentro de la transacción.
 *
 * D-45: el número y la condición de Ingresos Brutos NO se piden ni se leen: el esquema no los declara, así que el caso de uso
 * nunca los recibe y el backend los guarda vacíos. El emisor viaja en el pedido (la pantalla lo recibe de la lista, D-47) y el
 * caso de uso comprueba que sea de la empresa del contexto: el de otra empresa es indistinguible de uno que no existe.
 */

/**
 * Leer con el esquema de la pantalla. Un dato sin la forma pedida sale con el código de Configuración fiscal y su campo (D-67:
 * «Revisá los datos marcados.», no el «Revise los datos del comprobante» de las facturas). Previene: el texto de las facturas en
 * Datos fiscales y Puntos de venta.
 */
function leer<S extends z.ZodType>(
  forma: S,
  crudo: unknown,
): Resultado<z.output<S>, ErrorDeEntrada> {
  const r = leerDeFacturacion(forma, crudo);
  if (r.ok || r.error.codigo !== "FISCAL_DATOS_INVALIDOS") return r;
  return err({ ...r.error, codigo: "FISCAL_CONFIGURACION_DATOS_INVALIDOS" });
}

const domicilio = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("NUEVO"),
    id: identificador,
    calle: texto,
    numero: texto,
    piso: texto.nullable().optional(),
    departamento: texto.nullable().optional(),
    localidad: texto,
    provincia: texto,
    codigoPostal: texto.nullable().optional(),
  }),
  z.object({ tipo: z.literal("EXISTENTE"), id: identificador }),
]);

const formaDeBorrador = z.object({
  emisorId: identificador,
  /** La clave de idempotencia: la genera la pantalla al abrir el formulario. */
  borradorId: identificador,
  versionEsperada: entero.optional(),
  razonSocial: texto.optional(),
  condicionIva: texto.optional(),
  inicioActividades: texto.optional(),
  domicilio: domicilio.optional(),
});

const formaDeEmpezarCorreccion = z.object({
  emisorId: identificador,
  /** La clave de idempotencia del borrador que se crea: la genera la pantalla al pedir corregir. */
  borradorId: identificador,
});

const formaDeConfirmar = z.object({
  emisorId: identificador,
  borradorId: identificador,
  versionEsperada: entero,
  motivo: texto,
});

const formaDeEmisor = z.object({ emisorId: identificador });

const formaDeCrearPuntoDeVenta = z.object({
  id: identificador,
  emisorId: identificador,
  sucursalId: identificador,
  numero: entero,
  domicilio: domicilio.optional(),
});

const formaDeEditarPuntoDeVenta = z.object({
  puntoDeVentaId: identificador,
  versionEsperada: entero,
  numero: entero.optional(),
  sucursalId: identificador.optional(),
  domicilio: domicilio.optional(),
});

const formaDePuntoDeVenta = z.object({ puntoDeVentaId: identificador });

// ---------------------------------------------------------------------------------------------------------------

type FormaDeDomicilio = z.output<typeof domicilio>;

function aDomicilio(forma: FormaDeDomicilio): DomicilioDeEntrada {
  const id = domicilioId(forma.id);
  if (forma.tipo === "EXISTENTE") return { tipo: "EXISTENTE", id };
  return {
    tipo: "NUEVO",
    id,
    datos: {
      calle: forma.calle,
      numero: forma.numero,
      piso: forma.piso ?? null,
      departamento: forma.departamento ?? null,
      localidad: forma.localidad,
      provincia: forma.provincia,
      codigoPostal: forma.codigoPostal ?? null,
    },
  };
}

/** Solo las claves con valor: las opcionales de las entradas no admiten `undefined` explícito. */
const si = <K extends string, V>(clave: K, valor: V | undefined): { [P in K]?: V } =>
  valor === undefined ? {} : ({ [clave]: valor } as { [P in K]?: V });

export function entradaDeGuardarBorrador(
  crudo: unknown,
): Resultado<EntradaDeGuardarBorradorDeDatosFiscales, ErrorDeEntrada> {
  const forma = leer(formaDeBorrador, crudo);
  if (!forma.ok) return forma;
  const f = forma.valor;
  return ok({
    emisorId: emisorId(f.emisorId),
    borradorId: f.borradorId,
    ...si("versionEsperada", f.versionEsperada),
    cambios: {
      ...si("razonSocial", f.razonSocial),
      ...si("condicionIva", f.condicionIva),
      ...si("inicioActividades", f.inicioActividades),
    },
    ...(f.domicilio === undefined ? {} : { domicilio: aDomicilio(f.domicilio) }),
  });
}

// `publico.ts` de fiscal no puede crecer (deuda registrada): el tipo sale del caso de uso que lo declara.
type EntradaDeEmpezarCorreccionDeDatosFiscales = Parameters<
  CasosDeUsoDeConfiguracionFiscal["empezarCorreccionDeDatosFiscales"]
>[1];

/** El pedido de empezar a corregir los datos ya confirmados (D-62): el emisor y la clave del borrador que se crea. */
export function entradaDeEmpezarCorreccion(
  crudo: unknown,
): Resultado<EntradaDeEmpezarCorreccionDeDatosFiscales, ErrorDeEntrada> {
  const forma = leer(formaDeEmpezarCorreccion, crudo);
  if (!forma.ok) return forma;
  return ok({ emisorId: emisorId(forma.valor.emisorId), borradorId: forma.valor.borradorId });
}

/**
 * El pedido de confirmar los datos fiscales. D-61 (`Pedernal-docs/11-especificaciones/facturador-contratos-de-pantalla.md`, registro de
 * decisiones; confirmada por el dueño el 2026-10-29): un solo botón «Confirmar» y lo confirmado rige desde ese momento, sin fecha de
 * vigencia elegible. Por eso el pedido NO trae `vigenteDesde` (si el navegador lo manda, se descarta como cualquier dato que el
 * esquema no declara) y `ahora`, el instante del servidor, es siempre el «rige desde». Previene: versiones futuras que la pantalla no
 * muestra y `VIGENCIA_RETROACTIVA` por diferencia entre el reloj del navegador y el del servidor.
 */
export function entradaDeConfirmarDatosFiscales(
  crudo: unknown,
  ahora: Date,
): Resultado<EntradaDeConfirmarDatosFiscales, ErrorDeEntrada> {
  const forma = leer(formaDeConfirmar, crudo);
  if (!forma.ok) return forma;
  const f = forma.valor;
  return ok({
    emisorId: emisorId(f.emisorId),
    borradorId: f.borradorId,
    versionEsperada: f.versionEsperada,
    vigenteDesde: ahora,
    motivo: f.motivo,
  });
}

export function entradaDeEmisor(
  crudo: unknown,
): Resultado<Readonly<{ emisorId: EmisorId }>, ErrorDeEntrada> {
  const forma = leer(formaDeEmisor, crudo);
  return forma.ok ? ok({ emisorId: emisorId(forma.valor.emisorId) }) : forma;
}

export function entradaDeCrearPuntoDeVenta(
  crudo: unknown,
): Resultado<EntradaDeCrearPuntoDeVenta, ErrorDeEntrada> {
  const forma = leer(formaDeCrearPuntoDeVenta, crudo);
  if (!forma.ok) return forma;
  const f = forma.valor;
  return ok({
    id: f.id,
    emisorId: emisorId(f.emisorId),
    sucursalId: sucursalId(f.sucursalId),
    numero: f.numero,
    ...(f.domicilio === undefined ? {} : { domicilio: aDomicilio(f.domicilio) }),
  });
}

export function entradaDeEditarPuntoDeVenta(
  crudo: unknown,
): Resultado<EntradaDeEditarPuntoDeVenta, ErrorDeEntrada> {
  const forma = leer(formaDeEditarPuntoDeVenta, crudo);
  if (!forma.ok) return forma;
  const f = forma.valor;
  return ok({
    puntoDeVentaId: puntoDeVentaId(f.puntoDeVentaId),
    versionEsperada: f.versionEsperada,
    ...si("numero", f.numero),
    ...(f.sucursalId === undefined ? {} : { sucursalId: sucursalId(f.sucursalId) }),
    ...(f.domicilio === undefined ? {} : { domicilio: aDomicilio(f.domicilio) }),
  });
}

export function entradaDePuntoDeVenta(
  crudo: unknown,
): Resultado<EntradaDeCambiarElEstadoDelPuntoDeVenta, ErrorDeEntrada> {
  const forma = leer(formaDePuntoDeVenta, crudo);
  return forma.ok ? ok({ puntoDeVentaId: puntoDeVentaId(forma.valor.puntoDeVentaId) }) : forma;
}
