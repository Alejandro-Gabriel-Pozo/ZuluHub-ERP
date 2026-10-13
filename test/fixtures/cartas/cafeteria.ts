import { idDeEjemplo, opcion, type CartaDeEjemplo, type ProductoDeEjemplo } from "./tipos";

/**
 * Cafetería «La Esquina»: 60 productos en 6 secciones, la carta de entrada (§2). Sin fotos y sin modelo
 * elegido: es la Lista de base. Tiene tamaños con recargo (café, jugos, licuados), guarniciones sin
 * recargo (tostados y sándwiches), adicionales con recargo y un par de agotados y descripciones.
 */

const TAMANOS_DE_CAFE = [opcion("Chico"), opcion("Mediano", "400"), opcion("Grande", "800")];
const TAMANOS_DE_BEBIDA = [opcion("Vaso", "0"), opcion("Jarra", "1500")];
const GUARNICION = [
  { titulo: "Guarnición", opciones: [opcion("Papas fritas"), opcion("Puré"), opcion("Ensalada")] },
];
const ADICIONALES_DE_CAFE = [
  {
    titulo: "Para sumar",
    opciones: [opcion("Leche de almendras", "600"), opcion("Shot extra", "700"), opcion("Crema")],
  },
];
const ADICIONALES_SALADOS = [
  { titulo: "Para sumar", opciones: [opcion("Huevo frito", "600"), opcion("Queso extra", "500")] },
];

