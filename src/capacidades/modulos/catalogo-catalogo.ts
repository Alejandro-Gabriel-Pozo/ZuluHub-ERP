/**
 * Catálogo comercial y stock (especificación `catalogo-y-stock.md` §C, tramo T0, con la escalera de
 * la carta CE0 de `catalogo-carta-niveles-y-elecciones.md` §7.2). Los tres módulos nacen
 * `en_desarrollo`: declararlos NO los hace vendibles, el guard rechaza sus acciones con
 * `MODULO_EN_DESARROLLO` y el cierre (pasarlos a `disponible`) es el tramo T12. Una acción por caso
 * de uso o consulta; quién puede cada una, en `permisos/empresa.ts`. Ninguna exige una capacidad de
 * sucursal: el alcance del operador por sucursal lo verifica el caso de uso con `exigirSucursal`.
 *
 * Criterio de los efectos (`EfectoDeAccion`): mirar es `LECTURA`; lo que cierra, apaga, anula o
 * completa algo ya iniciado (desactivar, retirar, aplicar o cancelar un conteo, anular un
 * movimiento, contar) es `COMPLETA_CIERRA` y una baja de plan no lo traba; todo lo demás (altas,
 * ediciones, reactivar, cambiar un precio, publicar, mover stock) es `CREA_AMPLIA`.
 */
export const MODULO_DE_CATALOGO = {
  estado: "disponible",
  obligatorio: false,
  requiere: ["administracion"],
  usaSiExiste: [],
  datosRequeridos: [],
  implementadoPor: ["modulos/catalogo"],
  acciones: {
    "productos.ver": { capacidad: null, efecto: "LECTURA" },
    "productos.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
    "productos.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
    "productos.reactivar": { capacidad: null, efecto: "CREA_AMPLIA" },
    "productos.cambiar_precio": { capacidad: null, efecto: "CREA_AMPLIA" },
    "productos.desactivar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "opciones.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
    // CE0: elecciones del producto (variantes y combos). Cambiar el precio de una variante es
    // `productos.cambiar_precio`. Decisión 138 (no hay precio por combinación) y decisión 133 (los grupos son
    // del producto): no hay acciones de grupos de precio ni `opciones.asignar`; «copiar de otro producto» es
    // `opciones.editar` (e0-cimientos-especificacion §3.1.3, pedido de S2).
    "variantes.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
  },
} as const;
