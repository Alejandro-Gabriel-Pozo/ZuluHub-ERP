import { idDeEjemplo, opcion, type VidrieraDeEjemplo, type ProductoDeEjemplo } from "./tipos";

/**
 * Hostería «Los Cardones»: restaurante con carta de vinos, elegida en Libro (§4.1). Pocos platos, una
 * guarnición a elegir con y sin recargo, y vinos por copa o botella. Incluye importes con fracciones de
 * centavo (IVA ya incluido en el catálogo, escala 6) para probar el redondeo.
 */

let n = 0;
function producto(
  nombre: string,
  precioBase: string,
  resto: Partial<Omit<ProductoDeEjemplo, "id" | "nombre" | "precioBase">> = {},
): ProductoDeEjemplo {
  n += 1;
  return {
    id: idDeEjemplo(21, n),
    nombre,
    descripcion: null,
    agotado: false,
    foto: null,
    precioBase,
    tamanos: [],
    obligatorios: [],
    adicionales: [],
    ...resto,
  };
}

const GUARNICION_A_ELEGIR = [
  {
    titulo: "Guarnición",
    opciones: [
      opcion("Papas rústicas"),
      opcion("Puré de calabaza"),
      opcion("Ensalada mixta"),
      opcion("Risotto de hongos", "2500.505000"),
    ],
  },
];
const COPA_O_BOTELLA = [opcion("Copa"), opcion("Botella", "17333.335000")];

export const HOSTERIA: VidrieraDeEjemplo = {
  id: idDeEjemplo(3, 3),
  codigo: "ejemplo-hosteria",
  nombre: "Los Cardones Restaurante",
  rubro: "HOSTERIA",
  modeloElegido: "LIBRO",
  perillasEncendidas: ["vidriera_modelo_libro"],
  secciones: [
    {
      id: idDeEjemplo(2, 21),
      nombre: "Entradas",
      productos: [
        producto("Empanadas salteñas (3)", "9800"),
        producto("Provoleta a la parrilla", "11200", {
          descripcion: "Con orégano, tomate seco y pan de campo.",
        }),
        producto("Tabla de fiambres regionales", "24500.250000"),
      ],
    },
    {
      id: idDeEjemplo(2, 22),
      nombre: "Platos principales",
      productos: [
        producto("Chivo al horno", "38900", {
          descripcion: "Cocción lenta de seis horas.",
          obligatorios: GUARNICION_A_ELEGIR,
        }),
        producto("Lomo a la pimienta", "36500", { obligatorios: GUARNICION_A_ELEGIR }),
        producto("Trucha patagónica", "33900.995000", { obligatorios: GUARNICION_A_ELEGIR }),
        producto("Ñoquis de calabaza", "27800", {
          descripcion: "Con salsa de queso de cabra y nueces.",
        }),
        producto("Locro de invierno", "26500", { agotado: true }),
      ],
    },
    {
      id: idDeEjemplo(2, 23),
      nombre: "Vinos tintos",
      productos: [
        producto("Malbec reserva", "6800", { tamanos: COPA_O_BOTELLA }),
        producto("Cabernet Sauvignon", "6500", { tamanos: COPA_O_BOTELLA }),
        producto("Tannat de altura", "7400", {
          tamanos: COPA_O_BOTELLA,
          descripcion: "Bodega de Cafayate, 2021.",
        }),
      ],
    },
    {
      id: idDeEjemplo(2, 24),
      nombre: "Vinos blancos",
      productos: [
        producto("Torrontés", "5900", { tamanos: COPA_O_BOTELLA }),
        producto("Chardonnay", "6200", { tamanos: COPA_O_BOTELLA }),
      ],
    },
    {
      id: idDeEjemplo(2, 25),
      nombre: "Postres",
      productos: [
        producto("Quesillo con miel de caña", "9200"),
        producto("Helado artesanal", "8800", {
          adicionales: [
            {
              titulo: "Salsas",
              opciones: [opcion("Dulce de leche"), opcion("Chocolate amargo", "700")],
            },
          ],
        }),
      ],
    },
  ],
};
