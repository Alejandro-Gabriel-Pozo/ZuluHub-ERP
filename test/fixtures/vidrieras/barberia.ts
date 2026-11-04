import { idDeEjemplo, opcion, type VidrieraDeEjemplo, type ProductoDeEjemplo } from "./tipos";

/**
 * Barbería «Navaja y Tijera»: lista de servicios (no de comidas), sin fotos. Precio por servicio, con
 * recargos por largo y adicionales opcionales; algunos servicios sin variantes. Sirve para comprobar que
 * la carta no supone que todo es gastronomía.
 */

let n = 0;
function servicio(
  nombre: string,
  precioBase: string,
  resto: Partial<Omit<ProductoDeEjemplo, "id" | "nombre" | "precioBase">> = {},
): ProductoDeEjemplo {
  n += 1;
  return {
    id: idDeEjemplo(31, n),
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

const LARGO = [opcion("Corto"), opcion("Medio", "1500"), opcion("Largo", "3000")];

export const BARBERIA: VidrieraDeEjemplo = {
  id: idDeEjemplo(3, 4),
  codigo: "ejemplo-barberia",
  nombre: "Barbería Navaja y Tijera",
  rubro: "BARBERIA",
  modeloElegido: null,
  perillasEncendidas: [],
  secciones: [
    {
      id: idDeEjemplo(2, 31),
      nombre: "Cabello",
      productos: [
        servicio("Corte clásico", "9500", {
          tamanos: LARGO,
          descripcion: "Incluye lavado y peinado.",
        }),
        servicio("Corte con degradé", "11000", { tamanos: LARGO }),
        servicio("Corte infantil", "7500"),
        servicio("Lavado y peinado", "4500"),
      ],
    },
    {
      id: idDeEjemplo(2, 32),
      nombre: "Barba",
      productos: [
        servicio("Perfilado de barba", "6000"),
        servicio("Afeitado con toalla caliente", "8000", {
          descripcion: "Navaja, espuma artesanal y bálsamo.",
        }),
        servicio("Corte y barba", "14500", { tamanos: LARGO }),
      ],
    },
    {
      id: idDeEjemplo(2, 33),
      nombre: "Otros servicios",
      productos: [
        servicio("Coloración", "18000", {
          adicionales: [
            { titulo: "Para sumar", opciones: [opcion("Tratamiento hidratante", "4000")] },
          ],
        }),
        servicio("Limpieza facial", "7000"),
        servicio("Cejas", "2500", { agotado: true }),
      ],
    },
  ],
};
