import { z } from "zod";
import { ROLES_DE_EMPRESA } from "../capacidades/permisos/roles";
import {
  invitacionId,
  personaId,
  sucursalId,
  type InvitacionId,
  type PersonaId,
  type SucursalId,
} from "../primitivas/identificadores/marca";
import { ok, type Resultado } from "../primitivas/resultado/resultado";
import { identificador, leer, texto, type ErrorDeEntrada } from "./entradas-de-facturacion";

/**
 * La frontera de la pantalla «Usuarios» de Cuenta: de lo que manda el navegador a lo que recibe la composición. Solo se toma lo que el esquema declara
 * (lista blanca, campo por campo): la empresa y la persona que actúa NO se leen del pedido, salen de la sesión. Del navegador solo viaja el id de la
 * persona de la ficha (la dirección); decide el servidor si es de la empresa de la sesión (una ajena es indistinguible de una inexistente). Una forma que no
 * es un identificador no llega a la base.
 */

const formaDeFicha = z.object({ personaId: identificador });

export type EntradaDeFichaDeUsuario = Readonly<{ personaId: PersonaId }>;

export function entradaDeFichaDeUsuario(
  crudo: unknown,
): Resultado<EntradaDeFichaDeUsuario, ErrorDeEntrada> {
  const forma = leer(formaDeFicha, crudo);
  return forma.ok ? ok({ personaId: personaId(forma.valor.personaId) }) : forma;
}

/**
 * Invitar (tramo U2). Lo único que se toma del pedido es el email (la forma: texto acotado; qué es un email válido lo decide la primitiva `email` dentro del caso de uso), el rol y las sucursales.
 * El rol es una lista cerrada: los de la empresa MENOS `GERENTE` (el gerente no se invita, se traspasa). Las sucursales solo cuentan para el Empleado (`OPERADOR`): el administrador trabaja
 * en todas (plan §3, H6 F1), así que se descartan aunque lleguen. Cualquier otro campo del pedido (`empresaId`, la persona que actúa, un estado) se descarta: no es de la pantalla.
 * El tope de sucursales por pedido es defensivo (cada una es una lectura dentro de la transacción), no una regla de negocio.
 */
const MAXIMO_DE_SUCURSALES_POR_PEDIDO = 200;

const formaDeInvitar = z.object({
  email: texto,
  rol: z.enum(ROLES_DE_EMPRESA).exclude(["GERENTE"]),
  sucursales: z.array(identificador).max(MAXIMO_DE_SUCURSALES_POR_PEDIDO).default([]),
});

export type EntradaDeInvitar = Readonly<{
  email: string;
  rol: "ADMINISTRADOR" | "OPERADOR";
  sucursales: readonly SucursalId[];
}>;

export function entradaDeInvitar(crudo: unknown): Resultado<EntradaDeInvitar, ErrorDeEntrada> {
  const forma = leer(formaDeInvitar, crudo);
  if (!forma.ok) return forma;
  const { email, rol, sucursales } = forma.valor;
  return ok({
    email,
    rol,
    sucursales: rol === "OPERADOR" ? [...new Set(sucursales)].map(sucursalId) : [],
  });
}

/** Reenviar, revocar y abrir la ficha de una invitación: solo viaja el id de la dirección; decide el servidor si es de la empresa de la sesión. */
const formaDeInvitacion = z.object({ invitacionId: identificador });

export type EntradaDeInvitacion = Readonly<{ invitacionId: InvitacionId }>;

export function entradaDeInvitacion(
  crudo: unknown,
): Resultado<EntradaDeInvitacion, ErrorDeEntrada> {
  const forma = leer(formaDeInvitacion, crudo);
  return forma.ok ? ok({ invitacionId: invitacionId(forma.valor.invitacionId) }) : forma;
}

/**
 * Desactivar a una persona: el pedido lleva SOLO su id (el de la ficha). La empresa y quién pide salen de la sesión; el rol, el email y cualquier otro dato no se leen del
 * navegador (lista blanca). Misma forma que la ficha: una regla, un lugar.
 */
export type EntradaDeDesactivarUsuario = EntradaDeFichaDeUsuario;

export function entradaDeDesactivarUsuario(
  crudo: unknown,
): Resultado<EntradaDeDesactivarUsuario, ErrorDeEntrada> {
  return entradaDeFichaDeUsuario(crudo);
}

const formaDeAsignarSucursales = z.object({
  personaId: identificador,
  sucursales: z.array(identificador).max(MAXIMO_DE_SUCURSALES_POR_PEDIDO),
});

export type EntradaDeAsignarSucursalesDeUsuario = Readonly<{
  personaId: PersonaId;
  /** El conjunto FINAL de sucursales de la persona; vacío es válido (quita todas). Sin repetidos ni orden: lo decide el caso de uso. */
  sucursales: readonly SucursalId[];
}>;

/**
 * Lo que se guarda en la ficha de un empleado: la persona (la dirección) y el conjunto final de sucursales tildadas. Una forma que no es un identificador no llega a la base; de qué
 * empresa es cada id lo decide el servidor (una ajena es indistinguible de una inexistente).
 */
export function entradaDeAsignarSucursalesDeUsuario(
  crudo: unknown,
): Resultado<EntradaDeAsignarSucursalesDeUsuario, ErrorDeEntrada> {
  const forma = leer(formaDeAsignarSucursales, crudo);
  return forma.ok
    ? ok({
        personaId: personaId(forma.valor.personaId),
        sucursales: forma.valor.sucursales.map(sucursalId),
      })
    : forma;
}

/**
 * Reactivar a una persona desactivada (tramo U3, parte B): el pedido lleva SOLO el id de la persona (la dirección) y las sucursales tildadas. El email y el rol NO se leen del pedido: los toma el servidor de la
 * membresía de esa persona (la reactivación es una invitación nueva con el MISMO rol; un rol distinto lo rechaza el servidor igual). Las sucursales solo valen para el Empleado; el tope es defensivo, como en invitar.
 */
const formaDeReactivar = z.object({
  personaId: identificador,
  sucursales: z.array(identificador).max(MAXIMO_DE_SUCURSALES_POR_PEDIDO).default([]),
});

export type EntradaDeReactivarUsuario = Readonly<{
  personaId: PersonaId;
  sucursales: readonly SucursalId[];
}>;

export function entradaDeReactivarUsuario(
  crudo: unknown,
): Resultado<EntradaDeReactivarUsuario, ErrorDeEntrada> {
  const forma = leer(formaDeReactivar, crudo);
  if (!forma.ok) return forma;
  return ok({
    personaId: personaId(forma.valor.personaId),
    sucursales: [...new Set(forma.valor.sucursales)].map(sucursalId),
  });
}
