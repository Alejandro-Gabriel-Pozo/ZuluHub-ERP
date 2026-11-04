import { z } from "zod";
import type { EntradaDeEditarSucursal } from "../modulos/empresas/publico";
import { sucursalId, type SucursalId } from "../primitivas/identificadores/marca";
import { ok, type Resultado } from "../primitivas/resultado/resultado";
import { leer } from "./entradas-de-configuracion-fiscal";
import { entero, identificador, texto, type ErrorDeEntrada } from "./entradas-de-facturacion";

/**
 * La frontera de las acciones de la sucursal elegida (D-113: «Contacto de la sucursal»): de lo que manda el navegador a lo que reciben
 * la consulta y el caso de uso. Solo se toma lo que el esquema declara: la empresa, la persona y el NOMBRE de la sucursal no se leen del
 * pedido (el nombre lo pone el servidor, ver `contacto-de-sucursal-web.ts`). Esta capa dice si el dato tiene la FORMA pedida (un texto
 * acotado); qué es un teléfono, un correo o una web válidos lo deciden las primitivas de `primitivas/contacto`, dentro de la transacción.
 * Un dato sin forma sale como `FISCAL_CONFIGURACION_DATOS_INVALIDOS` con su campo («Revisá los datos marcados.», D-67).
 */

/**
 * `null` o ausente: la persona todavía no eligió sucursal; qué pasa entonces lo decide el servidor (`resolverSucursal`), nunca «todas».
 * Un valor que no es un identificador es un dato inválido de `sucursalId`.
 */
const sucursal = identificador.nullable().optional();

const formaDeFicha = z.object({ sucursalId: sucursal });

/** `undefined` (ausente) no toca el dato; `null` o un texto en blanco lo borra: lo decide el dominio. */
const formaDeContacto = z.object({
  sucursalId: sucursal,
  versionEsperada: entero,
  telefono: texto.nullable().optional(),
  correo: texto.nullable().optional(),
  web: texto.nullable().optional(),
});

export type EntradaDeFichaDeContacto = Readonly<{ sucursalId: SucursalId | null }>;

/** Lo que pide la acción de editar el contacto: lo de `EntradaDeEditarSucursal` sin el nombre (que no es de esta pantalla). */
export type EntradaDeEditarContacto = Readonly<{
  sucursalId: SucursalId | null;
  versionEsperada: number;
}> &
  Pick<EntradaDeEditarSucursal, "telefono" | "correo" | "web">;

const aSucursal = (id: string | null | undefined): SucursalId | null =>
  id === null || id === undefined ? null : sucursalId(id);

export function entradaDeFichaDeContacto(
  crudo: unknown,
): Resultado<EntradaDeFichaDeContacto, ErrorDeEntrada> {
  const forma = leer(formaDeFicha, crudo);
  return forma.ok ? ok({ sucursalId: aSucursal(forma.valor.sucursalId) }) : forma;
}

export function entradaDeEditarContacto(
  crudo: unknown,
): Resultado<EntradaDeEditarContacto, ErrorDeEntrada> {
  const forma = leer(formaDeContacto, crudo);
  if (!forma.ok) return forma;
  const f = forma.valor;
  return ok({
    sucursalId: aSucursal(f.sucursalId),
    versionEsperada: f.versionEsperada,
    telefono: f.telefono,
    correo: f.correo,
    web: f.web,
  });
}
