import { textosDeCarta } from "../../../../../src/capacidades/experiencia/carta/textos";
import type { LetraBase } from "../../../../../src/capacidades/experiencia/carta/letra";
import type {
  VistaDeCarta,
  VistaDeFoto,
  VistaDeProducto,
  VistaDeSeccion,
} from "../../../../../src/capacidades/experiencia/carta/vista";

/**
 * Cartas ya armadas (`VistaDeCarta`) para las pruebas de la plantilla. En el navegador no se puede armar la
 * vista de verdad (las direcciones usan `node:crypto`; eso lo prueban las pruebas de Node), así que acá se
 * escriben a mano, con las formas que importan: tamaños, adicionales, guarnición, agotado, con y sin
 * descripción, con y sin foto, nombres con tildes y una palabra muy larga.
 */

export const TEXTOS = textosDeCarta({});

const RUTA = "/ejemplo";

const hexa = (n: number): string =>
  (n * 2654435761 + 12345).toString(16).slice(-8).padStart(8, "0");

/** Un bloque de color como SVG en línea: ni archivos ni pedidos de red. */
export function fotoDePrueba(
  tono = 30,
  ancho = 480,
  alto = 360,
  alt = "Foto de prueba",
): VistaDeFoto {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${ancho} ${alto}'>` +
    `<rect width='${ancho}' height='${alto}' fill='hsl(${tono} 38% 46%)'/></svg>`;
  return { direccion: `data:image/svg+xml,${encodeURIComponent(svg)}`, alt, ancho, alto };
}

export function productoDePrueba(
  nombre: string,
  n: number,
  resto: Partial<VistaDeProducto> = {},
): VistaDeProducto {
  const segmento = `${nombre
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}-${hexa(n)}`;
  return {
    segmento,
    href: `${RUTA}/${segmento}`,
    seccion: "cafes",
    nombre,
    descripcion: null,
    agotado: false,
    precioEnLista: "$ 1.500",
    guarnicion: null,
    tamanos: [],
    obligatorios: [],
    adicionales: [],
    foto: null,
    ...resto,
  };
}

const TAMANOS = [
  { nombre: "Chico", precio: "$ 3.300" },
  { nombre: "Mediano", precio: "$ 3.700" },
  { nombre: "Grande", precio: "$ 4.100" },
];

const ADICIONALES = [
  {
    titulo: "Para sumar",
    opciones: [
      { nombre: "Leche de almendras", recargo: "+ $ 600" },
      { nombre: "Shot extra", recargo: "+ $ 700" },
      { nombre: "Crema", recargo: null },
    ],
  },
];

/** Los productos con forma propia que las pruebas buscan por nombre. */
export const CAPUCHINO = productoDePrueba("Capuchino", 1, {
  descripcion: "Espresso, leche espumada y cacao amargo.",
  precioEnLista: "desde $ 3.300",
  tamanos: TAMANOS,
  adicionales: ADICIONALES,
});
export const CAFE_HELADO = productoDePrueba("Café helado", 2, {
  agotado: true,
  precioEnLista: "desde $ 3.900",
  tamanos: TAMANOS,
});
export const MILANESA = productoDePrueba("Sándwich de milanesa", 3, {
  precioEnLista: "$ 8.600",
  guarnicion: "Con papas fritas, puré o ensalada",
  descripcion: "Milanesa de ternera, lechuga, tomate y mayonesa casera.",
  obligatorios: [
    {
      titulo: "Guarnición",
      opciones: [
        { nombre: "Papas fritas", recargo: null },
        { nombre: "Puré", recargo: null },
        { nombre: "Ensalada", recargo: null },
      ],
    },
  ],
});
export const NOQUIS = productoDePrueba("Ñoquis de calabaza", 4, {
  precioEnLista: "$ 9.400",
  descripcion: "Salsa fileto o crema.\nCon queso rallado.",
});
export const SIN_NADA = productoDePrueba("Medialuna", 5, { precioEnLista: "$ 900" });
export const CON_FOTO = productoDePrueba("Torta rogel", 6, {
  precioEnLista: "$ 21.000",
  foto: fotoDePrueba(25, 480, 360, "Torta rogel con dulce de leche"),
});
export const LARGO = productoDePrueba("Hamburguesaconquesocheddarbaconcebollacaramelizada", 7, {
  precioEnLista: "desde $ 12.345.678,50",
  descripcion: "Palabra_larguisima_sin_espacios_para_probar_que_nunca_se_sale_de_la_pantalla.",
});

const NOMBRES = [
  "Espresso",
  "Americano",
  "Cortado",
  "Lágrima",
  "Doppio",
  "Macchiato",
  "Té negro",
  "Té verde",
  "Mate cocido",
  "Chocolatada",
  "Agua sin gas",
  "Gaseosa",
  "Jugo de naranja",
  "Limonada",
  "Licuado de frutilla",
  "Tostado de jamón y queso",
  "Ensalada de la casa",
  "Brownie",
  "Budín de limón",
  "Alfajor de maicena",
];

/**
 * Una carta de `cantidad` productos (los 7 con forma propia y el resto de relleno) repartidos en seis secciones.
 * `cantidad` por encima de 40 hace aparecer la búsqueda.
 */
export function cartaDePrueba(
  opciones: { cantidad?: number; letraBase?: LetraBase; lugar?: string | null } = {},
): VistaDeCarta {
  const {
    cantidad = 60,
    letraBase = "NORMAL",
    lugar = "Av. Belgrano 412 · todos los días de 7 a 21",
  } = opciones;
  const propios = [CAPUCHINO, CAFE_HELADO, MILANESA, NOQUIS, SIN_NADA, CON_FOTO, LARGO];
  const relleno = Array.from({ length: Math.max(0, cantidad - propios.length) }, (_, i) =>
    productoDePrueba(`${NOMBRES[i % NOMBRES.length] ?? "Producto"} ${i + 1}`, 100 + i, {
      precioEnLista: `$ ${String(1000 + i * 100)}`,
    }),
  );
  const todos = [...propios, ...relleno].slice(0, cantidad);
  const nombresDeSeccion = [
    "Cafés",
    "Infusiones",
    "Bebidas frías",
    "Desayunos y meriendas",
    "Salados",
    "Pastelería",
  ];
  const tamano = Math.ceil(todos.length / nombresDeSeccion.length);
  const secciones: VistaDeSeccion[] = nombresDeSeccion.flatMap((nombre, i) => {
    const id = nombre
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
    const productos = todos.slice(i * tamano, (i + 1) * tamano).map((p) => ({ ...p, seccion: id }));
    return productos.length === 0 ? [] : [{ id, nombre, productos }];
  });
  return {
    nombre: "La Esquina Café",
    rubro: "Cafetería",
    lugar,
    letraBase,
    hrefDeLaCarta: RUTA,
    secciones,
    totalDeProductos: secciones.reduce((n, s) => n + s.productos.length, 0),
  };
}