let n = 0;
function producto(
  nombre: string,
  precioBase: string,
  resto: Partial<Omit<ProductoDeEjemplo, "id" | "nombre" | "precioBase">> = {},
): ProductoDeEjemplo {
  n += 1;
  return {
    id: idDeEjemplo(1, n),
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

const cafes = [
  producto("Espresso", "2300", { tamanos: TAMANOS_DE_CAFE, adicionales: ADICIONALES_DE_CAFE }),
  producto("Americano", "2400", { tamanos: TAMANOS_DE_CAFE, adicionales: ADICIONALES_DE_CAFE }),
  producto("Cortado", "2600", { tamanos: TAMANOS_DE_CAFE, adicionales: ADICIONALES_DE_CAFE }),
  producto("Lágrima", "2700", { tamanos: TAMANOS_DE_CAFE, adicionales: ADICIONALES_DE_CAFE }),
  producto("Café con leche", "2900", {
    descripcion: "Café de filtro con leche entera caliente.",
    tamanos: TAMANOS_DE_CAFE,
    adicionales: ADICIONALES_DE_CAFE,
  }),
  producto("Capuchino", "3300", {
    descripcion: "Espresso, leche espumada y cacao amargo.",
    tamanos: TAMANOS_DE_CAFE,
    adicionales: ADICIONALES_DE_CAFE,
  }),
  producto("Flat white", "3500", { tamanos: TAMANOS_DE_CAFE, adicionales: ADICIONALES_DE_CAFE }),
  producto("Moka", "3600", { tamanos: TAMANOS_DE_CAFE, adicionales: ADICIONALES_DE_CAFE }),
  producto("Submarino", "3800", {
    descripcion: "Leche caliente con barra de chocolate.",
    tamanos: TAMANOS_DE_CAFE,
  }),
  producto("Café helado", "3900", { tamanos: TAMANOS_DE_CAFE, agotado: true }),
  producto("Doppio", "3100"),
  producto("Macchiato", "2800"),
];

const infusiones = [
  producto("Té negro", "2000", { tamanos: [opcion("Taza"), opcion("Pava", "900")] }),
  producto("Té verde", "2000", { tamanos: [opcion("Taza"), opcion("Pava", "900")] }),
  producto("Té de hierbas", "2100", { tamanos: [opcion("Taza"), opcion("Pava", "900")] }),
  producto("Mate cocido", "1900"),
  producto("Chocolate caliente", "3400", { tamanos: TAMANOS_DE_CAFE }),
  producto("Chocolatada", "3200", { tamanos: TAMANOS_DE_CAFE }),
  producto("Mate de la casa", "3000", {
    descripcion: "Con termo, bizcochitos y agua caliente a gusto.",
  }),
  producto("Chai latte", "3700", { tamanos: TAMANOS_DE_CAFE }),
];

const frias = [
  producto("Agua sin gas", "1800"),
  producto("Agua con gas", "1800"),
  producto("Gaseosa", "2400"),
  producto("Jugo de naranja", "3300", { tamanos: TAMANOS_DE_BEBIDA }),
  producto("Limonada", "3200", { tamanos: TAMANOS_DE_BEBIDA }),
  producto("Licuado de frutilla", "3900", { tamanos: TAMANOS_DE_BEBIDA }),
  producto("Licuado de banana", "3700", { tamanos: TAMANOS_DE_BEBIDA }),
  producto("Cerveza artesanal", "4600", { agotado: true }),
];

const desayunos = [
  producto("Tostadas con manteca", "3300"),
  producto("Tostadas con queso y mermelada", "3900"),
  producto("Medialunas (3)", "3200"),
  producto("Medialunas (6)", "5900"),
  producto("Desayuno clásico", "6900", {
    descripcion: "Café con leche, dos medialunas y jugo de naranja.",
  }),
  producto("Desayuno saludable", "7400", {
    descripcion: "Yogur con granola, fruta de estación y té.",
  }),
  producto("Yogur con granola", "4500"),
  producto("Tostón de palta", "6800", {
    adicionales: [{ titulo: "Para sumar", opciones: [opcion("Huevo poché", "900")] }],
  }),
];

const salados = [
  producto("Tostado de jamón y queso", "5600", { adicionales: ADICIONALES_SALADOS }),
  producto("Tostado completo", "6400", { adicionales: ADICIONALES_SALADOS }),
  producto("Sándwich de milanesa", "8900", {
    obligatorios: GUARNICION,
    adicionales: ADICIONALES_SALADOS,
  }),
  producto("Sándwich de lomito", "9600", {
    obligatorios: GUARNICION,
    adicionales: ADICIONALES_SALADOS,
  }),
  producto("Sándwich de pollo", "8700", { obligatorios: GUARNICION }),
  producto("Sándwich vegetariano", "7900", { obligatorios: GUARNICION }),
  producto("Hamburguesa clásica", "9900", {
    obligatorios: GUARNICION,
    adicionales: ADICIONALES_SALADOS,
  }),
  producto("Ensalada César", "8200"),
  producto("Ensalada de la casa", "7600"),
  producto("Tarta del día", "7200", {
    descripcion: "Pregunte por el sabor de hoy. Viene con ensalada.",
    obligatorios: [
      { titulo: "Porción", opciones: [opcion("Individual"), opcion("Para compartir", "4500")] },
    ],
  }),
  producto("Empanada de carne", "1900"),
  producto("Empanada de jamón y queso", "1900"),
];

const pasteleria = [
  producto("Medialuna rellena", "2800"),
  producto("Budín de limón", "3500"),
  producto("Budín de banana", "3500"),
  producto("Brownie", "3900", {
    adicionales: [{ titulo: "Para sumar", opciones: [opcion("Bocha de helado", "1500")] }],
  }),
  producto("Cheesecake", "5200"),
  producto("Lemon pie", "5000"),
  producto("Torta de zanahoria", "4900"),
  producto("Alfajor de maicena", "1500"),
  producto("Alfajor de chocolate", "1700"),
  producto("Cookie de chips", "2200"),
  producto("Tiramisú", "5600", { agotado: true }),
  producto("Flan casero", "4300", {
    descripcion: "Con dulce de leche y crema.",
    adicionales: [{ titulo: "Para sumar", opciones: [opcion("Crema extra", "500")] }],
  }),
];

const seccion = (numero: number, nombre: string, productos: readonly ProductoDeEjemplo[]) => ({
  id: idDeEjemplo(2, numero),
  nombre,
  productos,
});

export const CAFETERIA: CartaDeEjemplo = {
  id: idDeEjemplo(3, 1),
  codigo: "ejemplo-cafeteria",
  nombre: "La Esquina Café",
  rubro: "CAFETERIA",
  modeloElegido: null,
  perillasEncendidas: [],
  secciones: [
    seccion(1, "Cafés", cafes),
    seccion(2, "Infusiones", infusiones),
    seccion(3, "Bebidas frías", frias),
    seccion(4, "Desayunos y meriendas", desayunos),
    seccion(5, "Salados", salados),
    seccion(6, "Pastelería", pasteleria),
  ],
};
