import type { FichaDePantalla } from "./ficha-de-mesas";

/** Lo mismo que `FichaDePantalla`, con un botón que abre un cuadro de confirmación (`abre-el-cuadro`, como en `ficha-de-cierre-del-dia.ts`): el tipo común solo conoce navegar y enviar. */
type FichaConCuadro = Omit<FichaDePantalla, "botones"> &
  Readonly<{
    botones: readonly (
      | FichaDePantalla["botones"][number]
      | Readonly<{
          id: string;
          texto: FichaDePantalla["titulo"];
          hace: "abre-el-cuadro";
          sinPermiso: "APAGADO" | "AUSENTE";
        }>
    )[];
  }>;

/**
 * LA FICHA DE LA PANTALLA «USUARIOS» (tramo U1, solo lectura; DDD:174: toda pantalla nueva nace con ficha). Dos rutas: la lista de quienes tienen acceso a la empresa con sus invitaciones
 * pendientes (`/cuenta/usuarios`) y la ficha de una persona (`/cuenta/usuarios/[personaId]`). Misma forma que `ficha-de-mesas.ts` (el tipo se importa de ahí: una regla, un lugar) y la comprueba
 * `test/web/ficha-de-usuarios.test.ts` contra el catálogo de textos, el de permisos y la tabla del menú, para que no se desfase. No crea acciones ni permisos: declara los que ya existen
 * (`usuarios.ver`, del módulo `administracion`: gerente y administrador).
 *
 * BOTONES: «Desactivar» (U3, parte A) abre un cuadro de confirmación («¿Desactivar a {email}?», «Se corta su acceso ahora.», «Cancelar» y «Desactivar») y su confirmación envía `usuarios.apagar`. Se ofrece solo a quien
 * tiene el permiso, y solo en una persona activa que no es el gerente ni quien está mirando (el servidor lo impide igual: `ES_EL_GERENTE`, `ES_UNO_MISMO`); sin permiso el botón está AUSENTE (todo nace cerrado: no se
 * dibuja lo que el servidor va a rechazar). Invitar, reenviar, revocar (U2), reactivar (U3, parte B) y asignar sucursales (U4) suman los suyos cuando se construyan. Sin permiso y ante cualquier falla
 * sale el mensaje genérico «Esta acción no está permitida», sin filas.
 *
 * DIFERENCIAS CON LA MAQUETA (`usuarios.html`; la maqueta manda y toda diferencia la decide el dueño): ninguna de diseño. Lo que la maqueta dibuja y este tramo NO construye (botón «Invitar», ficha de la
 * invitación, «Desactivar», «Reactivar», sucursales) es de los tramos U2 a U4. En la ficha de una persona la maqueta dibuja «Estado» con «Activo» o «Desactivado»: salen de textos existentes, sin clave nueva.
 * SUPUESTO (DEC-0851): la ficha NO se da de alta en `fichas.ts` (`FICHAS`, vacío a propósito, con otra forma de ficha): todas las fichas hoy son locales como esta, con su prueba en `test/web/`; migrarlas a `FICHAS` es de otro tramo.
 * Revertir el supuesto cuesta un archivo.
 *
 * Previene: un botón o un texto que nadie aprobó, y una ruta o una fila de menú que se mueve sin que la ficha lo note.
 */

/** El dueño aprobó la maqueta y los 14 textos nuevos del plan (fila del 23/11/2026); DEC-0851 la asienta. */
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

/** Los textos de la confirmación de desactivar: la misma fila del dueño (23/11/2026, pregunta 2: pide confirmar), asentada por DEC-0857. */
const CONFIRMACION_APROBADA = {
  decidio:
    "el dueño, 23/11/2026 (aprobó la maqueta `usuarios.html`, incluida la confirmación de desactivar, y la recomendación 2: pide confirmar; Pedernal-docs 11-especificaciones/decisiones-del-dueno-2026-11.md, fila del 23/11/2026 «Usuarios de la empresa…»); DEC-0857",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta usuarios.html (estado «Confirmar desactivar») y 11-especificaciones/plan-de-pantallas-usuarios-2026-11-23.md §7 y §9 (pregunta 2)",
} as const;

const USO_DE_LA_LISTA = "modelo-de-usuarios.ts (armarLaListaDeUsuarios)";
const USO_DE_LA_FICHA = "modelo-de-usuarios.ts (armarLaFichaDeUsuario)";
const USO_DE_LA_CONFIRMACION = "ConfirmacionDeDesactivar.cliente.tsx (vía armarLaFichaDeUsuario)";

