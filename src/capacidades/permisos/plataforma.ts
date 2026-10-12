import { clavesDe } from "../modulos/activos";
import type { CatalogoComercial } from "../modulos/catalogo";
import type { ReglasDelGuard } from "./guard";

/**
 * Catálogo y matriz de la PLATAFORMA (H5, especificación §B.3): el segundo catálogo tipado, hermano
 * del de empresa (`modulos/catalogo.ts` + `empresa.ts`) y del de grupo (H6). Ninguno importa a otro
 * (reglas de arquitectura): el guard genérico recibe este como PARÁMETRO, con su propio tipo de rol.
 *
 * Roles de plataforma (identidad propia, distinta de las personas de empresa): `ADMIN` hace todo;
 * `SOPORTE` ve y atiende, pero no suspende, no da de alta ni cancela, no suspende personas (F3,
 * decisión del dueño). Son datos del código; una prueba de integración los compara con el CHECK
 * `admin_plataforma_rol_ck` de la base (migración 0004).
 */
export const ROLES_DE_PLATAFORMA = ["ADMIN", "SOPORTE"] as const;

export type RolDePlataforma = (typeof ROLES_DE_PLATAFORMA)[number];

/**
 * Un único "módulo" `plataforma`, obligatorio y disponible, sin capacidades de sucursal: así el guard
 * de plataforma solo puede devolver `SIN_PERMISO` (no hay empresa, ni módulos activables, ni
 * sucursal). Una acción por caso de uso o consulta (cruce X1); quién puede cada una está abajo.
 */
export const CATALOGO_DE_PLATAFORMA = {
  plataforma: {
    estado: "disponible",
    obligatorio: true,
    requiere: [],
    usaSiExiste: [],
    datosRequeridos: [],
    implementadoPor: ["plataforma"],
    acciones: {
      "tenants.ver": { capacidad: null },
      "empresas.ver": { capacidad: null },
      "invitaciones.ver": { capacidad: null },
      "trabajos.ver_fallidos": { capacidad: null },
      "auditoria.ver": { capacidad: null },
      "configuracion.ver": { capacidad: null },
      "soporte.buscar_referencia": { capacidad: null },
      "soporte.explicar": { capacidad: null },
      "altas.reenviar_invitacion": { capacidad: null },
      "altas.revocar_invitacion": { capacidad: null },
      "empresas.alta": { capacidad: null },
      "altas.cancelar": { capacidad: null },
      "tenants.suspender": { capacidad: null },
      "tenants.reactivar": { capacidad: null },
      "empresas.suspender": { capacidad: null },
      "empresas.reactivar": { capacidad: null },
      "personas.suspender": { capacidad: null },
      "personas.reactivar": { capacidad: null },
    },
  },
} as const satisfies CatalogoComercial;

type Catalogo = typeof CATALOGO_DE_PLATAFORMA;

export type ClaveModuloDePlataforma = keyof Catalogo;

export type ClaveAccionDePlataforma = {
  [M in ClaveModuloDePlataforma]: keyof Catalogo[M]["acciones"];
}[ClaveModuloDePlataforma];

/** La plataforma no exige capacidades de sucursal: es `never`. */
export type ClaveCapacidadDePlataforma = never;

/**
 * Qué puede hacer cada rol de plataforma: una TABLA DE DATOS, no lógica. Si falta una acción del
 * catálogo, sobra una que no existe o aparece un rol que no existe, no compila. El piso es jerárquico:
 * lo que puede `SOPORTE` lo puede `ADMIN`.
 */
export const PERMISOS_DE_PLATAFORMA = {
  // Consultas de soporte (nivel 1): los dos roles.
  "tenants.ver": ["ADMIN", "SOPORTE"],
  "empresas.ver": ["ADMIN", "SOPORTE"],
  "invitaciones.ver": ["ADMIN", "SOPORTE"],
  "trabajos.ver_fallidos": ["ADMIN", "SOPORTE"],
  "auditoria.ver": ["ADMIN", "SOPORTE"],
  "configuracion.ver": ["ADMIN", "SOPORTE"],
  // Soporte (pasos 1 y 2): los dos roles.
  "soporte.buscar_referencia": ["ADMIN", "SOPORTE"],
  "soporte.explicar": ["ADMIN", "SOPORTE"],
  // La invitación del alta se reenvía y se revoca por soporte (F3).
  "altas.reenviar_invitacion": ["ADMIN", "SOPORTE"],
  "altas.revocar_invitacion": ["ADMIN", "SOPORTE"],
  // Todo lo que cambia la estructura o suspende: solo ADMIN.
  "empresas.alta": ["ADMIN"],
  "altas.cancelar": ["ADMIN"],
  "tenants.suspender": ["ADMIN"],
  "tenants.reactivar": ["ADMIN"],
  "empresas.suspender": ["ADMIN"],
  "empresas.reactivar": ["ADMIN"],
  "personas.suspender": ["ADMIN"],
  "personas.reactivar": ["ADMIN"],
} as const satisfies Record<ClaveAccionDePlataforma, readonly RolDePlataforma[]>;

export type ReglasDePlataforma = ReglasDelGuard<
  ClaveModuloDePlataforma,
  ClaveAccionDePlataforma,
  ClaveCapacidadDePlataforma,
  RolDePlataforma
>;

/** El catálogo y la matriz reales, tal como la composición se los pasa a los casos de uso de plataforma. */
export const REGLAS_DE_PLATAFORMA: ReglasDePlataforma = {
  catalogo: CATALOGO_DE_PLATAFORMA,
  permisos: PERMISOS_DE_PLATAFORMA,
};

/** La matriz leída por rol: qué acciones (ordenadas) puede cada uno. Sirve para verla y compararla. */
export function tablaDePermisosDePlataforma<A extends string>(
  permisos: Readonly<Record<A, readonly RolDePlataforma[]>>,
): Readonly<Record<RolDePlataforma, readonly A[]>> {
  const de = (rol: RolDePlataforma): A[] =>
    clavesDe(permisos)
      .filter((a) => permisos[a].includes(rol))
      .sort();
  return { ADMIN: de("ADMIN"), SOPORTE: de("SOPORTE") };
}
