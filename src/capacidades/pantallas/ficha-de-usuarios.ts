import type { FichaDePantalla } from "./ficha-de-mesas";

/**
 * LA FICHA DE LA PANTALLA «USUARIOS» (tramo U1, solo lectura; DDD:174: toda pantalla nueva nace con ficha). Dos rutas: la lista de quienes tienen acceso a la empresa con sus invitaciones
 * pendientes (`/cuenta/usuarios`) y la ficha de una persona (`/cuenta/usuarios/[personaId]`). Misma forma que `ficha-de-mesas.ts` (el tipo se importa de ahí: una regla, un lugar) y la comprueba
 * `test/web/ficha-de-usuarios.test.ts` contra el catálogo de textos, el de permisos y la tabla del menú, para que no se desfase. No crea acciones ni permisos: declara los que ya existen
 * (`usuarios.ver`, del módulo `administracion`: gerente y administrador).
 *
 * BOTONES: hoy uno, «Guardar» las sucursales de un empleado activo (U4, `usuarios.asignar_sucursales`: gerente y administrador). Sin ese permiso el bloque entero NO se dibuja («AUSENTE»: sin permiso no hay botón ni casillas).
 * Invitar, reenviar, revocar (U2) y desactivar y reactivar (U3) suman los suyos a esta ficha cuando se construyan. Estados del bloque de sucursales: solo un empleado ACTIVO lo ve; para el gerente, el administrador o un desactivado la ficha
 * no dice nada de sucursales (pregunta 8 del plan, aprobada el 23/11/2026); una sucursal desactivada no se ofrece ni aparece tildada. «Guardar» lo mismo no cambia nada. Sin permiso y ante cualquier falla
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

const USO_DE_LA_LISTA = "modelo-de-usuarios.ts (armarLaListaDeUsuarios)";
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
    "src/composicion/usuarios-web.ts",
    "src/composicion/entradas-de-usuarios.ts",
    "src/composicion/errores-de-usuarios.ts",
  ],
  rutas: ["/cuenta/usuarios", "/cuenta/usuarios/[personaId]"],
  titulo: "usuarios.lista.titulo",
  acceso: "usuarios.ver",
  botones: [
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
    "usuarios.campo.sucursales": {
      usos: [USO_DEL_EDITOR],
      fuente: {
        decidio: `${MAQUETA_APROBADA.decidio}; U4 lo asienta en DEC-0856`,
        donde: MAQUETA_APROBADA.donde,
      },
    },
    "catalogo.accion.guardar": { usos: [USO_DEL_EDITOR], fuente: REUSADO },
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
} as const satisfies FichaDePantalla;
