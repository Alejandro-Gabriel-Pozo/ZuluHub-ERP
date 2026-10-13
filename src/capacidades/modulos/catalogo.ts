/**
 * Catálogo comercial de módulos (ADR-003). Es código, no base de datos: de acá salen los tipos
 * cerrados `ClaveModulo`, `ClaveAccion` y `ClaveCapacidad`, así que una acción sin módulo, o un
 * permiso para una acción que no existe, no compila.
 */

export type EstadoDeConstruccion = "disponible" | "en_desarrollo";

/**
 * Qué hace una acción con lo que la empresa ya tiene (reglas transversales §7.9). Decide qué pasa
 * cuando un módulo queda en SOLO LECTURA (una baja de plan lo dejó fuera del techo):
 *  - `LECTURA`: solo mira. Se permite.
 *  - `COMPLETA_CIERRA`: escritura que completa, cierra, cancela o reduce lo ya iniciado (cerrar una
 *    cuenta, cancelar, anular, apagar, desactivar, responder una propuesta). Se permite: una baja de
 *    plan no deja obligaciones existentes bloqueadas sin salida.
 *  - `CREA_AMPLIA`: escritura que crea algo nuevo o amplía lo que hay (alta, cambio de configuración,
 *    reactivar, ampliar un alcance). Se rechaza con `MODULO_EN_SOLO_LECTURA`.
 * Ante la duda entre las dos escrituras, la acción es `CREA_AMPLIA`: bloquear de más es visible y se
 * corrige reclasificando; permitir de más deja crecer un módulo que el plan ya no incluye.
 */
export type EfectoDeAccion = "LECTURA" | "CREA_AMPLIA" | "COMPLETA_CIERRA";

/** Los tres efectos, en una lista que las pruebas recorren (el tipo `EfectoDeAccion` es la fuente). */
export const EFECTOS_DE_ACCION = [
  "LECTURA",
  "CREA_AMPLIA",
  "COMPLETA_CIERRA",
] as const satisfies readonly EfectoDeAccion[];

/**
 * Una acción del módulo. `capacidad`: la capacidad de sucursal que exige, o `null` si no exige ninguna.
 * `efecto`: obligatorio en TODA acción (una acción sin clasificar no compila): ver `EfectoDeAccion`.
 */
export type DefinicionDeAccion<C extends string = string> = Readonly<{
  capacidad: C | null;
  efecto: EfectoDeAccion;
}>;

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
 *
 * Es el NÚCLEO (empresas, sucursales, identidad): no depende de un plan, así que nunca queda en solo
 * lectura (el guard ignora ese estado en los módulos obligatorios). Aun así cada acción declara su
 * `efecto`, para que el día que un módulo con plan copie el patrón no haya acciones sin clasificar.
 * Criterio: lo que quita, cierra o responde algo ya iniciado (apagar, revocar o reenviar una
 * invitación, desactivar una sucursal, cancelar, aceptar o rechazar un traspaso) es `COMPLETA_CIERRA`;
 * lo que da de alta, cambia la configuración, reactiva o amplía un alcance (invitar, asignar
 * sucursales, crear, editar y reactivar sucursales, proponer un traspaso) es `CREA_AMPLIA`.
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
      "usuarios.invitar": { capacidad: null, efecto: "CREA_AMPLIA" },
      "usuarios.reenviar_invitacion": { capacidad: null, efecto: "COMPLETA_CIERRA" },
      "usuarios.apagar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
      "usuarios.ver": { capacidad: null, efecto: "LECTURA" },
      "usuarios.asignar_sucursales": { capacidad: null, efecto: "CREA_AMPLIA" },
      "usuarios.revocar_invitacion": { capacidad: null, efecto: "COMPLETA_CIERRA" },
      "sucursales.ver": { capacidad: null, efecto: "LECTURA" },
      "sucursales.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
      "sucursales.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
      "sucursales.desactivar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
      "sucursales.reactivar": { capacidad: null, efecto: "CREA_AMPLIA" },
      "gerencia.proponer_traspaso": { capacidad: null, efecto: "CREA_AMPLIA" },
      "gerencia.cancelar_traspaso": { capacidad: null, efecto: "COMPLETA_CIERRA" },
      "gerencia.ver_traspaso": { capacidad: null, efecto: "LECTURA" },
      "gerencia.aceptar_traspaso": { capacidad: null, efecto: "COMPLETA_CIERRA" },
      "gerencia.rechazar_traspaso": { capacidad: null, efecto: "COMPLETA_CIERRA" },
      "modulos.ver": { capacidad: null, efecto: "LECTURA" },
      "permisos.ver_propios": { capacidad: null, efecto: "LECTURA" },
    },
  },
  /**
   * Facturación electrónica (H7, especificación §C). `en_desarrollo`: el guard rechaza sus acciones
   * con `MODULO_EN_DESARROLLO` hasta que exista la facturación. Hoy solo declara la acción que
   * exigen los casos de uso de numeración (reservar y cerrar el número de un comprobante). Emitir
   * completa algo ya vendido o cobrado, así que es `COMPLETA_CIERRA` y una baja de plan no lo traba.
   */
  facturacion: {
    estado: "en_desarrollo",
    obligatorio: false,
    requiere: ["administracion"],
    usaSiExiste: [],
    datosRequeridos: ["emisor_principal.datos_fiscales_confirmados", "punto_de_venta.activo"],
    implementadoPor: ["modulos/fiscal"],
    acciones: {
      "comprobantes.emitir": { capacidad: null, efecto: "COMPLETA_CIERRA" },
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
