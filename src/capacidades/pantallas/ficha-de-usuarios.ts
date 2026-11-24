import type { FichaDePantalla } from "./ficha-de-mesas";

/**
 * LA FICHA DE LA PANTALLA «USUARIOS» (tramo U1, solo lectura; tramo U2, invitar, reenviar y revocar; DDD:174: toda pantalla nueva nace con ficha). Cuatro rutas: la lista de quienes tienen acceso
 * a la empresa con sus invitaciones pendientes (`/cuenta/usuarios`), la ficha de una persona (`/cuenta/usuarios/[personaId]`), invitar (`/cuenta/usuarios/invitar`) y la ficha de una invitación
 * (`/cuenta/usuarios/invitaciones/[id]`). Misma forma que `ficha-de-mesas.ts` (el tipo se importa de ahí: una regla, un lugar) y la comprueba
 * `test/web/ficha-de-usuarios.test.ts` contra el catálogo de textos, el de permisos y la tabla del menú, para que no se desfase. No crea acciones ni permisos: declara los que ya existen
 * (`usuarios.ver`, `usuarios.invitar`, `usuarios.reenviar_invitacion` y `usuarios.revocar_invitacion`, del módulo `administracion`: gerente y administrador).
 *
 * BOTONES: «Invitar» (navega al formulario), «Enviar invitación», «Reenviar» y «Revocar» (U2) y «Guardar» las sucursales de un empleado activo (U4, `usuarios.asignar_sucursales`). Desactivar y reactivar (U3) suman los suyos
 * cuando se construyan. Sin permiso, ningún botón se dibuja (`AUSENTE`: todo nace cerrado; es solo una ayuda, el servidor vuelve a exigir cada permiso al guard); en U4 sin ese permiso el bloque entero NO se dibuja (ni
 * botón ni casillas). Estados del bloque de sucursales: solo un empleado ACTIVO lo ve; para el gerente, el administrador o un desactivado la ficha no dice nada de sucursales (pregunta 8 del plan, aprobada el 23/11/2026);
 * una sucursal desactivada no se ofrece ni aparece tildada. «Guardar» lo mismo no cambia nada. Ante cualquier falla sale el mensaje genérico «Esta acción no está permitida», sin filas.
 *
 * DIFERENCIAS CON LA MAQUETA (`usuarios.html`; la maqueta manda y toda diferencia la decide el dueño), tramo U2: (1) la ficha de la invitación dibuja el estado como la lista, con la insignia «Pendiente» o «Vencida»
 * (la maqueta decía «Vigente», un texto que no existe en el catálogo) y «Vence el dd/mm/aaaa» como línea debajo en vez de una fila con rótulo; (2) sin permiso los botones no se dibujan (la maqueta no los apaga:
 * regla «todo nace cerrado»); (3) con otra invitación vigente de OTRO rol, el servidor rechaza (H2) y la pantalla dice lo mismo que con el mismo rol: «Ya había una invitación pendiente para ese email». Lo que la maqueta
 * dibuja y este tramo NO construye («Desactivar», «Reactivar», sucursales de quien ya está) es de los tramos U3 y U4. En la ficha de una persona la maqueta dibuja «Estado» con «Activo» o «Desactivado»: salen de textos existentes, sin clave nueva.
 * SUPUESTO (DEC-0851): la ficha NO se da de alta en `fichas.ts` (`FICHAS`, vacío a propósito, con otra forma de ficha): todas las fichas hoy son locales como esta, con su prueba en `test/web/`; migrarlas a `FICHAS` es de otro tramo.
 * Revertir el supuesto cuesta un archivo.
 *
 * Previene: un botón o un texto que nadie aprobó, y una ruta o una fila de menú que se mueve sin que la ficha lo note.
 */

/** El dueño aprobó la maqueta y los 14 textos nuevos del plan (fila del 23/11/2026); DEC-0851 (U1) y DEC-0852 (U2) la asientan. */
const MAQUETA_APROBADA = {
  decidio:
    "el dueño, 23/11/2026 (aprobó la maqueta `usuarios.html` y los 14 textos nuevos de su plan; Pedernal-docs 11-especificaciones/decisiones-del-dueno-2026-11.md, fila del 23/11/2026 «Usuarios de la empresa…»); DEC-0851",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta usuarios.html (vLista, vUsuario) y 11-especificaciones/plan-de-pantallas-usuarios-2026-11-23.md §7",
} as const;

/** Un texto que ya existía en el catálogo y se reusa sin cambios (una regla, un lugar). */
const REUSADO = {
  decidio:
    "el dueño (texto ya aprobado y en uso en el catálogo, reutilizado sin cambios; la maqueta `usuarios.html` lo usa tal cual, aprobada el 23/11/2026)",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta usuarios.html (vLista, vUsuario); 11-especificaciones/plan-de-pantallas-usuarios-2026-11-23.md §7",
} as const;

