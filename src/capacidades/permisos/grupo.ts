import type { CatalogoComercial } from "../modulos/catalogo";
import type { ReglasDelGuard } from "./guard";

/**
 * Catálogo y matriz del GRUPO (H6, especificación §B.4): el tercer catálogo tipado, hermano del de
 * empresa (`modulos/catalogo.ts` + `empresa.ts`) y del de plataforma (`plataforma.ts`). Ninguno
 * importa a otro (reglas de arquitectura): el guard genérico recibe este como PARÁMETRO, con su
 * propio tipo de rol.
 *
 * El grupo es la vista de solo lectura del dueño del tenant (R3). Su único rol es `PROPIETARIO`, que
 * ya impone la base (`es_propietario_activo` en las políticas del rol `zuluhub_grupo`); el guard lo
 * repite en el servidor con el dato leído dentro de la transacción. Es un dato del código: una prueba
 * de integración lo compara con el CHECK `membresia_tenant_rol_ck`.
 *
 * `grupo.invitar` NO existe: es una función de pago futura y se agrega cuando se venda, con su ADR
 * (decisión 3). Tampoco hay `grupo.ver_datos`: en la etapa 1 la vista solo muestra empresas y estados.
 */
export const ROLES_DE_GRUPO = ["PROPIETARIO"] as const;

export type RolDeGrupo = (typeof ROLES_DE_GRUPO)[number];

/**
 * Un único "módulo" `grupo`, obligatorio y disponible, sin capacidades de sucursal: así el guard de
 * grupo solo puede devolver `SIN_PERMISO` (no hay empresa ni módulos activables). La vista de grupo no
 * se condiciona por plan hasta que existan las perillas (supuesto declarado de H6). Una acción por
 * consulta (cruce X1); quién puede cada una está abajo.
 */
export const CATALOGO_DE_GRUPO = {
  grupo: {
    estado: "disponible",
    obligatorio: true,
    requiere: [],
    usaSiExiste: [],
    datosRequeridos: [],
    implementadoPor: ["consultas-de-grupo"],
    acciones: {
      // Consulta: lee y deja su registro de acceso (D11). El núcleo (obligatorio) nunca está en solo lectura.
      "grupo.ver_empresas": { capacidad: null, efecto: "LECTURA" },
    },
  },
} as const satisfies CatalogoComercial;

type Catalogo = typeof CATALOGO_DE_GRUPO;

export type ClaveModuloDeGrupo = keyof Catalogo;

export type ClaveAccionDeGrupo = {
  [M in ClaveModuloDeGrupo]: keyof Catalogo[M]["acciones"];
}[ClaveModuloDeGrupo];

/** El grupo no exige capacidades de sucursal: es `never`. */
export type ClaveCapacidadDeGrupo = never;

/**
 * Qué puede hacer cada rol de grupo: una TABLA DE DATOS, no lógica. Si falta una acción del catálogo,
 * sobra una que no existe o aparece un rol que no existe, no compila.
 */
export const PERMISOS_DE_GRUPO = {
  "grupo.ver_empresas": ["PROPIETARIO"],
} as const satisfies Record<ClaveAccionDeGrupo, readonly RolDeGrupo[]>;

export type ReglasDeGrupo = ReglasDelGuard<
  ClaveModuloDeGrupo,
  ClaveAccionDeGrupo,
  ClaveCapacidadDeGrupo,
  RolDeGrupo
>;

/** El catálogo y la matriz reales, tal como la composición se los pasa a las consultas de grupo. */
export const REGLAS_DE_GRUPO: ReglasDeGrupo = {
  catalogo: CATALOGO_DE_GRUPO,
  permisos: PERMISOS_DE_GRUPO,
};
