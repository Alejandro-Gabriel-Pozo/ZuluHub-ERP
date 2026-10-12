import type { DefinicionDeModulo } from "../../src/capacidades/modulos/catalogo";
import type { DefinicionDePerilla } from "../../src/capacidades/planes/perillas";

/**
 * Catálogos de prueba de módulos y perillas (marcas y planes). Los reales traen un solo módulo y una
 * sola perilla: para probar `requiere`, cadenas, límites e interruptores hacen falta más. Tienen la
 * forma del catálogo real, y se pasan por parámetro a las funciones puras (no se tocan los reales).
 */

const modulo = (
  datos: Partial<Pick<DefinicionDeModulo, "estado" | "obligatorio" | "requiere">>,
): Pick<DefinicionDeModulo, "estado" | "obligatorio" | "requiere"> => ({
  estado: "disponible",
  obligatorio: false,
  requiere: [],
  ...datos,
});

export const MODULOS_DE_PRUEBA = {
  nucleo: modulo({ obligatorio: true }),
  caja: modulo({}),
  ventas: modulo({ requiere: ["caja"] }),
  reservas: modulo({ requiere: ["nucleo"] }),
  cuentas: modulo({ requiere: ["ventas"] }),
  comandas: modulo({ estado: "en_desarrollo" }),
} as const;

export const CLAVES_DE_MODULOS_DE_PRUEBA = Object.keys(MODULOS_DE_PRUEBA);

const comun = { modulo: "administracion" } as const;

export const PERILLAS_DE_PRUEBA = {
  empresas_por_tenant: { ...comun, ambito: "TENANT", tipo: "LIMITE", base: { limite: 1 } },
  cajas_por_sucursal: { ...comun, ambito: "SUCURSAL", tipo: "LIMITE", base: { limite: 1 } },
  carta_por_qr: { ...comun, ambito: "EMPRESA", tipo: "INTERRUPTOR", base: { encendida: false } },
  con_sello: { ...comun, ambito: "EMPRESA", tipo: "INTERRUPTOR", base: { encendida: true } },
  reserva_provisoria: {
    ...comun,
    ambito: "EMPRESA",
    tipo: "INTERRUPTOR",
    base: { encendida: false },
  },
  confirmacion_por_sena: {
    ...comun,
    ambito: "EMPRESA",
    tipo: "INTERRUPTOR",
    base: { encendida: false },
    requiere: "reserva_provisoria",
  },
  asignacion_diferida: {
    ...comun,
    ambito: "EMPRESA",
    tipo: "INTERRUPTOR",
    base: { encendida: false },
  },
  overbooking: {
    ...comun,
    ambito: "EMPRESA",
    tipo: "LIMITE",
    base: { limite: 0 },
    requiere: "asignacion_diferida",
  },
  sobreventa_extra: {
    ...comun,
    ambito: "EMPRESA",
    tipo: "LIMITE",
    base: { limite: 5 },
    requiere: "overbooking",
  },
} as const satisfies Record<string, DefinicionDePerilla>;

export const CLAVES_DE_PERILLAS_DE_PRUEBA = Object.keys(PERILLAS_DE_PRUEBA);

/** Atajos para escribir valores. */
export const encendida = { tipo: "INTERRUPTOR", encendida: true } as const;
export const apagada = { tipo: "INTERRUPTOR", encendida: false } as const;
export const limite = (n: number | "ILIMITADO") => ({ tipo: "LIMITE", limite: n }) as const;
