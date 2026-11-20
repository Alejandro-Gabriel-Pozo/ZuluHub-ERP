import {
  PERMISOS_DE_PLATAFORMA,
  type RolDePlataforma,
} from "../../../src/capacidades/permisos/plataforma";

/** Qué botones de Planes se ofrecen a un rol. Es solo una ayuda de la pantalla: cada acción la vuelve a exigir el servidor (guard). Rol desconocido: nada (todo nace cerrado). */
export type PermisosDePlanes = Readonly<{ crear: boolean; editar: boolean; publicar: boolean }>;

const puede = (rol: RolDePlataforma, accion: keyof typeof PERMISOS_DE_PLATAFORMA): boolean =>
  (PERMISOS_DE_PLATAFORMA[accion] as readonly RolDePlataforma[]).includes(rol);

export function permisosDePlanes(rol: RolDePlataforma): PermisosDePlanes {
  return {
    crear: puede(rol, "planes.crear"),
    editar: puede(rol, "planes.editar_borrador"),
    publicar: puede(rol, "planes.publicar_version"),
  };
}
