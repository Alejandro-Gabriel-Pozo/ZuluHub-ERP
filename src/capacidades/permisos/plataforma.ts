import { clavesDe } from "../modulos/activos";
import type { DefinicionDeAccion, DefinicionDeModulo } from "../modulos/catalogo";
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

/** Una acción de plataforma: lo de toda acción más si exige el segundo factor reciente (h5-p8 §2.4 bis). */
export type DefinicionDeAccionDePlataforma = DefinicionDeAccion<never> &
  Readonly<{ segundoFactorReciente: boolean }>;

/** La forma del catálogo de plataforma: el catálogo comercial con la acción ampliada (el guard solo lee lo común). */
type CatalogoDePlataforma = Readonly<
  Record<
    string,
    Omit<DefinicionDeModulo, "acciones"> &
      Readonly<{ acciones: Readonly<Record<string, DefinicionDeAccionDePlataforma>> }>
  >
>;

/**
 * Un único "módulo" `plataforma`, obligatorio y disponible, sin capacidades de sucursal: así el guard
 * de plataforma solo puede devolver `SIN_PERMISO` (no hay empresa, ni módulos activables, ni
 * sucursal). Una acción por caso de uso o consulta (cruce X1); quién puede cada una está abajo.
 *
 * Es obligatorio: nunca está en solo lectura (el guard lo ignora en los módulos obligatorios). El
 * `efecto` se declara igual, por uniformidad del tipo y para que ninguna acción quede sin clasificar:
 * mirar es `LECTURA`; dar de alta, y reactivar lo suspendido, es `CREA_AMPLIA`; suspender, cancelar un
 * alta y reenviar o revocar su invitación es `COMPLETA_CIERRA`. Con el mismo criterio, en marcas y
 * planes: crear, editar un borrador, confirmar o publicar una versión, agregar, verificar o activar un
 * dominio, asignar un plan, ajustar una perilla y activar un módulo son `CREA_AMPLIA` (una asignación
 * puede subir o bajar de plan: ante la duda manda la más amplia); retirar o desactivar un dominio y
 * desactivar un módulo, que quitan algo ya dado, son `COMPLETA_CIERRA`.
 *
 * Dominios (M4a): `dominios.verificar` es `CREA_AMPLIA` porque deja el host a un paso de servir su
 * superficie (el dominio verificado ya se puede activar) y ante la duda manda la más amplia;
 * `dominios.activar` es `CREA_AMPLIA` porque expone una superficie pública nueva; `dominios.desactivar`
 * es `COMPLETA_CIERRA` porque deja de servir y vuelve a la página neutra, sin crear nada.
 *
 * `segundoFactorReciente` (h5-p8 §2.4 bis, DECIDIDO por el dueño el 2026-10-20): obligatorio en TODA acción (una sin
 * declarar no compila). `true`: la acción tiene efecto sobre clientes o es de alto alcance y la puerta de la consola
 * la rechaza con `segundo_factor_reciente_requerido` si el segundo factor de la sesión tiene más de 5 minutos. Lo
 * decide el servidor por acción, nunca la pantalla. Exigen: confirmar versión de marca; publicar versión de plan;
 * asignar plan y migrar tenants de versión (`planes.asignar`); ajustar perilla; alta de empresa; cancelar alta;
 * suspender y reactivar tenant, empresa y persona; agregar, verificar, activar, desactivar y retirar dominio; activar y
 * desactivar módulo de empresa. NO exigen: toda lectura y consulta; guardar borrador de marca y de plan (no tienen
 * efecto hasta confirmar o publicar, y pedir el código en cada guardado volvería inusable la edición); reenviar y
 * revocar la invitación del alta; `soporte.explicar`; y, por decisión de criterio del ingeniero (no están en la lista del
 * dueño), `marcas.crear` y `planes.crear`: crean un borrador vacío sin efecto sobre ningún cliente hasta que se
 * confirme la versión o se publique el plan, que sí lo exigen. Una prueba fija la lista exacta.
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
      "tenants.ver": { capacidad: null, efecto: "LECTURA", segundoFactorReciente: false },
      "empresas.ver": { capacidad: null, efecto: "LECTURA", segundoFactorReciente: false },
      "invitaciones.ver": { capacidad: null, efecto: "LECTURA", segundoFactorReciente: false },
      "trabajos.ver_fallidos": { capacidad: null, efecto: "LECTURA", segundoFactorReciente: false },
      "auditoria.ver": { capacidad: null, efecto: "LECTURA", segundoFactorReciente: false },
      "configuracion.ver": { capacidad: null, efecto: "LECTURA", segundoFactorReciente: false },
      "soporte.buscar_referencia": {
        capacidad: null,
        efecto: "LECTURA",
        segundoFactorReciente: false,
      },
      "soporte.explicar": { capacidad: null, efecto: "LECTURA", segundoFactorReciente: false },
      "altas.reenviar_invitacion": {
        capacidad: null,
        efecto: "COMPLETA_CIERRA",
        segundoFactorReciente: false,
      },
      "altas.revocar_invitacion": {
        capacidad: null,
        efecto: "COMPLETA_CIERRA",
        segundoFactorReciente: false,
      },
      "empresas.alta": { capacidad: null, efecto: "CREA_AMPLIA", segundoFactorReciente: true },
      "altas.cancelar": { capacidad: null, efecto: "COMPLETA_CIERRA", segundoFactorReciente: true },
      "tenants.suspender": {
        capacidad: null,
        efecto: "COMPLETA_CIERRA",
        segundoFactorReciente: true,
      },
      "tenants.reactivar": { capacidad: null, efecto: "CREA_AMPLIA", segundoFactorReciente: true },
      "empresas.suspender": {
        capacidad: null,
        efecto: "COMPLETA_CIERRA",
        segundoFactorReciente: true,
      },
      "empresas.reactivar": { capacidad: null, efecto: "CREA_AMPLIA", segundoFactorReciente: true },
      "personas.suspender": {
        capacidad: null,
        efecto: "COMPLETA_CIERRA",
        segundoFactorReciente: true,
      },
      "personas.reactivar": { capacidad: null, efecto: "CREA_AMPLIA", segundoFactorReciente: true },
      // Marcas y planes (especificación «marcas, productos y planes», §C): las 14 de una vez.
      "marcas.ver": { capacidad: null, efecto: "LECTURA", segundoFactorReciente: false },
      "planes.ver": { capacidad: null, efecto: "LECTURA", segundoFactorReciente: false },
      "marcas.crear": { capacidad: null, efecto: "CREA_AMPLIA", segundoFactorReciente: false },
      "marcas.editar_borrador": {
        capacidad: null,
        efecto: "CREA_AMPLIA",
        segundoFactorReciente: false,
      },
      "marcas.confirmar_version": {
        capacidad: null,
        efecto: "CREA_AMPLIA",
        segundoFactorReciente: true,
      },
      "dominios.agregar": { capacidad: null, efecto: "CREA_AMPLIA", segundoFactorReciente: true },
      "dominios.retirar": {
        capacidad: null,
        efecto: "COMPLETA_CIERRA",
        segundoFactorReciente: true,
      },
      "dominios.verificar": { capacidad: null, efecto: "CREA_AMPLIA", segundoFactorReciente: true },
      "dominios.activar": { capacidad: null, efecto: "CREA_AMPLIA", segundoFactorReciente: true },
      "dominios.desactivar": {
        capacidad: null,
        efecto: "COMPLETA_CIERRA",
        segundoFactorReciente: true,
      },
      "planes.crear": { capacidad: null, efecto: "CREA_AMPLIA", segundoFactorReciente: false },
      "planes.editar_borrador": {
        capacidad: null,
        efecto: "CREA_AMPLIA",
        segundoFactorReciente: false,
      },
      "planes.publicar_version": {
        capacidad: null,
        efecto: "CREA_AMPLIA",
        segundoFactorReciente: true,
      },
      "planes.asignar": { capacidad: null, efecto: "CREA_AMPLIA", segundoFactorReciente: true },
      "perillas.ajustar": { capacidad: null, efecto: "CREA_AMPLIA", segundoFactorReciente: true },
      "modulos_de_empresa.activar": {
        capacidad: null,
        efecto: "CREA_AMPLIA",
        segundoFactorReciente: true,
      },
      "modulos_de_empresa.desactivar": {
        capacidad: null,
        efecto: "COMPLETA_CIERRA",
        segundoFactorReciente: true,
      },
    },
  },
} as const satisfies CatalogoDePlataforma;

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
  // Marcas y planes: SOPORTE ve, no cambia estructura (coherente con H5 F3). Piso: lo que puede
  // SOPORTE lo puede ADMIN.
  "marcas.ver": ["ADMIN", "SOPORTE"],
  "planes.ver": ["ADMIN", "SOPORTE"],
  "marcas.crear": ["ADMIN"],
  "marcas.editar_borrador": ["ADMIN"],
  "marcas.confirmar_version": ["ADMIN"],
  "dominios.agregar": ["ADMIN"],
  "dominios.retirar": ["ADMIN"],
  "dominios.verificar": ["ADMIN"],
  "dominios.activar": ["ADMIN"],
  "dominios.desactivar": ["ADMIN"],
  "planes.crear": ["ADMIN"],
  "planes.editar_borrador": ["ADMIN"],
  "planes.publicar_version": ["ADMIN"],
  "planes.asignar": ["ADMIN"],
  "perillas.ajustar": ["ADMIN"],
  "modulos_de_empresa.activar": ["ADMIN"],
  "modulos_de_empresa.desactivar": ["ADMIN"],
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
