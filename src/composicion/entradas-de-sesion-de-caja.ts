import { z } from "zod";
import { DENOMINACIONES_DE_BILLETES } from "../modulos/caja/publico";
import type { ImporteJson } from "../primitivas/dinero/importe";
import { ARS } from "../primitivas/dinero/moneda";
import { ok, type Resultado } from "../primitivas/resultado/resultado";
import {
  decimal,
  entero,
  identificador,
  leer,
  texto,
  type ErrorDeEntrada,
} from "./entradas-de-facturacion";

/**
 * La frontera de las acciones de la pantalla «Caja» del mostrador (abrir, contar y cerrar, movimientos, ajustes y anulaciones): de lo que manda el navegador a lo que reciben los
 * casos de uso de caja. Solo se toma lo que el esquema declara: la empresa, la persona y la sucursal NO se leen del pedido (las pone el servidor). Esta capa dice si el dato tiene la
 * FORMA pedida; qué importe, motivo, billete o conteo son válidos para el negocio lo decide el dominio de `caja`, dentro de la transacción.
 *
 * Dinero: llega como TEXTO decimal sin signo (`montoDeLaPantalla`: dígitos y un punto; el signo y la moneda los pone esta capa, nunca el navegador) y sale como `ImporteJson` en pesos
 * (ADR-006); el tope, los decimales y el redondeo (ninguno: más de dos decimales se rechazan) los aplica el dominio. El sentido de un ajuste («Sobra» o «Falta») es una elección cerrada,
 * no un signo: el navegador no puede mandar un «sobra» con importe negativo (que el dominio leería como «falta»). Cada acción que escribe lleva la CLAVE que la pantalla generó al
 * abrir el formulario: repetirla (doble clic, reintento de red) no duplica nada.
 * Previene: que una acción confíe en una sucursal o una persona del cliente (aislamiento) y que un signo mal puesto invierta un ajuste.
 */

/** Un importe de formulario sin signo: dígitos y, si hay, un punto con decimales. El largo, el tope y los decimales válidos los decide el dominio. */
const montoDeLaPantalla = decimal.regex(/^[0-9]+(\.[0-9]+)?$/);

/** Una línea por (medio, cuenta): el dominio rechaza la repetida y la que no es de la caja; esta cota solo evita un pedido desmesurado. */
const MAXIMO_DE_LINEAS_DECLARADAS = 100;

const textoOpcional = texto
  .nullable()
  .optional()
  .transform((valor) =>
    valor === undefined || valor === null || valor.trim() === "" ? null : valor,
  );

const formaDeApertura = z.object({
  claveDeIdempotencia: identificador,
  cajaId: identificador.nullable(),
  fondoInicial: montoDeLaPantalla,
});
const formaDeSesion = z.object({ sesionId: identificador });
const formaDeCierre = z.object({
  sesionId: identificador,
  /** `null`: no contó el efectivo (el dominio lo rechaza: el efectivo se cuenta siempre). */
  conteo: z
    .object({
      billetes: z
        .array(z.object({ denominacion: entero, cantidad: entero }))
        .max(DENOMINACIONES_DE_BILLETES.length),
      /** Vacía es «sin monedas»: la pantalla suma lo no escrito como cero (maqueta `caja.html`, `efCents`). */
      monedas: z
        .union([montoDeLaPantalla, z.literal("")])
        .transform((valor) => (valor === "" ? "0.00" : valor)),
    })
    .nullable(),
  otros: z
    .array(
      z.object({
        medioDePagoId: identificador,
        cuentaDeCobroId: identificador.nullable(),
        contado: montoDeLaPantalla,
      }),
    )
    .max(MAXIMO_DE_LINEAS_DECLARADAS),
  conformeGeneral: z.boolean(),
  observacion: textoOpcional,
});
const formaDeMovimiento = z.object({
  claveDeIdempotencia: identificador,
  sesionId: identificador,
  sentido: z.enum(["INGRESO", "EGRESO"]),
  importe: montoDeLaPantalla,
  motivo: texto,
});
const formaDeAjuste = z.object({
  claveDeIdempotencia: identificador,
  sesionId: identificador,
  medioDePagoId: identificador,
  cuentaDeCobroId: identificador.nullable(),
  sentido: z.enum(["SOBRA", "FALTA"]),
  importe: montoDeLaPantalla,
  motivo: texto,
});
const formaDeAnulacion = z.object({
  claveDeIdempotencia: identificador,
  movimientoId: identificador,
  motivo: texto,
});

