/**
 * Los textos de sesión y empresa (W5), del menú por áreas y de la sucursal. En su archivo para que `catalogo.ts` no pase el tope de líneas; `CATALOGO_DE_TEXTOS` los suma con un spread.
 */
export const TEXTOS_DE_SESION_Y_EMPRESA = {
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
  // Fuente: dueño, 12/11/2026, `Pedernal-docs/11-especificaciones/decisiones-del-dueno-2026-11.md`, fila «Menú por áreas, versión 4»: nombres de las
  // áreas Ventas, Catálogo y Compras aprobados «por ahora». «Compras» se suma con su primera pantalla.
  "navegacion.area.ventas": { porDefecto: "Ventas" },
  "navegacion.area.catalogo": { porDefecto: "Catálogo" },
  // Fuente: dueño, 13/11/2026, `decisiones-del-dueno-2026-11.md` línea 110, fila «Rótulos del menú por áreas aprobados»: el encabezado del grupo de la carta dentro de Catálogo es «Carta».
  "navegacion.grupo.carta": { porDefecto: "Carta" },
  // Fuente: dueño, 13/11/2026, `decisiones-del-dueno-2026-11.md` línea 110: «Mostrador» es el grupo del área Ventas que contiene «Venta rápida».
  "navegacion.grupo.mostrador": { porDefecto: "Mostrador" },
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
  // Fuente: Dueño, 2026-11-05: primera prueba real en Preview (el desplegable de Ingresos Brutos arrancaba sin invitar a elegir); texto aprobado «Elegí una opción».
  "selector.elegir_una_opcion": { porDefecto: "Elegí una opción" },
  // Fuente: Dueño, 2026-11-05: prototipo B de «Elegir sucursal al ingresar» (https://claude.ai/artifact/EjPJnzT6Ai6iZnXARXqqij), que trae el botón «Continuar» textual.
  "sucursal.continuar": { porDefecto: "Continuar" },
  "sucursal.ayuda": { porDefecto: "Se recuerda en este dispositivo.", largoMaximo: 120 },
  // Contacto de la sucursal (D-98, alcance A de D-113). El contacto es de la sucursal, no fiscal: familia `sucursal.*`.
  // Fuente de las cuatro claves: Dueño, 2026-11-04, D-113, Pedernal-docs/11-especificaciones/facturador-contratos-de-pantalla.md.
  "sucursal.contacto_titulo": { porDefecto: "Contacto de la sucursal" },
  "sucursal.telefono": { porDefecto: "Teléfono" },
  "sucursal.correo": { porDefecto: "Correo" },
  "sucursal.web": { porDefecto: "Web" },
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
} as const;
