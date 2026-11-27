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
const FORMULARIO_DE_CUENTAS = "apps/web/ui/plantillas/carta/FormularioDeCuentaDeFotos.cliente.tsx";
const FORMULARIO_DE_RETIRO =
  "apps/web/ui/plantillas/carta/FormularioDeRetiroDeCuentaDeFotos.cliente.tsx";
const PONER_POR_CUENTAS = ["vidrieras.administrar_cuentas_de_imagen"] as const;
const FUENTE_DE_CUENTAS =
  "brief-logo-de-la-carta-cuentas-declaradas-2026-11-25.md §3 y §5; decisión del dueño 25/11/2026 (filas 452 y 453 de decisiones-del-dueno-2026-11.md); DEC-1410 y DEC-1411";
const REQUIERE_VIDRIERA = { modulo: "vidriera", estadoDeEmpresa: ["ACTIVE"] } as const;
const PONER_POR = ["vidrieras.editar", "vidrieras.crear"] as const;
const FUENTE_DE_IDENTIDAD =
  "Pedernal-docs 10-ux-ui (carpeta de prototipos), carta.html y carta-caras.html (maquetas aprobadas el 09/11/2026) y carta-identidad-y-portal-datos-diseno.md §2.1 y §7; filas 232 y 235 de decisiones-del-dueno-2026-11.md (colores libres con contraste 7:1; logo por dirección externa)";

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
  "modelo-de-la-carta": {
    ficha: "src/capacidades/experiencia/vidriera/modelos.ts",
    propositos: [
      {
        para: "Modelo de la carta en línea: Lista o Libro; elegir Libro exige la función del plan «vidriera_modelo_libro» y, sin ella o con ahorro de datos, la carta se ve como Lista.",
        fuente: FUENTE_DE_IDENTIDAD,
      },
    ],
    consumidores: [FORMULARIO_DE_CARTA],
    ponerPor: PONER_POR,
    requiere: REQUIERE_VIDRIERA,
  },
  "cara-de-la-carta": {
    ficha: "src/capacidades/experiencia/vidriera/caras.ts",
    propositos: [
      {
        para: "Cara de la carta en línea (el aspecto general): una de la lista cerrada de la plataforma; sin elegir rige la de siempre.",
        fuente: FUENTE_DE_IDENTIDAD,
      },
    ],
    consumidores: [FORMULARIO_DE_CARTA],
    ponerPor: PONER_POR,
    requiere: REQUIERE_VIDRIERA,
  },
  "color-de-la-carta": {
    ficha: "src/capacidades/experiencia/vidriera/color-de-la-carta.ts",
    propositos: [
      {
        para: "Color propio de la carta en línea: una de las seis paletas u otro color con la forma #rrggbb; sin elegir usa lo de la empresa. El contraste mínimo de 7:1 lo asegura el sistema al mostrarla.",
        fuente: FUENTE_DE_IDENTIDAD,
      },
    ],
    consumidores: [FORMULARIO_DE_CARTA],
    ponerPor: PONER_POR,
    requiere: REQUIERE_VIDRIERA,
  },
  "logo-de-la-carta": {
    ficha: "src/capacidades/activos/direccion-externa.ts",
    propositos: [
      {
        para: "Logo propio de la carta en línea, por dirección de la imagen en un proveedor permitido (no se suben archivos); vacío usa el logo de la empresa.",
        fuente: FUENTE_DE_IDENTIDAD,
      },
    ],
    consumidores: [FORMULARIO_DE_CARTA],
    ponerPor: PONER_POR,
    requiere: REQUIERE_VIDRIERA,
  },
  "cuenta-de-foto": {
    ficha: "src/capacidades/activos/direccion-externa.ts",
    propositos: [
      {
        para: "Cuenta del proveedor de imágenes (Cloudinary) que la empresa declara como suya: de ella, y solo de ella, se trae el logo de la carta (hasta 2 activas por empresa).",
        fuente: FUENTE_DE_CUENTAS,
      },
    ],
    consumidores: [FORMULARIO_DE_CUENTAS],
    ponerPor: PONER_POR_CUENTAS,
    requiere: REQUIERE_VIDRIERA,
  },
  "motivo-de-retiro-de-la-cuenta-de-foto": {
    ficha: "src/primitivas/texto/motivo-de-retiro-de-cuenta-de-imagen.ts",
    propositos: [
      {
        para: "Por qué se retira una cuenta de fotos declarada: queda en la cuenta, que no se borra, con quién y cuándo la retiró.",
        fuente: FUENTE_DE_CUENTAS,
      },
    ],
    consumidores: [FORMULARIO_DE_RETIRO],
    ponerPor: PONER_POR_CUENTAS,
    requiere: REQUIERE_VIDRIERA,
  },
} as const satisfies Readonly<Record<string, DefinicionDeDato>>;