/** Un importe en pesos: la moneda la fija esta capa (ARS), nunca el navegador. */
const enPesos = (monto: string): ImporteJson => ({ moneda: ARS, monto });

export type EntradaWebDeApertura = Readonly<{
  claveDeIdempotencia: string;
  cajaId: string | null;
  fondoInicial: ImporteJson;
}>;
export type EntradaWebDeSesionDeCaja = Readonly<{ sesionId: string }>;
export type EntradaWebDeCierreDeCaja = Readonly<{
  sesionId: string;
  conteo: Readonly<{
    billetes: readonly Readonly<{ denominacion: number; cantidad: number }>[];
    monedas: ImporteJson;
  }> | null;
  otros: readonly Readonly<{
    medioDePagoId: string;
    cuentaDeCobroId: string | null;
    contado: ImporteJson;
  }>[];
  conformeGeneral: boolean;
  observacion: string | null;
}>;
export type EntradaWebDeMovimientoDeCaja = Readonly<{
  claveDeIdempotencia: string;
  sesionId: string;
  sentido: "INGRESO" | "EGRESO";
  importe: ImporteJson;
  motivo: string;
}>;
export type EntradaWebDeAjusteDeCaja = Readonly<{
  claveDeIdempotencia: string;
  sesionId: string;
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  /** Con signo: «Falta» resta al esperado del medio, «Sobra» suma. */
  importe: ImporteJson;
  motivo: string;
}>;
export type EntradaWebDeAnulacionDeMovimiento = Readonly<{
  claveDeIdempotencia: string;
  movimientoId: string;
  motivo: string;
}>;

export function entradaDeApertura(crudo: unknown): Resultado<EntradaWebDeApertura, ErrorDeEntrada> {
  const forma = leer(formaDeApertura, crudo);
  return forma.ok
    ? ok({
        claveDeIdempotencia: forma.valor.claveDeIdempotencia,
        cajaId: forma.valor.cajaId,
        fondoInicial: enPesos(forma.valor.fondoInicial),
      })
    : forma;
}

export function entradaDeSesionDeCaja(
  crudo: unknown,
): Resultado<EntradaWebDeSesionDeCaja, ErrorDeEntrada> {
  const forma = leer(formaDeSesion, crudo);
  return forma.ok ? ok({ sesionId: forma.valor.sesionId }) : forma;
}

export function entradaDeCierreDeCaja(
  crudo: unknown,
): Resultado<EntradaWebDeCierreDeCaja, ErrorDeEntrada> {
  const forma = leer(formaDeCierre, crudo);
  if (!forma.ok) return forma;
  const { sesionId, conteo, otros, conformeGeneral, observacion } = forma.valor;
  return ok({
    sesionId,
    conteo:
      conteo === null ? null : { billetes: conteo.billetes, monedas: enPesos(conteo.monedas) },
    otros: otros.map((o) => ({
      medioDePagoId: o.medioDePagoId,
      cuentaDeCobroId: o.cuentaDeCobroId,
      contado: enPesos(o.contado),
    })),
    conformeGeneral,
    observacion,
  });
}

export function entradaDeMovimientoDeCaja(
  crudo: unknown,
): Resultado<EntradaWebDeMovimientoDeCaja, ErrorDeEntrada> {
  const forma = leer(formaDeMovimiento, crudo);
  return forma.ok
    ? ok({
        claveDeIdempotencia: forma.valor.claveDeIdempotencia,
        sesionId: forma.valor.sesionId,
        sentido: forma.valor.sentido,
        importe: enPesos(forma.valor.importe),
        motivo: forma.valor.motivo,
      })
    : forma;
}

export function entradaDeAjusteDeCaja(
  crudo: unknown,
): Resultado<EntradaWebDeAjusteDeCaja, ErrorDeEntrada> {
  const forma = leer(formaDeAjuste, crudo);
  return forma.ok
    ? ok({
        claveDeIdempotencia: forma.valor.claveDeIdempotencia,
        sesionId: forma.valor.sesionId,
        medioDePagoId: forma.valor.medioDePagoId,
        cuentaDeCobroId: forma.valor.cuentaDeCobroId,
        importe: enPesos(
          forma.valor.sentido === "FALTA" ? `-${forma.valor.importe}` : forma.valor.importe,
        ),
        motivo: forma.valor.motivo,
      })
    : forma;
}

export function entradaDeAnulacionDeMovimiento(
  crudo: unknown,
): Resultado<EntradaWebDeAnulacionDeMovimiento, ErrorDeEntrada> {
  const forma = leer(formaDeAnulacion, crudo);
  return forma.ok ? ok({ ...forma.valor }) : forma;
}
