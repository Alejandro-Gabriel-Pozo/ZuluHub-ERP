import {
  LARGO_MAXIMO_DEL_LUGAR_DE_CARTA,
  LARGO_MAXIMO_DEL_NOMBRE_DE_CARTA,
  LARGO_MAXIMO_DEL_RUBRO_DE_CARTA,
} from "../../primitivas/texto/datos-de-carta-publica";
import type { DefinicionDeDato, Proposito } from "./tipos-de-datos";

/**
 * Los datos de la carta pública del registro de datos (ver `registro.ts`), en su propio archivo: un módulo suma su archivo y una línea en el registro. Los largos NO se repiten acá: se
 * importan de la primitiva (`datos-de-carta-publica.ts`), donde viven una sola vez; la base los copia en los CHECK de `carta_publica` y una prueba falla si difieren.
 *
 * El mensaje de portada («Frase final» en la maqueta) NO está: la pantalla todavía no lo pide (su rótulo no está confirmado y solo se ve con el modelo Libro, que no existe), y un dato sin consumidor falla.
 */

const FORMULARIO_DE_CARTA = "apps/web/ui/plantillas/carta/FormularioDeCartaEnLinea.cliente.tsx";
const REQUIERE_VIDRIERA = { modulo: "vidriera", estadoDeEmpresa: ["ACTIVE"] } as const;
const PONER_POR = ["vidrieras.editar", "vidrieras.crear"] as const;

const PROPOSITO = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs/11-especificaciones/carta-real-especificacion.md §3.2 (tabla `carta_publica`) y la maqueta aprobada `carta-en-linea.html` (carpeta de prototipos de Pedernal-docs 10-ux-ui; filas 60 y 70 de decisiones-del-dueno-2026-11.md), con la regla del 12/11/2026 de rubro y lugar (fila 53 del mismo documento)",
});

export const DATOS_DE_CARTA = {
  "nombre-de-la-carta": {
    ficha: "src/primitivas/texto/datos-de-carta-publica.ts",
    propositos: [
      PROPOSITO(
        `Nombre de la carta en línea de una sucursal, el título de la portada: obligatorio, de 1 a ${LARGO_MAXIMO_DEL_NOMBRE_DE_CARTA} caracteres, propio de cada sucursal (fila 57 del mismo documento).`,
      ),
    ],
    consumidores: [FORMULARIO_DE_CARTA],
    ponerPor: PONER_POR,
    requiere: REQUIERE_VIDRIERA,
  },
  "rubro-de-la-carta": {
    ficha: "src/primitivas/texto/datos-de-carta-publica.ts",
    propositos: [
      PROPOSITO(
        `Rubro de la carta en línea (la línea de arriba del nombre en la portada): texto libre y opcional, hasta ${LARGO_MAXIMO_DEL_RUBRO_DE_CARTA} caracteres.`,
      ),
    ],
    consumidores: [FORMULARIO_DE_CARTA],
    ponerPor: PONER_POR,
    requiere: REQUIERE_VIDRIERA,
  },
  "lugar-de-la-carta": {
    ficha: "src/primitivas/texto/datos-de-carta-publica.ts",
    propositos: [
      PROPOSITO(
        `Lugar de la carta en línea (la línea de abajo del nombre en la portada): texto libre y opcional, hasta ${LARGO_MAXIMO_DEL_LUGAR_DE_CARTA} caracteres.`,
      ),
    ],
    consumidores: [FORMULARIO_DE_CARTA],
    ponerPor: PONER_POR,
    requiere: REQUIERE_VIDRIERA,
  },
} as const satisfies Readonly<Record<string, DefinicionDeDato>>;
