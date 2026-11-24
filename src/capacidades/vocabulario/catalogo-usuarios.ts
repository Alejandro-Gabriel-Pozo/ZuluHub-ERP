import type { FuenteDeTexto } from "./uso-y-fuente-de-texto";

/**
 * Los textos de la pantalla «Usuarios» de Cuenta (prefijo `usuarios.`): tramo U1 (la lista y la ficha de solo lectura) y tramo U2 (invitar, reenviar y revocar). Fuente de todos:
 * el dueño aprobó la maqueta `usuarios.html` y sus textos el 23/11/2026 (`11-especificaciones/decisiones-del-dueno-2026-11.md` del repositorio de
 * documentos, fila del 23/11/2026 «Usuarios de la empresa…»; el título es además el nombre de entrada de menú, DDD:82 y DDD:83), y DEC-0851 (U1) y DEC-0852 (U2) lo
 * asientan con la fila citada. Lo que la pantalla ya podía decir con un texto existente NO tiene clave nueva (una regla, un lugar): «Desactivado»
 * (`catalogo.estado.desactivado`), «Activo» (`caja.estado.activo`), «Pendiente» (`fiscal.pantalla.config_cartel_pendiente`), «Estado»
 * (`fiscal.pantalla.listado_rotulo_estado`) y los tres roles (`rol.*.nombre`).
 * Los textos de sucursales son del tramo U4: no se declaran acá hasta que haya quien los consuma. Los de desactivar (U3) son los dos de la confirmación.
 */
const FUENTE_DEL_DUENO: FuenteDeTexto = { decision: "DEC-0851" };
const FUENTE_DE_INVITAR: FuenteDeTexto = { decision: "DEC-0852" };
const FUENTE_DEL_AVISO_DE_GOOGLE: FuenteDeTexto = { decision: "DEC-0859" };
/** Los textos de desactivar (tramo U3): la misma fila del dueño (23/11/2026, pregunta 2: pide confirmar), asentada por DEC-0857. */
const FUENTE_DE_DESACTIVAR: FuenteDeTexto = { decision: "DEC-0857" };

const MODELO = "apps/web/ui/plantillas/usuarios/modelo-de-usuarios.ts";
const MODELO_DE_INVITACIONES = "apps/web/ui/plantillas/usuarios/modelo-de-invitaciones.ts";
const RESPUESTA = "src/capacidades/experiencia/respuesta-de-usuarios.ts";

