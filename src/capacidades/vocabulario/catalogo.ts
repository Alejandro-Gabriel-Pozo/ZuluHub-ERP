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
  // Carta pública (C-2): lo que lee el comensal. La interfaz recibe estos textos ya resueltos.
  "carta.letra.etiqueta": { porDefecto: "Letra" },
  "carta.letra.grupo": { porDefecto: "Tamaño de la letra" },
  "carta.letra.normal": { porDefecto: "Letra normal" },
  "carta.letra.grande": { porDefecto: "Letra grande" },
  "carta.letra.muy_grande": { porDefecto: "Letra muy grande" },
  "carta.buscar.etiqueta": { porDefecto: "Buscar en la carta" },
  "carta.buscar.un_resultado": { porDefecto: "1 resultado" },
  "carta.buscar.resultados": { porDefecto: "{cantidad} resultados", marcadores: ["cantidad"] },
  "carta.buscar.sin_resultados": {
    porDefecto: "No hay nada que diga «{texto}».",
    largoMaximo: 120,
    marcadores: ["texto"],
  },
  "carta.buscar.limpiar": { porDefecto: "Limpiar búsqueda" },
  "carta.indice.titulo": { porDefecto: "Secciones" },
  "carta.indice.ir": { porDefecto: "Ir al índice de secciones" },
  "carta.producto.agotado": { porDefecto: "Agotado" },
  "carta.producto.precios": { porDefecto: "Precios" },
  "carta.producto.cerrar": { porDefecto: "Cerrar" },
  "carta.producto.volver": { porDefecto: "Volver a la carta" },
  "carta.producto.ver_toda": { porDefecto: "Ver toda la carta" },
  "carta.producto.compartir": { porDefecto: "Compartir" },
  "carta.producto.enlace_copiado": { porDefecto: "Enlace copiado" },
  "carta.producto.enlace_no_copiado": {
    porDefecto: "No se pudo copiar el enlace. Probá de nuevo.",
    largoMaximo: 120,
  },
  "carta.producto.no_esta": { porDefecto: "Este producto ya no está en la carta." },
  "carta.pie.iva": { porDefecto: "Los precios incluyen IVA." },
  // Sesión y empresa (W5): ingreso, invitación, elegir empresa, shell y estados. La interfaz recibe estos
  // textos ya resueltos; cada código de error público (`experiencia/respuesta.ts`) tiene el suyo.
  "ingreso.titulo": { porDefecto: "Ingresá a {marca}", marcadores: ["marca"] },
  "ingreso.detalle": { porDefecto: "Usá tu cuenta de Google para entrar.", largoMaximo: 120 },
  "ingreso.boton": { porDefecto: "Ingresar con Google" },
  "ingreso.enviando": { porDefecto: "Abriendo Google…" },
  "ingreso.error.cancelado": {
    porDefecto: "Cancelaste el ingreso con Google. Podés volver a intentarlo.",
    largoMaximo: 120,
  },
  "ingreso.error.email_no_verificado": {
    porDefecto: "Google no confirmó tu email. Verificalo en tu cuenta de Google y probá de nuevo.",
    largoMaximo: 160,
  },
  "ingreso.error.interrumpido": {
    porDefecto: "El ingreso se interrumpió. Probá de nuevo.",
    largoMaximo: 120,
  },
  "ingreso.error.cuenta_no_valida": {
    porDefecto: "Esa cuenta de Google no se puede usar acá. Probá con otra.",
    largoMaximo: 120,
  },
  "ingreso.error.generico": {
    porDefecto: "No se pudo ingresar. Podés reintentar.",
    largoMaximo: 120,
  },
  "invitacion.titulo": { porDefecto: "Invitación a {marca}", marcadores: ["marca"] },
  "invitacion.detalle_sin_sesion": {
    porDefecto:
      "Para aceptar la invitación, primero ingresá con la cuenta de Google a la que llegó el mail.",
    largoMaximo: 160,
  },
  "invitacion.detalle_con_sesion": {
    porDefecto:
      "Tocá «Aceptar invitación» para sumarte a la empresa. Si ya la aceptaste, no pasa nada.",
    largoMaximo: 160,
  },
  "invitacion.aceptar": { porDefecto: "Aceptar invitación" },
  "invitacion.aceptando": { porDefecto: "Aceptando…" },
  "invitacion.sin_enlace": {
    porDefecto: "Falta el enlace de la invitación. Abrilo de nuevo desde el mail.",
    largoMaximo: 120,
  },
  "invitacion.aceptada": { porDefecto: "Listo, ya sos parte de la empresa.", largoMaximo: 120 },
  "invitacion.ya_aceptada": { porDefecto: "Esta invitación ya estaba aceptada.", largoMaximo: 120 },
  "invitacion.continuar": { porDefecto: "Continuar" },
  "empresa.elegir_titulo": { porDefecto: "Elegí la empresa" },
  "empresa.elegir_detalle": { porDefecto: "Con cuál querés trabajar ahora.", largoMaximo: 120 },
  "empresa.entrar": { porDefecto: "Entrar a la empresa" },
  "empresa.entrando": { porDefecto: "Entrando…" },
  "empresa.sin_empresas": {
    porDefecto: "No tenés empresas en {marca}. Si te invitaron, abrí el enlace del mail.",
    largoMaximo: 160,
    marcadores: ["marca"],
  },
  "empresa.sin_empresas_titulo": { porDefecto: "Sin empresas" },
  "empresa.cambiar": { porDefecto: "Cambiar de empresa" },
  "empresa.etiqueta": { porDefecto: "Empresa" },
  "empresa.rol_etiqueta": { porDefecto: "Tu rol" },
  "motivo.empresa.empresa_en_alta": {
    porDefecto: "La empresa todavía no terminó de darse de alta.",
    largoMaximo: 160,
  },
  "motivo.empresa.empresa_suspendida": {
    porDefecto: "La empresa está suspendida.",
    largoMaximo: 160,
  },
  "motivo.empresa.empresa_cancelada": {
    porDefecto: "La empresa fue cancelada.",
    largoMaximo: 160,
  },
  "motivo.empresa.empresa_en_baja": {
    porDefecto: "La empresa se está dando de baja.",
    largoMaximo: 160,
  },
  "motivo.empresa.tenant_suspendido": {
    porDefecto: "El servicio de la empresa está suspendido.",
    largoMaximo: 160,
  },
  "navegacion.etiqueta": { porDefecto: "Navegación principal" },
  "navegacion.saltar": { porDefecto: "Saltar al contenido" },
  "navegacion.inicio": { porDefecto: "Inicio" },
  "navegacion.empresa": { porDefecto: "Empresa" },
  "navegacion.cuenta": { porDefecto: "Cuenta" },
  "inicio.titulo": { porDefecto: "Inicio" },
  "inicio.bienvenida": {
    porDefecto: "Estás en {empresa}.",
    largoMaximo: 120,
    marcadores: ["empresa"],
  },
  "inicio.pendientes_titulo": { porDefecto: "Lo que falta" },
  "inicio.pendientes_vacio": { porDefecto: "No hay nada pendiente por ahora.", largoMaximo: 120 },
  "cuenta.titulo": { porDefecto: "Cuenta" },
  "cuenta.cerrar_sesion": { porDefecto: "Cerrar sesión" },
  "cuenta.cerrando": { porDefecto: "Cerrando sesión…" },
  "sucursal.etiqueta": { porDefecto: "Sucursal" },
  "sucursal.elegir": { porDefecto: "Elegí una sucursal" },
  "sucursal.ayuda": { porDefecto: "Se recuerda en este dispositivo.", largoMaximo: 120 },
  "sesion.estado_activa": { porDefecto: "Sesión activa" },
  "sesion.estado_por_vencer": { porDefecto: "Sesión por vencer" },
  "sesion.estado_vencida": { porDefecto: "Sesión vencida" },
  "estado.cargando": { porDefecto: "Cargando…" },
  "estado.reintentar": { porDefecto: "Reintentar" },
  "estado.volver_al_inicio": { porDefecto: "Volver al inicio" },
  "estado.no_encontrado_titulo": { porDefecto: "No encontrado" },
  "estado.no_encontrado_detalle": {
    porDefecto: "La página que buscás no existe.",
    largoMaximo: 120,
  },
  "estado.mantenimiento_titulo": { porDefecto: "En mantenimiento" },
  "estado.mantenimiento_detalle": {
    porDefecto: "Estamos haciendo una mejora. Volvé a intentar en unos minutos.",
    largoMaximo: 160,
  },
  "estado.sin_permiso_titulo": { porDefecto: "Sin permiso" },
  "estado.error_titulo": { porDefecto: "Algo salió mal" },
  "error.sesion_vencida": {
    porDefecto: "Tu sesión venció. Volvé a ingresar para seguir.",
    largoMaximo: 120,
  },
  "error.no_disponible": {
    porDefecto: "El sistema no está disponible por el momento. Probá de nuevo en unos minutos.",
    largoMaximo: 160,
  },
  "error.invitacion_no_encontrada": {
    porDefecto: "No encontramos esa invitación. Revisá el enlace del mail.",
    largoMaximo: 160,
  },
  "error.invitacion_revocada": {
    porDefecto: "Esa invitación fue cancelada. Pedí una nueva.",
    largoMaximo: 160,
  },
  "error.invitacion_no_pendiente": {
    porDefecto: "Esa invitación ya no está pendiente.",
    largoMaximo: 160,
  },
  "error.invitacion_vencida": {
    porDefecto: "Esa invitación venció. Pedí una nueva.",
    largoMaximo: 160,
  },
  "error.invitacion_de_otro_email": {
    porDefecto:
      "Esa invitación es para otro email. Ingresá con la cuenta de Google a la que llegó el mail.",
    largoMaximo: 160,
  },
  "error.alta_no_pendiente": {
    porDefecto: "El alta de esa empresa ya no está pendiente.",
    largoMaximo: 160,
  },
  "error.persona_suspendida": {
    porDefecto: "Tu usuario está suspendido. Consultá con el gerente de la empresa.",
    largoMaximo: 160,
  },
  "error.persona_de_otro_usuario": {
    porDefecto:
      "Ese email ya está vinculado con otra cuenta de Google. Escribinos y lo resolvemos.",
    largoMaximo: 160,
  },
  "error.usuario_de_otra_persona": {
    porDefecto:
      "Esta cuenta de Google ya está vinculada con otro email. Escribinos y lo resolvemos.",
    largoMaximo: 160,
  },
  "error.ya_es_miembro": { porDefecto: "Ya sos parte de esta empresa.", largoMaximo: 120 },
  "error.rol_distinto_al_anterior": {
    porDefecto: "Ya tuviste otro rol en esta empresa. Pedile al gerente que lo resuelva.",
    largoMaximo: 160,
  },
  "error.empresa_no_opera": {
    porDefecto: "La empresa no está operando en este momento.",
    largoMaximo: 160,
  },
} as const satisfies Record<string, DefinicionDeTexto>;

export type ClaveDeTexto = keyof typeof CATALOGO_DE_TEXTOS;
