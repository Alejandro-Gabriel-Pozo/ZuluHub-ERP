import type { DefinicionDeDato, Proposito } from "./tipos-de-datos";

/**
 * Los datos de la solapa «Cómo se compra» de un producto (T0): las presentaciones de compra («Caja de 5 kg», «Bolsa 25 kg», «Horma ≈ 4 kg»), en su propio archivo para que `registro-de-productos.ts`
 * no pase el tope de líneas por archivo: solo cambia la ubicación respecto de los demás datos del catálogo. `registro.ts` los junta con el resto. El dato es del catálogo y el permiso es el que
 * ya existe (`productos.editar`).
 */

const REQUIERE_CATALOGO = { modulo: "catalogo", estadoDeEmpresa: ["ACTIVE"] } as const;
const FORMULARIO_DE_PRESENTACION =
  "apps/web/ui/plantillas/catalogo/FormularioDePresentacion.cliente.tsx";
const PRESENTACION_PROPOSITO = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs/11-especificaciones/plan-t0-pantalla-de-presentaciones-2026-11-25.md §D (ficha de la pantalla, aceptada por el orquestador por delegación, fila 174), la maqueta `presentaciones.html` (carpeta de prototipos de Pedernal-docs 10-ux-ui) y la tabla «Textos nuevos» de `productos.html` (09/11/2026)",
});

export const DATOS_DE_PRESENTACIONES = {
  "nombre-de-presentacion": {
    ficha: "src/primitivas/texto/nombre-de-presentacion.ts",
    propositos: [
      PRESENTACION_PROPOSITO(
        "Nombre de una presentación de compra de un producto («Caja de 5 kg»): obligatorio, hasta 80 caracteres, con una letra y único por producto sin distinguir mayúsculas; se pone al agregarla y se cambia al editarla.",
      ),
    ],
    consumidores: [FORMULARIO_DE_PRESENTACION],
    ponerPor: ["productos.editar"],
    requiere: REQUIERE_CATALOGO,
  },
  "cantidad-de-presentacion": {
    ficha: "src/primitivas/cantidad/cantidad.ts",
    propositos: [
      PRESENTACION_PROPOSITO(
        "Cantidad de una presentación de compra en la unidad base del producto, mayor que cero y con hasta 4 decimales; con peso variable es solo el peso aproximado, para pedir y estimar. Se pone al agregarla y no cambia nunca: otra cantidad es otra presentación.",
      ),
    ],
    consumidores: [FORMULARIO_DE_PRESENTACION],
    ponerPor: ["productos.editar"],
    requiere: REQUIERE_CATALOGO,
  },
  "presentacion-de-peso-variable": {
    // El catálogo guarda un sí o un no (`de_peso_variable`); lo que significa (la cantidad es el aproximado y el peso real se mide al recibir) vive en el dominio de las presentaciones.
    ficha: "src/modulos/catalogo/dominio/presentaciones.ts",
    propositos: [
      PRESENTACION_PROPOSITO(
        "Si una presentación de compra pesa distinto cada vez (una caja o una horma): se marca al agregarla y no se cambia después; la cantidad pasa a ser el peso aproximado.",
      ),
    ],
    consumidores: [FORMULARIO_DE_PRESENTACION],
    ponerPor: ["productos.editar"],
    requiere: REQUIERE_CATALOGO,
  },
} as const satisfies Readonly<Record<string, DefinicionDeDato>>;
