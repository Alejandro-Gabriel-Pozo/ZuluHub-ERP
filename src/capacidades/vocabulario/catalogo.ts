/**
 * Catálogo de textos por defecto (marcas y planes, §B.4). Es código, no base de datos: de acá sale el
 * tipo cerrado `ClaveDeTexto`, así que una pantalla que pide una clave inexistente NO compila y, como
 * el catálogo es total por tipo, nunca falta un texto. La marca (el producto) solo reemplaza la
 * redacción; el CÓDIGO de un error o de un motivo es estable y se muestra junto al texto.
 *
 * Hoy trae las claves del módulo `administracion` (su nombre y los roles fijos de empresa), los cinco
 * motivos del guard (un solo lugar para el texto de cada rechazo) y los errores nuevos de este módulo
 * que puede ver una empresa o la puerta de entrada. Cada módulo suma las suyas en el tramo que lo
 * construye, con el prefijo del módulo dueño (`reservas.estadia.singular`).
 *
 * Reglas de las claves y de los textos (las repite la base como defensa en profundidad, sin conocer el
 * catálogo):
 *  - clave: `^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,5}$`, minúsculas. Un código de motivo o de error entra en
 *    minúsculas (`motivo.sin_permiso`): el tipo lo verifica (`Lowercase<MotivoDeRechazo>`).
 *  - texto: es-AR, frases enteras (no se componen artículos ni género), sin `<` ni `>`, sin
 *    caracteres de control; los marcadores van entre llaves (`{limite}`) y se insertan como texto.
 */

/** El largo máximo de un texto que no declara otro (la base admite hasta 200 en cualquier caso). */
export const LARGO_MAXIMO_DE_TEXTO = 80;

export type DefinicionDeTexto = Readonly<{
  /** El texto por defecto, en es-AR. Es el respaldo de toda la cadena de herencia de la marca. */
  porDefecto: string;
  /** Hasta cuántos caracteres puede tener un reemplazo de la marca. Omitido: `LARGO_MAXIMO_DE_TEXTO`. */
  largoMaximo?: number;
  /** Los marcadores que admite, sin llaves; los mismos que usa `porDefecto`. Omitido: ninguno. */
  marcadores?: readonly string[];
}>;

export const CATALOGO_DE_TEXTOS = {
  // Administración: el núcleo y los roles fijos de empresa (decisión 18).
  "modulo.administracion.nombre": { porDefecto: "Administración" },
  "rol.gerente.nombre": { porDefecto: "Gerente" },
  "rol.administrador.nombre": { porDefecto: "Administrador" },
  "rol.operador.nombre": { porDefecto: "Operador" },

  // Los motivos con que el guard rechaza una acción (reemplazan al `TEXTOS_DE_MOTIVO` previsto en H4).
  "motivo.modulo_en_desarrollo": {
    porDefecto: "Esta función todavía está en desarrollo.",
    largoMaximo: 160,
  },
  "motivo.modulo_no_activo": {
    porDefecto: "Esta función no está activada para la empresa.",
    largoMaximo: 160,
  },
  "motivo.modulo_en_solo_lectura": {
    porDefecto:
      "Esta función quedó en solo lectura porque el plan ya no la incluye. Todo lo cargado se conserva.",
    largoMaximo: 200,
  },
  "motivo.sin_capacidad": {
    porDefecto: "Esta sucursal no tiene habilitada esta función.",
    largoMaximo: 160,
  },
  "motivo.sin_permiso": {
    porDefecto: "No tiene permiso para hacer esto.",
    largoMaximo: 160,
  },

  // Errores nuevos de marcas y planes que puede ver una empresa o la puerta de entrada.
  "error.limite_del_plan": {
    porDefecto: "El plan de la empresa llegó a su límite: {limite}.",
    largoMaximo: 160,
    marcadores: ["limite"],
  },
  "error.funcion_no_incluida": {
    porDefecto: "Esta función no está incluida en el plan de la empresa.",
    largoMaximo: 160,
  },
  "error.empresa_de_otra_marca": {
    porDefecto: "Esta empresa no se puede abrir desde este sitio.",
    largoMaximo: 160,
  },
  "error.invitacion_de_otra_marca": {
    porDefecto: "Esta invitación no se puede aceptar desde este sitio.",
    largoMaximo: 160,
  },
  // Interfaz base (W2): lo que dicen los patrones de conexión, de envío y de sesión. La interfaz recibe
  // estos textos ya resueltos; nacen acá para que cada pantalla no invente los suyos.
  "conexion.sin_conexion": {
    porDefecto: "Sin conexión. Cuando vuelva, podés seguir: no se envió nada.",
    largoMaximo: 120,
  },
  "conexion.no_se_puede_enviar": {
    porDefecto: "No se puede enviar sin conexión.",
    largoMaximo: 80,
  },
  "conexion.enviando": { porDefecto: "Enviando…" },
  "conexion.verificando": { porDefecto: "Verificando si se registró…" },
  "sesion.aviso_titulo": { porDefecto: "¿Seguís ahí?" },
  "sesion.aviso_detalle": {
    porDefecto: "Por seguridad, la sesión se cierra si no se usa. Tocá «Seguir» para mantenerla.",
    largoMaximo: 160,
  },
  "sesion.seguir": { porDefecto: "Seguir" },
  "sesion.vencida_titulo": { porDefecto: "Tu sesión venció" },
  "sesion.vencida_detalle": {
    porDefecto: "Lo que tipeaste quedó guardado en esta pestaña. Volvé a ingresar y lo recuperás.",
    largoMaximo: 160,
  },
  "sesion.ingresar_de_nuevo": { porDefecto: "Ingresar de nuevo" },
  "error.inesperado": {
    porDefecto: "No se pudo completar. Podés reintentar: es seguro, no se duplica.",
    largoMaximo: 120,
  },
  "error.referencia": {
    porDefecto: "Referencia: {referencia}",
    marcadores: ["referencia"],
  },
} as const satisfies Record<string, DefinicionDeTexto>;

export type ClaveDeTexto = keyof typeof CATALOGO_DE_TEXTOS;
