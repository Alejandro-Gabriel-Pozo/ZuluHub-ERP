import {
  idDeEjemplo,
  opcion,
  type VidrieraDeEjemplo,
  type FotoDeEjemplo,
  type ProductoDeEjemplo,
} from "./tipos";

/**
 * Panadería «El Trigal»: carta con fotos, elegida en Cuadrícula (§4.1). Mezcla productos con foto visible,
 * sin foto, con foto oculta y con foto rota, para probar que la carta no tiene huecos ni íconos rotos y
 * que `modeloEfectivo` cuenta solo las visibles. Venta por unidad, por docena y por kilo.
 */

let n = 0;
function foto(
  slug: string,
  alt: string | null,
  estado: FotoDeEjemplo["estado"] = "VISIBLE",
): FotoDeEjemplo {
  return { direccion: `/fotos/${slug}/480.webp`, alt, ancho: 480, alto: 360, estado };
}

function producto(
  nombre: string,
  precioBase: string,
  resto: Partial<Omit<ProductoDeEjemplo, "id" | "nombre" | "precioBase">> = {},
): ProductoDeEjemplo {
  n += 1;
  return {
    id: idDeEjemplo(11, n),
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

const UNIDAD_O_DOCENA = [
  opcion("Unidad"),
  opcion("Media docena", "3200"),
  opcion("Docena", "6900"),
];

export const PANADERIA: VidrieraDeEjemplo = {
  id: idDeEjemplo(3, 2),
  codigo: "ejemplo-panaderia",
  nombre: "Panadería El Trigal",
  rubro: "PANADERIA",
  modeloElegido: "CUADRICULA",
  perillasEncendidas: ["carta_modelo_cuadricula", "productos_con_foto"],
  secciones: [
    {
      id: idDeEjemplo(2, 11),
      nombre: "Pan",
      productos: [
        producto("Pan francés", "2200.50", {
          foto: foto("pan-frances", "Pan francés recién horneado"),
          descripcion: "Corteza crocante, miga abierta. Se vende por kilo.",
        }),
        producto("Pan de campo", "3100", { foto: foto("pan-de-campo", null) }),
        producto("Pan de masa madre", "4800", { foto: foto("masa-madre", "Hogaza de masa madre") }),
        producto("Pan lactal", "3500"),
        producto("Pan de salvado", "3300", { foto: foto("salvado", null, "OCULTA") }),
      ],
    },
    {
      id: idDeEjemplo(2, 12),
      nombre: "Facturas",
      productos: [
        producto("Medialunas de manteca", "950", {
          foto: foto("medialuna", "Medialunas de manteca"),
          tamanos: UNIDAD_O_DOCENA,
        }),
        producto("Medialunas de grasa", "900", { tamanos: UNIDAD_O_DOCENA }),
        producto("Vigilantes", "850", {
          foto: foto("vigilante", null, "ROTA"),
          tamanos: UNIDAD_O_DOCENA,
        }),
        producto("Palmeras", "1100", {
          foto: foto("palmera", "Palmeras glaseadas"),
          tamanos: UNIDAD_O_DOCENA,
        }),
        producto("Cañoncitos de dulce de leche", "1300", {
          foto: foto("canoncito", "Cañoncitos rellenos"),
          agotado: true,
        }),
      ],
    },
    {
      id: idDeEjemplo(2, 13),
      nombre: "Tortas y postres",
      productos: [
        producto("Torta de ricota", "15900", {
          foto: foto("ricota", "Torta de ricota entera"),
          tamanos: [opcion("Chica (8 porciones)"), opcion("Grande (14 porciones)", "7000")],
        }),
        producto("Lemon pie", "5400", { foto: foto("lemon-pie", "Porción de lemon pie") }),
        producto("Chocotorta", "5200"),
        producto("Pastafrola", "3800", { foto: foto("pastafrola", null) }),
      ],
    },
  ],
};
