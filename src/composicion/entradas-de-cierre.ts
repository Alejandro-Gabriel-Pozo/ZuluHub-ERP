import { z } from "zod";
import { ARS } from "../primitivas/dinero/moneda";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";
import { decimal, identificador, texto } from "./entradas-de-facturacion";

/**
 * La frontera de las acciones de la pantalla «Cierre del día»: de lo que manda el navegador (JSON sin tipo) a lo que reciben los casos de uso de `cierre` y de `caja`. Solo se
 * toma lo que el esquema declara: la empresa, la persona y la SUCURSAL no se leen del pedido (las pone el servidor: la elegida en el dispositivo y validada). Esta capa dice
 * si el dato tiene la FORMA pedida (un identificador, una fecha `AAAA-MM-DD`, un texto acotado, un importe como texto decimal); qué es un motivo, un importe o una fecha
 * válidos lo decide el caso de uso, dentro de su transacción. Un campo de más en el pedido se descarta; uno de menos o de otra forma es `ENTRADA_INVALIDA` (sin el valor
 * recibido ni el texto del esquema). El dinero viaja como TEXTO decimal (ADR-006): acá nunca pasa por `number`.
 * Previene: que una acción confíe en una empresa, una sucursal o una persona que mande el navegador (aislamiento entre empresas) y que un importe pierda un centavo por el camino.
 */

export type ErrorDeEntradaDeCierre = "ENTRADA_INVALIDA";

const FORMA_DE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const fecha = z.string().regex(FORMA_DE_FECHA);
/** Una clave de idempotencia es un texto acotado: su forma exacta (la de la base) la decide el caso de uso. */
const clave = texto;
/** Lo que se ve de los controles al cerrar: la huella del servidor, un texto acotado; si no es la actual, el cierre responde que cambiaron. */
const huella = texto;

function leer<S extends z.ZodType>(
  forma: S,
  crudo: unknown,
): Resultado<z.output<S>, ErrorDeEntradaDeCierre> {
  const analizado = forma.safeParse(crudo);
  return analizado.success ? ok(analizado.data) : err("ENTRADA_INVALIDA");
}

const formaDeJornada = z.object({ fechaDeNegocio: fecha });
const formaDeCerrar = z.object({
  fechaDeNegocio: fecha,
  huellaVista: huella,
  reconocimientos: z
    .array(z.object({ modulo: texto, clave: texto, texto: texto.nullable() }))
    .max(100),
});
const formaDeCorregir = z.object({
  claveDeIdempotencia: clave,
  cobroId: identificador,
  medioDestinoId: identificador,
  cuentaDestinoId: identificador.nullable(),
  motivo: texto,
});
const formaDeDeclarar = z.object({
  claveDeIdempotencia: clave,
  fechaDeNegocio: fecha,
  medioDePagoId: identificador,
  cuentaDeCobroId: identificador.nullable(),
  importe: decimal,
});
const formaDeConforme = z.object({ claveDeIdempotencia: clave, fechaDeNegocio: fecha });

export type EntradaWebDeJornada = Readonly<{ fechaDeNegocio: string }>;
export type EntradaWebDeCerrarElDia = Readonly<{
  fechaDeNegocio: string;
  huellaVista: string;
  reconocimientos: readonly Readonly<{ modulo: string; clave: string; texto: string | null }>[];
}>;
export type EntradaWebDeCorregirElMedio = Readonly<{
  claveDeIdempotencia: string;
  cobroId: string;
  medioDestinoId: string;
  cuentaDestinoId: string | null;
  motivo: string;
}>;
export type EntradaWebDeDeclararElTotal = Readonly<{
  claveDeIdempotencia: string;
  fechaDeNegocio: string;
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  importe: Readonly<{ moneda: string; monto: string }>;
}>;
export type EntradaWebDeDarElConforme = Readonly<{
  claveDeIdempotencia: string;
  fechaDeNegocio: string;
}>;

/** Empezar o cancelar el cierre: solo la jornada (la sucursal la pone el servidor). */
export function entradaDeJornadaDelCierre(
  crudo: unknown,
): Resultado<EntradaWebDeJornada, ErrorDeEntradaDeCierre> {
  const forma = leer(formaDeJornada, crudo);
  return forma.ok ? ok({ fechaDeNegocio: forma.valor.fechaDeNegocio }) : forma;
}

/** Cerrar el día: la jornada, la huella de lo que se vio y qué controles se reconocen con su observación opcional (en blanco es «sin observación»). */
export function entradaDeCerrarElDia(
  crudo: unknown,
): Resultado<EntradaWebDeCerrarElDia, ErrorDeEntradaDeCierre> {
  const forma = leer(formaDeCerrar, crudo);
  return forma.ok
    ? ok({
        fechaDeNegocio: forma.valor.fechaDeNegocio,
        huellaVista: forma.valor.huellaVista,
        reconocimientos: forma.valor.reconocimientos.map((r) => ({
          modulo: r.modulo,
          clave: r.clave,
          texto: r.texto === null || r.texto.trim() === "" ? null : r.texto,
        })),
      })
    : forma;
}

export function entradaDeCorregirElMedio(
  crudo: unknown,
): Resultado<EntradaWebDeCorregirElMedio, ErrorDeEntradaDeCierre> {
  const forma = leer(formaDeCorregir, crudo);
  return forma.ok ? ok({ ...forma.valor }) : forma;
}

/** Declarar el total de un medio: el importe llega como texto decimal canónico y sale con su moneda (v1 solo ARS, como `CampoImporte`). */
export function entradaDeDeclararElTotal(
  crudo: unknown,
): Resultado<EntradaWebDeDeclararElTotal, ErrorDeEntradaDeCierre> {
  const forma = leer(formaDeDeclarar, crudo);
  return forma.ok
    ? ok({
        claveDeIdempotencia: forma.valor.claveDeIdempotencia,
        fechaDeNegocio: forma.valor.fechaDeNegocio,
        medioDePagoId: forma.valor.medioDePagoId,
        cuentaDeCobroId: forma.valor.cuentaDeCobroId,
        importe: { moneda: ARS, monto: forma.valor.importe },
      })
    : forma;
}

export function entradaDeDarElConforme(
  crudo: unknown,
): Resultado<EntradaWebDeDarElConforme, ErrorDeEntradaDeCierre> {
  const forma = leer(formaDeConforme, crudo);
  return forma.ok ? ok({ ...forma.valor }) : forma;
}
