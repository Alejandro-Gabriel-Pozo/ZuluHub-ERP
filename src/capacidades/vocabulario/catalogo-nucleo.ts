/**
 * Los textos del núcleo: administración y roles, motivos del guard, errores de marcas y planes e interfaz base (W2). En su archivo para que `catalogo.ts` no pase el tope de líneas; `CATALOGO_DE_TEXTOS` los suma con un spread.
 */
export const TEXTOS_DEL_NUCLEO = {
  // Administración: el núcleo y los roles fijos de empresa (decisión 18).
  "modulo.administracion.nombre": { porDefecto: "Administración" },
  "rol.gerente.nombre": { porDefecto: "Gerente" },
  "rol.administrador.nombre": { porDefecto: "Administrador" },
  // «Empleado» lo aprobó el dueño el 16/11/2026 (DDD:205 y DDD:206); la clave y el rol interno (`OPERADOR`) no cambian: solo el texto.
  "rol.operador.nombre": { porDefecto: "Empleado" },

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
    porDefecto: "No tenés permiso para hacer esto.",
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
    largoMaximo: 80, // fuente-unica: ajeno — el largo de un texto del vocabulario es otro dato que el nombre de cocina
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
} as const;