export const FICHA_DE_USUARIOS = {
  archivos: [
    "apps/web/app/s/app/(operacion)/cuenta/usuarios/page.tsx",
    "apps/web/app/s/app/(operacion)/cuenta/usuarios/[personaId]/page.tsx",
    "apps/web/app/s/app/acciones-de-usuarios.ts",
    "apps/web/app/s/app/(operacion)/cuenta/page.tsx",
    "apps/web/ui/plantillas/sesion/PantallaDeCuenta.tsx",
    "apps/web/servidor/usuarios.ts",
    "apps/web/ui/plantillas/usuarios/PantallaDeListaDeUsuarios.tsx",
    "apps/web/ui/plantillas/usuarios/PantallaDeFichaDeUsuario.tsx",
    "apps/web/ui/plantillas/usuarios/ConfirmacionDeDesactivar.cliente.tsx",
    "apps/web/ui/plantillas/usuarios/modelo-de-usuarios.ts",
    "src/composicion/usuarios-web.ts",
    "src/composicion/entradas-de-usuarios.ts",
    "src/composicion/errores-de-usuarios.ts",
  ],
  rutas: ["/cuenta/usuarios", "/cuenta/usuarios/[personaId]"],
  titulo: "usuarios.lista.titulo",
  acceso: "usuarios.ver",
  botones: [
    {
      id: "desactivar",
      texto: "caja.accion.desactivar",
      hace: "abre-el-cuadro",
      sinPermiso: "AUSENTE",
    },
    {
      id: "confirmar-desactivar",
      texto: "caja.accion.desactivar",
      hace: { envia: "usuarios.apagar" },
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
    "usuarios.lista.invitaciones": { usos: [USO_DE_LA_LISTA], fuente: MAQUETA_APROBADA },
    "usuarios.campo.rol": { usos: [USO_DE_LA_FICHA], fuente: MAQUETA_APROBADA },
    "usuarios.invitacion.vencida": { usos: [USO_DE_LA_LISTA], fuente: MAQUETA_APROBADA },
    "usuarios.invitacion.vence_el": { usos: [USO_DE_LA_LISTA], fuente: MAQUETA_APROBADA },
    "usuarios.error.accion_no_permitida": {
      usos: ["estado de error y de falta de permiso (el genérico)"],
      fuente: {
        decidio:
          "el dueño, 30/10/2026 (interfaz sobria: un mensaje genérico, ya aprobado en otras pantallas) y 23/11/2026 (maqueta usuarios.html, estados «Sin permiso» y «Acción no permitida»)",
        donde:
          "Pedernal-docs 10-ux-ui, maqueta usuarios.html (estados «Sin permiso» y «Acción no permitida»); CLAUDE.md del ERP, regla «Interfaz sobria»",
      },
    },
    "usuarios.desactivar.titulo": { usos: [USO_DE_LA_CONFIRMACION], fuente: CONFIRMACION_APROBADA },
    "usuarios.desactivar.detalle": {
      usos: [USO_DE_LA_CONFIRMACION],
      fuente: CONFIRMACION_APROBADA,
    },
    "caja.accion.desactivar": {
      usos: [USO_DE_LA_CONFIRMACION, "botón «Desactivar» de la ficha y botón que confirma"],
      fuente: REUSADO,
    },
    "caja.accion.cancelar": { usos: [USO_DE_LA_CONFIRMACION], fuente: REUSADO },
    "vidriera.producto.cerrar": {
      usos: [USO_DE_LA_CONFIRMACION, "etiqueta del botón de cerrar el cuadro"],
      fuente: REUSADO,
    },
    "conexion.enviando": {
      usos: [USO_DE_LA_CONFIRMACION, "texto del botón mientras envía"],
      fuente: REUSADO,
    },
    "catalogo.estado.desactivado": { usos: [USO_DE_LA_LISTA, USO_DE_LA_FICHA], fuente: REUSADO },
    "caja.estado.activo": { usos: [USO_DE_LA_FICHA], fuente: REUSADO },
    "fiscal.pantalla.config_cartel_pendiente": { usos: [USO_DE_LA_LISTA], fuente: REUSADO },
    "fiscal.pantalla.listado_rotulo_estado": { usos: [USO_DE_LA_FICHA], fuente: REUSADO },
    "rol.gerente.nombre": { usos: [USO_DE_LA_LISTA, USO_DE_LA_FICHA], fuente: REUSADO },
    "rol.administrador.nombre": { usos: [USO_DE_LA_LISTA, USO_DE_LA_FICHA], fuente: REUSADO },
    "rol.operador.nombre": {
      usos: [USO_DE_LA_LISTA, USO_DE_LA_FICHA],
      fuente: {
        decidio:
          "el dueño, 16/11/2026 («Empleado», decisiones-del-dueno-2026-11.md, DDD:205 y DDD:206); el código lo mostraba como «Operador»",
        donde:
          "Pedernal-docs 11-especificaciones/decisiones-del-dueno-2026-11.md, filas DDD:205 y DDD:206; DEC-0851",
      },
    },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaConCuadro;
