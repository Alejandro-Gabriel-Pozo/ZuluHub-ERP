import type { DefinicionDeDato, Proposito } from "./tipos-de-datos";

/**
 * Los datos del módulo administración (contacto de la sucursal, invitar a un usuario y asignarle sucursales) del registro de datos (ver `registro.ts`), en su propio archivo para que dos ramas que suman datos de módulos distintos no toquen
 * las mismas líneas: solo cambia la ubicación, ningún dato ni consumidor. Un dato no puede estar en dos fragmentos (lo comprueba `test/arquitectura/datos-por-modulo.test.ts`).
 */

const CONTACTO = "apps/web/ui/plantillas/sesion/PantallaDeContactoDeLaSucursal.cliente.tsx";
const CONTACTO_PROPOSITO: Proposito = {
  para: "Contacto de la sucursal que la factura impresa muestra (pantalla de contacto de la sucursal).",
  fuente:
    "Pedernal-docs/11-especificaciones/diseno-contacto-de-la-sucursal.md §4 (casos de uso) y D-98",
};
const INVITAR = "apps/web/ui/plantillas/usuarios/FormularioDeInvitacion.cliente.tsx";
const INVITAR_PROPOSITO: Proposito = {
  para: "Invitar por mail a una persona a la empresa, con su rol y, si es Empleado, sus sucursales (pantalla «Usuarios», tramo U2).",
  fuente:
    "Pedernal-docs/11-especificaciones/plan-de-pantallas-usuarios-2026-11-23.md §2 (flujo 1) y decisiones-del-dueno-2026-11.md, fila del 23/11/2026 «Usuarios de la empresa…»",
};
const REQUIERE_ADMINISTRACION = {
  modulo: "administracion",
  estadoDeEmpresa: ["ACTIVE"],
} as const;

const FICHA_DE_USUARIO =
  "apps/web/ui/plantillas/usuarios/FormularioDeSucursalesDeUsuario.cliente.tsx";
const ASIGNAR_SUCURSALES_PROPOSITO: Proposito = {
  para: "Las sucursales en las que trabaja un empleado: el conjunto final de casillas de su ficha, vacío permitido (pantalla «Usuarios», tramo U4).",
  fuente:
    "Pedernal-docs/11-especificaciones/plan-de-pantallas-usuarios-2026-11-23.md §2 (flujo 6) y §9 (pregunta 8); maqueta usuarios.html (vUsuario)",
};

const ALTA_DE_ROL = "apps/web/ui/plantillas/roles/FormularioDeAltaDeRol.cliente.tsx";
const FICHA_DE_ROL = "apps/web/ui/plantillas/roles/FormularioDeFichaDeRol.cliente.tsx";
const ROL_DE_USUARIO = "apps/web/ui/plantillas/roles/FormularioDeRolDeUsuario.cliente.tsx";
const ROL_DE_USUARIO_PROPOSITO: Proposito = {
  para: "El rol que el gerente le asigna a una persona de la empresa: uno de los dos roles base o un rol propio activo (ficha de una persona, pantalla «Usuarios»).",
  fuente:
    "Pedernal-docs/11-especificaciones/diseno-roles-propios.md (H4b) y decisiones-del-dueno-2026-11.md, respuesta del dueño del 26/11/2026 (Excel de roles propios, hoja Otras decisiones: asignar solo desde la ficha de la persona)",
};
const ROLES_PROPOSITO: Proposito = {
  para: "Armar un rol propio de la empresa: su nombre, de dónde empieza y las acciones que puede hacer (pantalla «Roles», tramo T6).",
  fuente:
    "Pedernal-docs/11-especificaciones/diseno-roles-propios.md (H4b) y decisiones-del-dueno-2026-11.md, respuesta del dueño del 26/11/2026 (Excel de roles propios, hojas Acciones y Otras decisiones)",
};

export const DATOS_DE_ADMINISTRACION = {
  correo: {
    ficha: "src/primitivas/contacto/email.ts",
    propositos: [CONTACTO_PROPOSITO],
    consumidores: [CONTACTO],
    ponerPor: ["sucursales.editar"],
    requiere: REQUIERE_ADMINISTRACION,
  },
  telefono: {
    ficha: "src/primitivas/contacto/telefono.ts",
    propositos: [CONTACTO_PROPOSITO],
    consumidores: [CONTACTO],
    ponerPor: ["sucursales.editar"],
    requiere: REQUIERE_ADMINISTRACION,
  },
  web: {
    ficha: "src/primitivas/contacto/web.ts",
    propositos: [CONTACTO_PROPOSITO],
    consumidores: [CONTACTO],
    ponerPor: ["sucursales.editar"],
    requiere: REQUIERE_ADMINISTRACION,
  },
  "email-de-invitacion": {
    ficha: "src/primitivas/contacto/email.ts",
    propositos: [INVITAR_PROPOSITO],
    consumidores: [INVITAR],
    ponerPor: ["usuarios.invitar"],
    requiere: REQUIERE_ADMINISTRACION,
  },
  "rol-de-invitacion": {
    ficha: "src/capacidades/permisos/roles.ts",
    propositos: [INVITAR_PROPOSITO],
    consumidores: [INVITAR],
    ponerPor: ["usuarios.invitar"],
    requiere: REQUIERE_ADMINISTRACION,
  },
  // Lo piden dos pantallas: el formulario de invitar (U2) y el editor de la ficha de un empleado (U4).
  "sucursales-de-usuario": {
    ficha: "src/primitivas/identificadores/marca.ts",
    propositos: [INVITAR_PROPOSITO, ASIGNAR_SUCURSALES_PROPOSITO],
    consumidores: [INVITAR, FICHA_DE_USUARIO],
    ponerPor: ["usuarios.invitar", "usuarios.asignar_sucursales"],
    requiere: REQUIERE_ADMINISTRACION,
  },
  // Lo piden dos pantallas: el alta de un rol y su ficha.
  "nombre-de-rol": {
    ficha: "src/primitivas/texto/nombre-de-rol.ts",
    propositos: [ROLES_PROPOSITO],
    consumidores: [ALTA_DE_ROL, FICHA_DE_ROL],
    ponerPor: ["roles.crear", "roles.editar"],
    requiere: REQUIERE_ADMINISTRACION,
  },
  "origen-de-rol": {
    ficha: "src/modulos/identidad/casos-de-uso/crear-rol.ts",
    propositos: [ROLES_PROPOSITO],
    consumidores: [ALTA_DE_ROL],
    ponerPor: ["roles.crear"],
    requiere: REQUIERE_ADMINISTRACION,
  },
  "rol-de-origen": {
    ficha: "src/primitivas/identificadores/marca.ts",
    propositos: [ROLES_PROPOSITO],
    consumidores: [ALTA_DE_ROL],
    ponerPor: ["roles.crear"],
    requiere: REQUIERE_ADMINISTRACION,
  },
  "rol-de-usuario": {
    ficha: "src/modulos/identidad/dominio/asignacion-de-rol.ts",
    propositos: [ROL_DE_USUARIO_PROPOSITO],
    consumidores: [ROL_DE_USUARIO],
    ponerPor: ["usuarios.asignar_rol"],
    requiere: REQUIERE_ADMINISTRACION,
  },
  "acciones-de-rol": {
    ficha: "src/capacidades/roles/validar-conjunto.ts",
    propositos: [ROLES_PROPOSITO],
    consumidores: [FICHA_DE_ROL],
    ponerPor: ["roles.editar"],
    requiere: REQUIERE_ADMINISTRACION,
  },
} as const satisfies Readonly<Record<string, DefinicionDeDato>>;