export const TEXTOS_DE_USUARIOS = {
  // Título de la lista y fila del menú de Cuenta (el nombre lo aprobó el dueño: DDD:82 y DDD:83).
  "usuarios.lista.titulo": {
    porDefecto: "Usuarios",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/app/s/app/(operacion)/cuenta/usuarios/page.tsx",
        nombre: "PaginaDeUsuarios",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/app/s/app/(operacion)/cuenta/usuarios/[personaId]/page.tsx",
        nombre: "PaginaDeFichaDeUsuario",
      },
      { como: "FUNCION", archivo: "apps/web/ui/navegacion/menu.ts", nombre: "FILAS_DEL_MENU" },
    ],
    fuente: FUENTE_DEL_DUENO,
  },
  // Encabezado del bloque de invitaciones pendientes.
  "usuarios.lista.invitaciones": {
    porDefecto: "Invitaciones",
    usos: [{ como: "FUNCION", archivo: MODELO, nombre: "armarLaListaDeUsuarios" }],
    fuente: FUENTE_DEL_DUENO,
  },
  // Rótulo del rol en la ficha (y, en U2, en el formulario).
  "usuarios.campo.rol": {
    porDefecto: "Rol",
    usos: [
      { como: "FUNCION", archivo: MODELO, nombre: "armarLaFichaDeUsuario" },
      { como: "FUNCION", archivo: MODELO_DE_INVITACIONES, nombre: "armarElFormularioDeInvitacion" },
      { como: "FUNCION", archivo: MODELO_DE_INVITACIONES, nombre: "armarLaFichaDeInvitacion" },
    ],
    fuente: FUENTE_DEL_DUENO,
  },
  // Insignia de la invitación que llegó a su vencimiento.
  "usuarios.invitacion.vencida": {
    porDefecto: "Vencida",
    usos: [
      { como: "FUNCION", archivo: MODELO, nombre: "armarLaListaDeUsuarios" },
      { como: "FUNCION", archivo: MODELO_DE_INVITACIONES, nombre: "armarLaFichaDeInvitacion" },
    ],
    fuente: FUENTE_DEL_DUENO,
  },
  // Fecha de vencimiento de la invitación, dd/mm/aaaa en hora de Argentina.
  "usuarios.invitacion.vence_el": {
    porDefecto: "Vence el {fecha}",
    marcadores: ["fecha"],
    usos: [
      { como: "FUNCION", archivo: MODELO, nombre: "armarLaListaDeUsuarios" },
      { como: "FUNCION", archivo: MODELO_DE_INVITACIONES, nombre: "armarLaFichaDeInvitacion" },
    ],
    fuente: FUENTE_DEL_DUENO,
  },
  // Título de la confirmación de desactivar (el email de la persona de la ficha).
  "usuarios.desactivar.titulo": {
    porDefecto: "¿Desactivar a {email}?",
    marcadores: ["email"],
    usos: [{ como: "FUNCION", archivo: MODELO, nombre: "armarLaFichaDeUsuario" }],
    fuente: FUENTE_DE_DESACTIVAR,
  },
  // Detalle de la confirmación: lo que pasa al confirmar.
  "usuarios.desactivar.detalle": {
    porDefecto: "Se corta su acceso ahora.",
    usos: [{ como: "FUNCION", archivo: MODELO, nombre: "armarLaFichaDeUsuario" }],
    fuente: FUENTE_DE_DESACTIVAR,
  },
  // El genérico que ya estaba aprobado (30/10/2026), con clave propia del módulo como los demás: no es un texto nuevo.
  "usuarios.error.accion_no_permitida": {
    porDefecto: "Esta acción no está permitida",
    usos: [
      {
        como: "FUNCION",
        archivo: "src/capacidades/experiencia/respuesta-de-usuarios.ts",
        nombre: "CLAVES_DE_ERRORES_DE_USUARIOS",
      },
    ],
    fuente: FUENTE_DEL_DUENO,
  },
  // Botón de la lista que lleva a invitar.
  "usuarios.lista.invitar": {
    porDefecto: "Invitar",
    usos: [{ como: "FUNCION", archivo: MODELO, nombre: "armarLaListaDeUsuarios" }],
    fuente: FUENTE_DE_INVITAR,
  },
  // Rótulo del grupo de casillas de sucursales (solo con el rol Empleado) y renglón de la ficha de la invitación.
  "usuarios.campo.sucursales": {
    porDefecto: "Sucursales",
    usos: [
      { como: "FUNCION", archivo: MODELO_DE_INVITACIONES, nombre: "armarElFormularioDeInvitacion" },
      { como: "FUNCION", archivo: MODELO_DE_INVITACIONES, nombre: "armarLaFichaDeInvitacion" },
    ],
    fuente: FUENTE_DE_INVITAR,
  },
  // Botón que envía el formulario de invitar.
  "usuarios.invitar.enviar": {
    porDefecto: "Enviar invitación",
    usos: [
      { como: "FUNCION", archivo: MODELO_DE_INVITACIONES, nombre: "armarElFormularioDeInvitacion" },
    ],
    fuente: FUENTE_DE_INVITAR,
  },
  // Aviso (no es un error) al invitar a un email que ya tiene una invitación vigente: quedó la que estaba, con su rol. Es también el texto del código `USUARIOS_YA_HABIA_INVITACION`.
  "usuarios.invitar.ya_habia": {
    porDefecto: "Ya había una invitación pendiente para ese email",
    usos: [
      { como: "FUNCION", archivo: MODELO_DE_INVITACIONES, nombre: "armarElFormularioDeInvitacion" },
      { como: "FUNCION", archivo: RESPUESTA, nombre: "CLAVES_DE_ERRORES_DE_USUARIOS" },
    ],
    fuente: FUENTE_DE_INVITAR,
  },
  // Rechazo al invitar a quien ya es parte de la empresa (el texto de aceptar, «Ya sos parte…», le habla a la persona invitada, no a quien invita).
  "usuarios.error.ya_es_miembro": {
    porDefecto: "Ya es parte de la empresa",
    usos: [{ como: "FUNCION", archivo: RESPUESTA, nombre: "CLAVES_DE_ERRORES_DE_USUARIOS" }],
    fuente: FUENTE_DE_INVITAR,
  },
  // Botones de la ficha de la invitación.
  "usuarios.invitacion.reenviar": {
    porDefecto: "Reenviar",
    usos: [
      { como: "FUNCION", archivo: MODELO_DE_INVITACIONES, nombre: "armarLaFichaDeInvitacion" },
    ],
    fuente: FUENTE_DE_INVITAR,
  },
  "usuarios.invitacion.revocar": {
    porDefecto: "Revocar",
    usos: [
      { como: "FUNCION", archivo: MODELO_DE_INVITACIONES, nombre: "armarLaFichaDeInvitacion" },
    ],
    fuente: FUENTE_DE_INVITAR,
  },
  // Ayuda bajo el campo Email del formulario de invitar: el único ingreso es con Google, y quien no tiene cuenta de Google en ese email no puede aceptar (pregunta 11 del plan).
  "usuarios.invitar.email_de_google": {
    porDefecto: "El email tiene que ser de una cuenta de Google",
    usos: [
      { como: "FUNCION", archivo: MODELO_DE_INVITACIONES, nombre: "armarElFormularioDeInvitacion" },
    ],
    fuente: FUENTE_DEL_AVISO_DE_GOOGLE,
  },
} as const;
