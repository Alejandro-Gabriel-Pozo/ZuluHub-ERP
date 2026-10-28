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
 * Es el NÚCLEO (empresas, sucursales, identidad y la configuración fiscal del gerente): no depende de un
 * plan, así que nunca queda en solo lectura (el guard ignora ese estado en los módulos obligatorios). Aun
 * así cada acción declara su `efecto`, para que el día que un módulo con plan copie el patrón no haya
 * acciones sin clasificar.
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
    implementadoPor: ["modulos/identidad", "modulos/empresas", "modulos/fiscal"],
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
      // H7 fiscal §C (T5): la configuración fiscal del gerente. Vive acá y no en `facturacion` porque son los
      // `datosRequeridos` de la facturación: si dependieran de ella (en desarrollo), el gerente nunca podría
      // dejarlos listos. Guardar un borrador, crear, editar y activar un punto de venta o confirmar la regla del
      // emisor crean o amplían; confirmar los datos fiscales y desactivar un punto de venta cierran.
      "datos_fiscales.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
      "datos_fiscales.confirmar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
      "puntos_de_venta.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
      "puntos_de_venta.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
      "puntos_de_venta.activar": { capacidad: null, efecto: "CREA_AMPLIA" },
      "puntos_de_venta.desactivar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
      "emisores.confirmar_regla": { capacidad: null, efecto: "CREA_AMPLIA" },
    },
  },
  /**
   * Facturación electrónica (H7, especificación §C). `en_desarrollo`: el guard rechaza sus acciones
   * con `MODULO_EN_DESARROLLO` hasta que exista la facturación. Hoy declara la acción que exigen los
   * casos de uso de numeración (reservar y cerrar el número de un comprobante) y la de las consultas
   * del facturador (F6). Emitir completa algo ya vendido o cobrado, así que es `COMPLETA_CIERRA` y
   * una baja de plan no lo traba; mirar lo emitido es `LECTURA` y se puede siempre.
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
      "comprobantes.ver": { capacidad: null, efecto: "LECTURA" },
      // H7 facturación §C (F5): emitir a mano CREA un cargo (la factura y la nota de débito) y no se permite en
      // solo lectura; la nota de crédito, descartar, reintentar y resincronizar cierran lo que ya existe.
      // Cambiar el ambiente habilita a emitir con valor fiscal: amplía.
      "comprobantes.emitir_manual": { capacidad: null, efecto: "CREA_AMPLIA" },
      "notas_de_credito.emitir": { capacidad: null, efecto: "COMPLETA_CIERRA" },
      "comprobantes.descartar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
      "comprobantes.reintentar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
      "series.resincronizar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
      "puntos_de_venta.cambiar_ambiente": { capacidad: null, efecto: "CREA_AMPLIA" },
      // H7 facturación §C (F7): generar el pedido de un certificado y cargar el que devolvió ARCA son altas que
      // habilitan a emitir con valor fiscal: crean y amplían, y no se permiten en solo lectura.
      "certificados.gestionar": { capacidad: null, efecto: "CREA_AMPLIA" },
    },
  },
  /**
   * Catálogo comercial y stock (especificación `catalogo-y-stock.md` §C, tramo T0, con la escalera de
   * la carta CE0 de `catalogo-carta-niveles-y-elecciones.md` §7.2). Los tres módulos nacen
   * `en_desarrollo`: declararlos NO los hace vendibles, el guard rechaza sus acciones con
   * `MODULO_EN_DESARROLLO` y el cierre (pasarlos a `disponible`) es el tramo T12. Una acción por caso
   * de uso o consulta; quién puede cada una, en `permisos/empresa.ts`. Ninguna exige una capacidad de
   * sucursal: el alcance del operador por sucursal lo verifica el caso de uso con `exigirSucursal`.
   *
   * Criterio de los efectos (`EfectoDeAccion`): mirar es `LECTURA`; lo que cierra, apaga, anula o
   * completa algo ya iniciado (desactivar, retirar, aplicar o cancelar un conteo, anular un
   * movimiento, contar) es `COMPLETA_CIERRA` y una baja de plan no lo traba; todo lo demás (altas,
   * ediciones, reactivar, cambiar un precio, publicar, mover stock) es `CREA_AMPLIA`.
   */
  catalogo: {
    estado: "en_desarrollo",
    obligatorio: false,
    requiere: ["administracion"],
    usaSiExiste: [],
    datosRequeridos: [],
    implementadoPor: ["modulos/catalogo"],
    acciones: {
      "productos.ver": { capacidad: null, efecto: "LECTURA" },
      "productos.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
      "productos.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
      "productos.reactivar": { capacidad: null, efecto: "CREA_AMPLIA" },
      "productos.cambiar_precio": { capacidad: null, efecto: "CREA_AMPLIA" },
      "productos.desactivar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
      "productos.asignar_emisor": { capacidad: null, efecto: "CREA_AMPLIA" },
      "opciones.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
      "categorias.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
      "categorias.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
      "categorias.reactivar": { capacidad: null, efecto: "CREA_AMPLIA" },
      "categorias.desactivar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
      // CE0: elecciones del producto (variantes, biblioteca de guarniciones y adicionales), grupos de
      // precio y combos. Cambiar el precio de un grupo o de una variante es `productos.cambiar_precio`.
      "variantes.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
      "opciones.asignar": { capacidad: null, efecto: "CREA_AMPLIA" },
      "grupos_de_precio.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
      "grupos_de_precio.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
      "grupos_de_precio.asignar": { capacidad: null, efecto: "CREA_AMPLIA" },
      "grupos_de_precio.reactivar": { capacidad: null, efecto: "CREA_AMPLIA" },
      "grupos_de_precio.desactivar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
      "conjuntos.editar_contenido": { capacidad: null, efecto: "CREA_AMPLIA" },
    },
  },
  /**
   * La carta: una vista publicada del catálogo, que es otro módulo comercial pero lo implementa el
   * mismo código (`modulos/catalogo`). Sola, sin stock ni ventas, es la vidriera (§F8). La publicación
   * en línea (QR) es un extra de pago: lo decide la perilla `vidriera_por_qr`, que se declara cuando se
   * construya la carta; las tres acciones `*_en_linea` y `renovar_enlace` ya se clasifican acá.
   */
  vidriera: {
    estado: "en_desarrollo",
    obligatorio: false,
    requiere: ["catalogo"],
    usaSiExiste: [],
    datosRequeridos: [],
    implementadoPor: ["modulos/catalogo"],
    acciones: {
      "vidrieras.ver": { capacidad: null, efecto: "LECTURA" },
      "vidrieras.marcar_disponibilidad": { capacidad: null, efecto: "CREA_AMPLIA" },
      "vidrieras.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
      "vidrieras.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
      "vidrieras.publicar": { capacidad: null, efecto: "CREA_AMPLIA" },
      "vidrieras.retirar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
      "vidrieras.publicar_en_linea": { capacidad: null, efecto: "CREA_AMPLIA" },
      "vidrieras.renovar_enlace": { capacidad: null, efecto: "CREA_AMPLIA" },
      "vidrieras.retirar_de_linea": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    },
  },
  stock: {
    estado: "en_desarrollo",
    obligatorio: false,
    requiere: ["catalogo"],
    usaSiExiste: [],
    // El primer depósito lo crea la persona usuaria: stock no pide datos previos.
    datosRequeridos: [],
    implementadoPor: ["modulos/stock"],
    acciones: {
      "stock.ver": { capacidad: null, efecto: "LECTURA" },
      "stock.verificar_saldos": { capacidad: null, efecto: "LECTURA" },
      "stock.registrar_entrada": { capacidad: null, efecto: "CREA_AMPLIA" },
      "stock.registrar_salida": { capacidad: null, efecto: "CREA_AMPLIA" },
      "stock.transferir": { capacidad: null, efecto: "CREA_AMPLIA" },
      "stock.ajustar": { capacidad: null, efecto: "CREA_AMPLIA" },
      "stock.anular": { capacidad: null, efecto: "COMPLETA_CIERRA" },
      "depositos.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
      "depositos.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
      "depositos.reactivar": { capacidad: null, efecto: "CREA_AMPLIA" },
      "depositos.desactivar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
      "depositos.asignar_emisor": { capacidad: null, efecto: "CREA_AMPLIA" },
      "articulos.controlar": { capacidad: null, efecto: "CREA_AMPLIA" },
      "articulos.dejar_de_controlar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
      "composiciones.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
      "conteos.abrir": { capacidad: null, efecto: "CREA_AMPLIA" },
      "conteos.registrar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
      "conteos.aplicar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
      "conteos.cancelar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
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
