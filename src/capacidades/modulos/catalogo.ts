/**
 * Catálogo comercial de módulos (ADR-003). Es código, no base de datos: de acá salen los tipos
 * cerrados `ClaveModulo`, `ClaveAccion` y `ClaveCapacidad`, así que una acción sin módulo, o un
 * permiso para una acción que no existe, no compila.
 */

export type EstadoDeConstruccion = "disponible" | "en_desarrollo";

/** Una acción del módulo. `capacidad`: la capacidad de sucursal que exige, o `null` si no exige ninguna. */
export type DefinicionDeAccion<C extends string = string> = Readonly<{ capacidad: C | null }>;

export type DefinicionDeModulo = Readonly<{
  estado: EstadoDeConstruccion;
  /** Siempre activo para toda empresa; no se guarda por empresa. */
  obligatorio: boolean;
  /** Módulos que tienen que estar activos para activar este (sin ciclos: cruce X3). */
  requiere: readonly string[];
  usaSiExiste: readonly string[];
  /** Vacío hasta H7 (`capacidades/habilitacion`). */
  datosRequeridos: readonly string[];
  /** Carpetas de `src/` que implementan el módulo, p. ej. `modulos/identidad` (cruces X1 y X4). */
  implementadoPor: readonly string[];
  acciones: Readonly<Record<string, DefinicionDeAccion>>;
}>;

export type CatalogoComercial = Readonly<Record<string, DefinicionDeModulo>>;

/**
 * Un solo módulo real: `administracion`, obligatorio (no hay tabla de módulos activos: ver la
 * especificación de H4, §B.4). Una acción por caso de uso (cruce X1); quién puede cada una se
 * define en `permisos/empresa.ts`.
 */
export const CATALOGO_DE_MODULOS = {
  administracion: {
    estado: "disponible",
    obligatorio: true,
    requiere: [],
    usaSiExiste: [],
    datosRequeridos: [],
    implementadoPor: ["modulos/identidad", "modulos/empresas"],
    acciones: {
      "usuarios.invitar": { capacidad: null },
      "usuarios.reenviar_invitacion": { capacidad: null },
      "usuarios.apagar": { capacidad: null },
      "usuarios.ver": { capacidad: null },
      "usuarios.asignar_sucursales": { capacidad: null },
      "usuarios.revocar_invitacion": { capacidad: null },
      "sucursales.ver": { capacidad: null },
      "sucursales.crear": { capacidad: null },
      "sucursales.editar": { capacidad: null },
      "sucursales.desactivar": { capacidad: null },
      "sucursales.reactivar": { capacidad: null },
      "gerencia.proponer_traspaso": { capacidad: null },
      "gerencia.cancelar_traspaso": { capacidad: null },
      "gerencia.ver_traspaso": { capacidad: null },
      "gerencia.aceptar_traspaso": { capacidad: null },
      "gerencia.rechazar_traspaso": { capacidad: null },
      "modulos.ver": { capacidad: null },
      "permisos.ver_propios": { capacidad: null },
    },
  },
} as const satisfies CatalogoComercial;

type Catalogo = typeof CATALOGO_DE_MODULOS;

export type ClaveModulo = keyof Catalogo;

export type ClaveAccion = { [M in ClaveModulo]: keyof Catalogo[M]["acciones"] }[ClaveModulo];

type CapacidadDe<D> = D extends { capacidad: infer C } ? C : never;

/** Las capacidades de sucursal que exige alguna acción. Hoy ninguna: es `never`. */
export type ClaveCapacidad = Exclude<
  {
    [M in ClaveModulo]: CapacidadDe<Catalogo[M]["acciones"][keyof Catalogo[M]["acciones"]]>;
  }[ClaveModulo],
  null
>;
