import type { DefinicionDeDato, Proposito } from "./tipos-de-datos";

/**
 * Los datos del módulo administración (contacto de la sucursal e invitar a un usuario) del registro de datos (ver `registro.ts`), en su propio archivo para que dos ramas que suman datos de módulos distintos no toquen
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
  "sucursales-de-usuario": {
    ficha: "src/primitivas/identificadores/marca.ts",
    propositos: [INVITAR_PROPOSITO],
    consumidores: [INVITAR],
    ponerPor: ["usuarios.invitar"],
    requiere: REQUIERE_ADMINISTRACION,
  },
} as const satisfies Readonly<Record<string, DefinicionDeDato>>;
