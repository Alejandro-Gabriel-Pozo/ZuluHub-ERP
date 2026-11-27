import type { FuenteDeTexto, UsoDeTexto } from "./uso-y-fuente-de-texto";

/**
 * Los textos de la pantalla «Sucursales» de Cuenta (prefijo `sucursales.`). Fuente: DEC-IDE-006, la etiqueta simple que aceptó el orquestador por delegación (fila 173, 27/11/2026; inventario de textos de la pantalla).
 * Lo que la pantalla ya podía decir con un texto existente NO tiene clave nueva (una regla, un lugar): «Sucursales» (`usuarios.campo.sucursales`), «Nombre» (`caja.campo.nombre`), «Guardar» (`caja.accion.guardar`) y
 * «Cancelar» (`caja.accion.cancelar`).
 */
const ACEPTADO: FuenteDeTexto = { decision: "DEC-IDE-006" };
const MODELO = "apps/web/ui/plantillas/sucursales/modelo-de-sucursales.ts";
const usoDe = (nombre: string): readonly [UsoDeTexto] => [
  { como: "FUNCION", archivo: MODELO, nombre },
];

export const TEXTOS_DE_SUCURSALES = {
  "sucursales.lista.nueva": {
    porDefecto: "Nueva sucursal",
    usos: [
      ...usoDe("armarLaListaDeSucursales"),
      {
        como: "FUNCION",
        archivo: "apps/web/app/s/app/(operacion)/cuenta/sucursales/nueva/page.tsx",
        nombre: "PaginaDeNuevaSucursal",
      },
    ],
    fuente: ACEPTADO,
  },
} as const;
