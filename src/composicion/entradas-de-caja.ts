import { z } from "zod";
import { ok, type Resultado } from "../primitivas/resultado/resultado";
import { identificador, entero, texto, leer, type ErrorDeEntrada } from "./entradas-de-facturacion";

/**
 * La frontera de las acciones de la configuración de caja (medios de pago): de lo que manda el navegador a lo que reciben los casos de uso. Solo se
 * toma lo que el esquema declara: la empresa y la persona NO se leen del pedido (las pone el servidor). Esta capa dice si el dato tiene la FORMA
 * pedida (un texto acotado, un identificador, un entero); qué es un nombre o un tipo de medio válidos lo decide el dominio de `caja`, dentro de la
 * transacción. Un campo opcional del formulario que viene vacío o en blanco es «sin nombre propio» (`null`): el dominio rechaza un blanco como
 * nombre, pero el formulario no puede mandar otra cosa cuando la persona no escribe nada.
 */

const nombreOpcional = texto
  .nullable()
  .optional()
  .transform((valor) =>
    valor === undefined || valor === null || valor.trim() === "" ? null : valor,
  );

const formaDeAlta = z.object({ tipo: texto, nombre: nombreOpcional });
const formaDeEdicion = z.object({
  medioDePagoId: identificador,
  versionEsperada: entero,
  nombre: nombreOpcional,
});
const formaDeEstado = z.object({ medioDePagoId: identificador });

/** Un campo opcional que viene vacío o en blanco es «sin dato» (`null`), igual que el nombre del medio. */
const textoOpcional = nombreOpcional;
const formaDeAltaDeCuenta = z.object({
  tipo: texto,
  nombre: texto,
  identificadorExterno: textoOpcional,
  sucursalId: identificador,
});
const formaDeEdicionDeCuenta = z.object({
  cuentaDeCobroId: identificador,
  versionEsperada: entero,
  nombre: texto,
  identificadorExterno: textoOpcional,
  sucursalId: identificador,
});
const formaDeEstadoDeCuenta = z.object({ cuentaDeCobroId: identificador });
const formaDeAltaDeCaja = z.object({ nombre: texto });
const formaDeEdicionDeCaja = z.object({
  cajaId: identificador,
  versionEsperada: entero,
  nombre: texto,
});
const formaDeEstadoDeCaja = z.object({ cajaId: identificador });

export type EntradaWebDeAltaDeMedio = Readonly<{ tipo: string; nombre: string | null }>;
export type EntradaWebDeEdicionDeMedio = Readonly<{
  medioDePagoId: string;
  versionEsperada: number;
  nombre: string | null;
}>;
export type EntradaWebDeEstadoDeMedio = Readonly<{ medioDePagoId: string }>;

export function entradaDeAltaDeMedio(
  crudo: unknown,
): Resultado<EntradaWebDeAltaDeMedio, ErrorDeEntrada> {
  const forma = leer(formaDeAlta, crudo);
  return forma.ok ? ok({ tipo: forma.valor.tipo, nombre: forma.valor.nombre }) : forma;
}

export function entradaDeEdicionDeMedio(
  crudo: unknown,
): Resultado<EntradaWebDeEdicionDeMedio, ErrorDeEntrada> {
  const forma = leer(formaDeEdicion, crudo);
  return forma.ok
    ? ok({
        medioDePagoId: forma.valor.medioDePagoId,
        versionEsperada: forma.valor.versionEsperada,
        nombre: forma.valor.nombre,
      })
    : forma;
}

export function entradaDeEstadoDeMedio(
  crudo: unknown,
): Resultado<EntradaWebDeEstadoDeMedio, ErrorDeEntrada> {
  const forma = leer(formaDeEstado, crudo);
  return forma.ok ? ok({ medioDePagoId: forma.valor.medioDePagoId }) : forma;
}

export type EntradaWebDeAltaDeCuenta = Readonly<{
  tipo: string;
  nombre: string;
  identificadorExterno: string | null;
  sucursalId: string;
}>;
export type EntradaWebDeEdicionDeCuenta = Readonly<{
  cuentaDeCobroId: string;
  versionEsperada: number;
  nombre: string;
  identificadorExterno: string | null;
  sucursalId: string;
}>;
export type EntradaWebDeEstadoDeCuenta = Readonly<{ cuentaDeCobroId: string }>;
export type EntradaWebDeAltaDeCaja = Readonly<{ nombre: string }>;
export type EntradaWebDeEdicionDeCaja = Readonly<{
  cajaId: string;
  versionEsperada: number;
  nombre: string;
}>;
export type EntradaWebDeEstadoDeCaja = Readonly<{ cajaId: string }>;

export function entradaDeAltaDeCuenta(
  crudo: unknown,
): Resultado<EntradaWebDeAltaDeCuenta, ErrorDeEntrada> {
  const forma = leer(formaDeAltaDeCuenta, crudo);
  return forma.ok ? ok({ ...forma.valor }) : forma;
}

export function entradaDeEdicionDeCuenta(
  crudo: unknown,
): Resultado<EntradaWebDeEdicionDeCuenta, ErrorDeEntrada> {
  const forma = leer(formaDeEdicionDeCuenta, crudo);
  return forma.ok ? ok({ ...forma.valor }) : forma;
}

export function entradaDeEstadoDeCuenta(
  crudo: unknown,
): Resultado<EntradaWebDeEstadoDeCuenta, ErrorDeEntrada> {
  const forma = leer(formaDeEstadoDeCuenta, crudo);
  return forma.ok ? ok({ cuentaDeCobroId: forma.valor.cuentaDeCobroId }) : forma;
}

export function entradaDeAltaDeCaja(
  crudo: unknown,
): Resultado<EntradaWebDeAltaDeCaja, ErrorDeEntrada> {
  const forma = leer(formaDeAltaDeCaja, crudo);
  return forma.ok ? ok({ nombre: forma.valor.nombre }) : forma;
}

export function entradaDeEdicionDeCaja(
  crudo: unknown,
): Resultado<EntradaWebDeEdicionDeCaja, ErrorDeEntrada> {
  const forma = leer(formaDeEdicionDeCaja, crudo);
  return forma.ok ? ok({ ...forma.valor }) : forma;
}

export function entradaDeEstadoDeCaja(
  crudo: unknown,
): Resultado<EntradaWebDeEstadoDeCaja, ErrorDeEntrada> {
  const forma = leer(formaDeEstadoDeCaja, crudo);
  return forma.ok ? ok({ cajaId: forma.valor.cajaId }) : forma;
}