const USO_DE_LA_LISTA = "modelo-de-usuarios.ts (armarLaListaDeUsuarios)";
const USO_DEL_FORMULARIO = "modelo-de-invitaciones.ts (armarElFormularioDeInvitacion)";
const USO_DE_LA_INVITACION = "modelo-de-invitaciones.ts (armarLaFichaDeInvitacion)";
const USO_DE_LA_FICHA = "modelo-de-usuarios.ts (armarLaFichaDeUsuario)";
const USO_DEL_EDITOR = "modelo-de-usuarios.ts (armarElEditorDeSucursales)";

export const FICHA_DE_USUARIOS = {
  archivos: [
    "apps/web/app/s/app/(operacion)/cuenta/usuarios/page.tsx",
    "apps/web/app/s/app/(operacion)/cuenta/usuarios/[personaId]/page.tsx",
    "apps/web/app/s/app/(operacion)/cuenta/page.tsx",
    "apps/web/ui/plantillas/sesion/PantallaDeCuenta.tsx",
    "apps/web/servidor/usuarios.ts",
    "apps/web/ui/plantillas/usuarios/PantallaDeListaDeUsuarios.tsx",
    "apps/web/ui/plantillas/usuarios/PantallaDeFichaDeUsuario.tsx",
    "apps/web/ui/plantillas/usuarios/FormularioDeSucursalesDeUsuario.cliente.tsx",
    "apps/web/app/s/app/acciones-de-usuarios.ts",
    "apps/web/ui/plantillas/usuarios/modelo-de-usuarios.ts",
    "apps/web/app/s/app/(operacion)/cuenta/usuarios/invitar/page.tsx",
    "apps/web/app/s/app/(operacion)/cuenta/usuarios/invitaciones/[id]/page.tsx",
    "apps/web/app/s/app/acciones-de-usuarios.ts",
    "apps/web/servidor/ofertas-de-administracion.ts",
    "apps/web/ui/plantillas/usuarios/FormularioDeInvitacion.cliente.tsx",
    "apps/web/ui/plantillas/usuarios/FormularioDeAccionDeInvitacion.cliente.tsx",
    "apps/web/ui/plantillas/usuarios/PantallaDeFichaDeInvitacion.tsx",
    "apps/web/ui/plantillas/usuarios/modelo-de-invitaciones.ts",
    "apps/web/ui/plantillas/usuarios/resultado-de-usuarios.ts",
    "src/composicion/usuarios-web.ts",
    "src/composicion/entradas-de-usuarios.ts",
    "src/composicion/errores-de-usuarios.ts",
  ],
  rutas: [
    "/cuenta/usuarios",
    "/cuenta/usuarios/[personaId]",
    "/cuenta/usuarios/invitar",
    "/cuenta/usuarios/invitaciones/[id]",
  ],
  titulo: "usuarios.lista.titulo",
  acceso: "usuarios.ver",
  botones: [
    {
      id: "invitar",
      texto: "usuarios.lista.invitar",
      hace: { navega: "/cuenta/usuarios/invitar" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "enviar-invitacion",
      texto: "usuarios.invitar.enviar",
      hace: { envia: "usuarios.invitar" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "reenviar",
      texto: "usuarios.invitacion.reenviar",
      hace: { envia: "usuarios.reenviar_invitacion" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "revocar",
      texto: "usuarios.invitacion.revocar",
      hace: { envia: "usuarios.revocar_invitacion" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "guardar-sucursales",
      texto: "catalogo.accion.guardar",
      hace: { envia: "usuarios.asignar_sucursales" },
      sinPermiso: "AUSENTE",
    },
  ],
  estados: { ERROR: "GENERICO", SIN_PERMISO: "GENERICO" },
  textos: {
    "usuarios.lista.titulo": {
      usos: ["título de la pantalla y de la ficha sin datos", "fila del menú de Cuenta"],
      fuente: {
        decidio: MAQUETA_APROBADA.decidio,
        donde:
          "el nombre de la entrada de menú lo aprobó el dueño (DDD:82 y DDD:83, decisiones-del-dueno-2026-11.md); maqueta usuarios.html (barra «Usuarios»)",
      },
    },
    "catalogo.accion.guardar": { usos: [USO_DEL_EDITOR], fuente: REUSADO },
    "usuarios.lista.invitaciones": { usos: [USO_DE_LA_LISTA], fuente: MAQUETA_APROBADA },
    "usuarios.campo.rol": {
      usos: [USO_DE_LA_FICHA, USO_DEL_FORMULARIO, USO_DE_LA_INVITACION],
      fuente: MAQUETA_APROBADA,
    },
    "usuarios.invitacion.vencida": {
      usos: [USO_DE_LA_LISTA, USO_DE_LA_INVITACION],
      fuente: MAQUETA_APROBADA,
    },
    "usuarios.invitacion.vence_el": {
      usos: [USO_DE_LA_LISTA, USO_DE_LA_INVITACION],
      fuente: MAQUETA_APROBADA,
    },
    "usuarios.lista.invitar": {
      usos: [USO_DE_LA_LISTA, "página de invitar (título de la pantalla)"],
      fuente: MAQUETA_APROBADA,
    },
    "usuarios.campo.sucursales": {
      usos: [USO_DEL_FORMULARIO, USO_DE_LA_INVITACION, USO_DEL_EDITOR],
      fuente: MAQUETA_APROBADA,
    },
    "usuarios.invitar.email_de_google": {
      usos: [USO_DEL_FORMULARIO + " (ayuda bajo el campo Email)"],
      fuente: {
        decidio:
          "el dueño, 23/11/2026 (punto 11: se avisa que el email tiene que ser de Google; fila «Usuarios de la empresa…»)",
        donde:
          "Pedernal-docs 11-especificaciones/decisiones-del-dueno-2026-11.md, fila del 23/11/2026, punto 11; redacción por delegación DDD:173 (orquestador); DEC-0859",
      },
    },
    "usuarios.invitar.enviar": { usos: [USO_DEL_FORMULARIO], fuente: MAQUETA_APROBADA },
    "usuarios.invitar.ya_habia": {
      usos: [USO_DEL_FORMULARIO, "respuesta-de-usuarios.ts (código USUARIOS_YA_HABIA_INVITACION)"],
      fuente: MAQUETA_APROBADA,
    },
    "usuarios.error.ya_es_miembro": {
      usos: ["respuesta-de-usuarios.ts (código USUARIOS_YA_ES_MIEMBRO)"],
      fuente: MAQUETA_APROBADA,
    },
    "usuarios.invitacion.reenviar": { usos: [USO_DE_LA_INVITACION], fuente: MAQUETA_APROBADA },
    "usuarios.invitacion.revocar": { usos: [USO_DE_LA_INVITACION], fuente: MAQUETA_APROBADA },
    // Reusados sin cambios (una regla, un lugar): el rótulo «Email», «Cancelar» y «El email no es válido» ya estaban aprobados.
    "clientes.formulario.email": {
      usos: [USO_DEL_FORMULARIO],
      fuente: {
        decidio:
          "el dueño (texto ya aprobado y en uso en el catálogo de Clientes, reutilizado sin cambios; la maqueta `usuarios.html` lo usa tal cual, aprobada el 23/11/2026)",
        donde: REUSADO.donde,
      },
    },
    "fiscal.pantalla.config_pv_cancelar": { usos: [USO_DEL_FORMULARIO], fuente: REUSADO },
    "clientes.error.email_invalido": {
      usos: ["errores-de-usuarios.ts (código CLIENTES_EMAIL_INVALIDO)"],
      fuente: {
        decidio:
          "el dueño, 09/11/2026 («El email no es válido», aprobado en Clientes y reutilizado sin cambios; la maqueta `usuarios.html` del 23/11/2026 lo usa en el formulario de invitar)",
        donde:
          "Pedernal-docs 11-especificaciones/decisiones-del-dueno-2026-11.md (Clientes, 09/11/2026); plan-de-pantallas-usuarios-2026-11-23.md §4",
      },
    },
    "usuarios.error.accion_no_permitida": {
      usos: ["estado de error y de falta de permiso (el genérico)"],
      fuente: {
        decidio:
          "el dueño, 30/10/2026 (interfaz sobria: un mensaje genérico, ya aprobado en otras pantallas) y 23/11/2026 (maqueta usuarios.html, estados «Sin permiso» y «Acción no permitida»)",
        donde:
          "Pedernal-docs 10-ux-ui, maqueta usuarios.html (estados «Sin permiso» y «Acción no permitida»); CLAUDE.md del ERP, regla «Interfaz sobria»",
      },
    },
    "catalogo.estado.desactivado": { usos: [USO_DE_LA_LISTA, USO_DE_LA_FICHA], fuente: REUSADO },
    "caja.estado.activo": { usos: [USO_DE_LA_FICHA], fuente: REUSADO },
    "fiscal.pantalla.config_cartel_pendiente": {
      usos: [USO_DE_LA_LISTA, USO_DE_LA_INVITACION],
      fuente: REUSADO,
    },
    "fiscal.pantalla.listado_rotulo_estado": {
      usos: [USO_DE_LA_FICHA, USO_DE_LA_INVITACION],
      fuente: REUSADO,
    },
    "rol.gerente.nombre": { usos: [USO_DE_LA_LISTA, USO_DE_LA_FICHA], fuente: REUSADO },
    "rol.administrador.nombre": {
      usos: [USO_DE_LA_LISTA, USO_DE_LA_FICHA, USO_DEL_FORMULARIO, USO_DE_LA_INVITACION],
      fuente: REUSADO,
    },
    "rol.operador.nombre": {
      usos: [USO_DE_LA_LISTA, USO_DE_LA_FICHA, USO_DEL_FORMULARIO, USO_DE_LA_INVITACION],
      fuente: {
        decidio:
          "el dueño, 16/11/2026 («Empleado», decisiones-del-dueno-2026-11.md, DDD:205 y DDD:206); el código lo mostraba como «Operador»",
        donde:
          "Pedernal-docs 11-especificaciones/decisiones-del-dueno-2026-11.md, filas DDD:205 y DDD:206; DEC-0851",
      },
    },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDePantalla;
