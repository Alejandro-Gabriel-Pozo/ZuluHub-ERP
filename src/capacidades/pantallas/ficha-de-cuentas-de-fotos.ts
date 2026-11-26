import type { FichaDePantalla } from "./ficha-de-mesas";

/**
 * LA FICHA DE LA PANTALLA «CONECTÁ TU CUENTA DE FOTOS» (cuentas de imagen declaradas, 0102; DDD:174: toda pantalla tiene su ficha). Una ruta, `/catalogo/carta-en-linea/cuentas-de-fotos`, de la EMPRESA (no de una
 * sucursal): el formulario para declarar una cuenta del proveedor de imágenes y la lista de las activas, cada una con su retiro. Misma forma que `ficha-de-depositos.ts` y la comprueba
 * `test/web/ficha-de-cuentas-de-fotos.test.ts` contra el catálogo de textos y el de permisos. No crea acciones ni permisos: declara el que ya existe (`vidrieras.administrar_cuentas_de_imagen`, DEC-1410).
 *
 * Qué se ve sin el permiso: nada. La consulta de la lista exige la misma acción que declarar y retirar, así que sin ella sale el motivo del guard y ningún dato; no hay botones apagados ni avisos por permiso.
 * Todo rechazo (cuenta inválida, tope de 2, cuenta ya declarada, motivo inválido, versión vieja) sale con el genérico aprobado («Esta acción no está permitida»): CD-5, CD-6 y CD-7 del brief no tienen texto propio.
 *
 * SUPUESTOS (DEC-CAT-002; el orquestador los aceptó el 26/11/2026; se revierten cambiando lo dicho):
 *  1. La ruta es propia, hermana de «Carta en línea», SIN entrada nueva en el menú (DEC-CAT-002): se llega por la dirección. Revertir: sumar la fila al menú, o un enlace desde el campo del logo (textos nuevos).
 *  2. Solo se listan las cuentas ACTIVAS; las retiradas quedan en la base con quién, cuándo y por qué. Revertir: sumar una sección de retiradas (texto nuevo).
 *  3. Quedan afuera «¿Ya tenés cuenta en Cloudinary?» (CD-2: pide un enlace externo sin verificar) y «Revisá dos cosas en tu cuenta» (CD-4: los nombres de las opciones de Cloudinary se prueban con una cuenta real; lo
 *     prueba el dueño). Previene: un texto o una guía que nadie pudo verificar.
 * Previene: un botón o un texto que nadie aprobó, y una acción de permiso que se mueve sin que la ficha lo note.
 */

const PROPUESTA_PENDIENTE = {
  decidio:
    "propuesta de la sesión de construcción de UX3 §5.7.6 y del brief del 25/11/2026, aceptada para construir por el orquestador (26/11/2026); el dueño la aprueba en su hoja (DEC-CAT-001, PENDIENTE_DE_OK)",
  donde:
    "Pedernal-docs 11-especificaciones/brief-logo-de-la-carta-cuentas-declaradas-2026-11-25.md §8 (CD-1 y CD-3) y arquitectura/decisiones/registro/DEC-CAT-001.json",
} as const;
const YA_APROBADO = {
  decidio:
    "el dueño, 09/11/2026 y 12/11/2026 (maquetas de productos y de la carta aprobadas, con la regla «manda la maqueta»); por delegación (fila 173) el orquestador acepta los textos ya aprobados",
  donde:
    "Pedernal-docs 10-ux-ui, maquetas productos.html y carta-en-linea.html (Textos ya aprobados); catálogo de textos: `catalogo.accion.guardar`, `catalogo.carta.quitar` y `stock.accion.motivo`",
} as const;
const USO_DEL_ALTA = "FormularioDeCuentaDeFotos.cliente.tsx";
const USO_DEL_RETIRO = "FormularioDeRetiroDeCuentaDeFotos.cliente.tsx";

export const FICHA_DE_CUENTAS_DE_FOTOS = {
  archivos: [
    "apps/web/app/s/app/(operacion)/catalogo/carta-en-linea/cuentas-de-fotos/page.tsx",
    "apps/web/app/s/app/acciones-de-cuentas-de-fotos.ts",
    "apps/web/servidor/cuentas-de-fotos.ts",
    "apps/web/ui/plantillas/carta/PantallaDeCuentasDeFotos.tsx",
    "apps/web/ui/plantillas/carta/FormularioDeCuentaDeFotos.cliente.tsx",
    "apps/web/ui/plantillas/carta/FormularioDeRetiroDeCuentaDeFotos.cliente.tsx",
    "apps/web/ui/plantillas/carta/modelo-de-cuentas-de-fotos.ts",
  ],
  rutas: ["/catalogo/carta-en-linea/cuentas-de-fotos"],
  titulo: "catalogo.cuentas_de_fotos.titulo",
  acceso: "vidrieras.administrar_cuentas_de_imagen",
  botones: [
    {
      id: "guardar",
      texto: "catalogo.accion.guardar",
      hace: { envia: "vidrieras.administrar_cuentas_de_imagen" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "quitar",
      texto: "catalogo.carta.quitar",
      hace: { envia: "vidrieras.administrar_cuentas_de_imagen" },
      sinPermiso: "AUSENTE",
    },
  ],
  estados: { ERROR: "GENERICO", SIN_PERMISO: "GENERICO" },
  textos: {
    "catalogo.cuentas_de_fotos.titulo": {
      usos: ["título de la pantalla y de la pestaña"],
      fuente: PROPUESTA_PENDIENTE,
    },
    "catalogo.cuentas_de_fotos.cuenta": {
      usos: [USO_DEL_ALTA],
      fuente: PROPUESTA_PENDIENTE,
    },
    "catalogo.accion.guardar": { usos: ["botón de declarar la cuenta"], fuente: YA_APROBADO },
    "catalogo.carta.quitar": { usos: ["botón de retirar cada cuenta"], fuente: YA_APROBADO },
    "stock.accion.motivo": { usos: [USO_DEL_RETIRO], fuente: YA_APROBADO },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDePantalla;
