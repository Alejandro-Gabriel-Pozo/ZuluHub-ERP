/** La clave del nombre de una acción de los roles (`catalogo-acciones-de-roles.ts`): el id con «confirmar» escrito «validar», porque el catálogo rechaza todo nombre que contenga «firma». */
export const claveDelNombreDeLaAccion = (accion: string): string =>
  `roles.accion.${accion.replace("confirmar", "validar")}`;
