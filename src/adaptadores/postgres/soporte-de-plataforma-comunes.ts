import type { EstadoDeEmpresa, EstadoDeTenant } from "../../contexto/estados";
import {
  emailDesdeTexto,
  type EstadoGuardado,
  type TipoDeInvitacion,
} from "../../modulos/identidad/publico";
import type { Dato } from "../../puertos/sin-secretos";

export const ESTADOS_DE_EMPRESA: readonly EstadoDeEmpresa[] = [
  "PROVISIONING",
  "ACTIVE",
  "SUSPENDED",
  "CANCELLED",
  "DELETING",
];
export const ESTADOS_DE_TENANT: readonly EstadoDeTenant[] = ["ACTIVE", "SUSPENDED"];
export const TIPOS_DE_INVITACION: readonly TipoDeInvitacion[] = ["ALTA_GERENTE", "USUARIO"];
export const ESTADOS_DE_INVITACION: readonly EstadoGuardado[] = [
  "PENDIENTE",
  "ACEPTADA",
  "REVOCADA",
];

/** Un valor de la base que el CHECK correspondiente no deja pasar: si llega otro, algo se rompió. */
export function deLaLista<T extends string>(lista: readonly T[], valor: string, nombre: string): T {
  const encontrado = lista.find((v) => v === valor);
  if (encontrado === undefined) throw new RangeError(`${nombre} desconocido en la base: ${valor}`);
  return encontrado;
}

export function aEmail(texto: string) {
  const r = emailDesdeTexto(texto);
  if (!r.ok) throw new RangeError("email guardado inválido en la base");
  return r.valor;
}

/** Un `jsonb` que es un objeto (el driver ya lo trae parseado); `null` si no hay o no es un objeto. */
export const objetoODeNulo = (valor: unknown): Readonly<Record<string, unknown>> | null =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor)
    ? (valor as Readonly<Record<string, unknown>>)
    : null;

/** El contenido de una columna `jsonb` (el driver ya lo trae parseado) como dato; `null` si no hay. */
export const aDato = (valor: unknown): Dato => (valor ?? null) as Dato;

/** Las columnas de marca y plan vigente que trae `tenantsConMarcaYPlan` (el plan es todo nulo si ninguna asignación empezó). */
export type ColumnasDeMarcaYPlan = {
  marca_id: string;
  marca_codigo: string;
  marca_nombre_visible: string | null;
  version_de_plan_id: string | null;
  plan_id: string | null;
  plan_codigo: string | null;
  plan_nombre_comercial: string | null;
  plan_version_numero: number | null;
  plan_programado: unknown;
};
