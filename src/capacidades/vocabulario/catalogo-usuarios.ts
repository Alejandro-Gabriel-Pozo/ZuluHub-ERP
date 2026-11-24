import type { FuenteDeTexto } from "./uso-y-fuente-de-texto";

/**
 * Los textos de la pantalla «Usuarios» de Cuenta (prefijo `usuarios.`), tramo U1: la lista y la ficha de solo lectura. Fuente de todos:
 * el dueño aprobó la maqueta `usuarios.html` y sus textos el 23/11/2026 (`11-especificaciones/decisiones-del-dueno-2026-11.md` del repositorio de
 * documentos, fila del 23/11/2026 «Usuarios de la empresa…»; el título es además el nombre de entrada de menú, DDD:82 y DDD:83), y DEC-0851 lo
 * asienta con la fila citada. Lo que la pantalla ya podía decir con un texto existente NO tiene clave nueva (una regla, un lugar): «Desactivado»
 * (`catalogo.estado.desactivado`), «Activo» (`caja.estado.activo`), «Pendiente» (`fiscal.pantalla.config_cartel_pendiente`), «Estado»
 * (`fiscal.pantalla.listado_rotulo_estado`) y los tres roles (`rol.*.nombre`).
 * Los textos de invitar, reenviar, revocar y sucursales son de los tramos U2, U4: no se declaran acá hasta que haya quien los consuma. Los de desactivar (U3) son los dos de la confirmación.
 */
const FUENTE_DEL_DUENO: FuenteDeTexto = { decision: "DEC-0851" };
/** Los textos de desactivar (tramo U3): la misma fila del dueño (23/11/2026, pregunta 2: pide confirmar), asentada por DEC-0856. */
const FUENTE_DE_DESACTIVAR: FuenteDeTexto = { decision: "DEC-0856" };

const MODELO = "apps/web/ui/plantillas/usuarios/modelo-de-usuarios.ts";

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
    usos: [{ como: "FUNCION", archivo: MODELO, nombre: "armarLaFichaDeUsuario" }],
    fuente: FUENTE_DEL_DUENO,
  },
  // Insignia de la invitación que llegó a su vencimiento.
  "usuarios.invitacion.vencida": {
    porDefecto: "Vencida",
    usos: [{ como: "FUNCION", archivo: MODELO, nombre: "armarLaListaDeUsuarios" }],
    fuente: FUENTE_DEL_DUENO,
  },
  // Fecha de vencimiento de la invitación, dd/mm/aaaa en hora de Argentina.
  "usuarios.invitacion.vence_el": {
    porDefecto: "Vence el {fecha}",
    marcadores: ["fecha"],
    usos: [{ como: "FUNCION", archivo: MODELO, nombre: "armarLaListaDeUsuarios" }],
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
} as const;
